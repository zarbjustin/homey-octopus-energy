'use strict';

import Homey from 'homey';
import { AccountPoller } from './AccountPoller';
import {
  reconcile, ReconcileState, PlannedInput, CompletedInput,
} from './dispatch/reconcile';
import { DispatchView, DispatchFinalised } from './dispatch/types';

interface DispatchApp extends Homey.App {
  getFlexPlanned(apiKey: string, accountNumber: string): Promise<PlannedInput[]>;
  getCachedCompletedWindows(apiKey: string, accountNumber: string): Promise<CompletedInput[]>;
}

/**
 * Sprint 43 dispatch "truth model" poller. Builds a device-aware, reconciled
 * view of Intelligent Octopus Go dispatches and drives the existing Flow cards
 * from honest state transitions:
 *  - dispatch_started/ended fire on the account-aggregate active edge (a window
 *    that is genuinely active NOW, never mere future intent, never from stale data);
 *  - dispatch_completed fires once per newly-seen completed control window;
 *  - dispatch_active reflects whether any device is active now.
 * Planned intent is never presented as settlement, and a failed poll never
 * fabricates a cancellation or an "ended" event.
 */
export class DispatchPoller extends AccountPoller {

  protected readonly intervalMs = 5 * 60_000;

  private states = new Map<string, ReconcileState>();

  private seeded = new Set<string>();

  private lastError = new Map<string, string>();

  private recentCompleted = new Map<string, DispatchFinalised[]>();

  /** Whether a smart-charge dispatch is currently active on any account. */
  isActive(): boolean {
    for (const state of this.states.values()) {
      if (state.anyActive) return true;
    }
    return false;
  }

  /**
   * A sanitised, deviceId-free presentation snapshot for widgets: planned/active
   * intent and recent finalised control windows. Never a settlement claim.
   */
  getAccountView(accountNumber: string): DispatchView {
    const state = this.states.get(accountNumber);
    const windows = (state?.windows ?? []).map((w) => ({
      kind: w.kind, start: w.start, end: w.end, state: w.state, confidence: w.confidence,
    }));
    const active = windows.filter((w) => w.state === 'active');
    const planned = windows
      .filter((w) => w.state === 'planned')
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    const finalised = [...(this.recentCompleted.get(accountNumber) ?? [])]
      .sort((a, b) => new Date(b.end).getTime() - new Date(a.end).getTime())
      .slice(0, 5);
    return {
      activeNow: Boolean(state?.anyActive),
      active,
      next: planned[0] ?? null,
      recentFinalised: finalised,
    };
  }

  protected async poll(): Promise<void> {
    const accounts = this.accounts();
    const configured = new Set(accounts.map((a) => a.accountNumber));
    for (const account of [...this.states.keys()]) {
      if (!configured.has(account)) {
        this.states.delete(account);
        this.seeded.delete(account);
        this.lastError.delete(account);
        this.recentCompleted.delete(account);
      }
    }
    await Promise.all(accounts.map((creds) => this.pollAccount(creds)));
    this.writeDiagnostics();
  }

  private state(accountNumber: string): ReconcileState {
    let state = this.states.get(accountNumber);
    if (!state) {
      state = { windows: [], anyActive: false, lastCompletedEnd: 0 };
      this.states.set(accountNumber, state);
    }
    return state;
  }

  private async pollAccount(creds: { apiKey: string; accountNumber: string }): Promise<void> {
    const app = this.app as DispatchApp;
    let planned: PlannedInput[] = [];
    let ok = false;
    try {
      planned = await app.getFlexPlanned(creds.apiKey, creds.accountNumber);
      ok = true;
    } catch (err) {
      ok = false;
      this.logErrorOnce(creds, err);
    }

    let completed: CompletedInput[] | null = null;
    try {
      completed = await app.getCachedCompletedWindows(creds.apiKey, creds.accountNumber);
    } catch (err) {
      completed = null; // best-effort: reconcile simply skips completed this cycle
    }

    const prev = this.state(creds.accountNumber);
    const result = reconcile(prev, planned, ok, completed, Date.now());

    if (result.started) {
      const nextEnd = result.activeNow
        .map((w) => w.end)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];
      this.fire('dispatch_started', { end: nextEnd ? this.fmt(nextEnd) : '' });
      if (this.notifyEnabled('notify_dispatch', false)) {
        await this.notify('🚗 Intelligent Octopus Go smart-charge dispatch has started.');
      }
    }
    if (result.ended) {
      this.fire('dispatch_ended', {});
    }
    // Suppress the first completed batch after (re)start to avoid a backfill storm.
    if (this.seeded.has(creds.accountNumber)) {
      for (const c of result.newlyCompleted) {
        this.fire('dispatch_completed', { end: this.fmt(c.end) });
      }
    }
    this.seeded.add(creds.accountNumber);
    if (result.newlyCompleted.length) {
      const list = this.recentCompleted.get(creds.accountNumber) ?? [];
      for (const c of result.newlyCompleted) list.push({ start: c.start, end: c.end, delta: c.delta });
      this.recentCompleted.set(creds.accountNumber, list.slice(-20));
    }

    this.states.set(creds.accountNumber, {
      windows: result.windows,
      anyActive: result.anyActive,
      lastCompletedEnd: result.lastCompletedEnd,
    });
    if (ok) this.lastError.delete(creds.accountNumber);
  }

  private logErrorOnce(creds: { apiKey: string; accountNumber: string }, err: unknown): void {
    const message = this.redact(err, creds.apiKey);
    if (this.lastError.get(creds.accountNumber) !== message) {
      this.lastError.set(creds.accountNumber, message);
      this.app.error('Dispatch poll failed:', message);
    }
  }

  private redact(err: unknown, secret: string): string {
    const message = err instanceof Error ? err.message : String(err ?? 'Unknown error');
    return message.replaceAll(secret, '[redacted]').replace(/\s+/g, ' ').slice(0, 240);
  }

  /** Aggregate, identifier-free diagnostics (no account numbers or device ids). */
  private writeDiagnostics(): void {
    let activeAccounts = 0;
    let plannedWindows = 0;
    for (const state of this.states.values()) {
      if (state.anyActive) activeAccounts += 1;
      plannedWindows += state.windows.filter((w) => w.state === 'planned' || w.state === 'active').length;
    }
    const diagnostics = {
      accounts: this.states.size,
      activeAccounts,
      plannedWindows,
      errors: this.lastError.size,
      lastAttempt: new Date().toISOString(),
    };
    try {
      this.app.homey.settings.set('dispatch_diagnostics_v2', diagnostics);
    } catch (err) {
      this.app.error('Could not persist dispatch diagnostics:', err);
    }
  }
}
