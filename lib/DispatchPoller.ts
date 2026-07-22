'use strict';

import Homey from 'homey';
import { AccountPoller } from './AccountPoller';
import {
  reconcile, ReconcileState, PlannedInput, CompletedInput,
} from './dispatch/reconcile';
import { DispatchView, DispatchFinalised } from './dispatch/types';
import { FreshnessState } from './freshness';
import { isBudgetError } from './KrakenBudget';
import { redactSecrets } from './redact';

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

  /** Time (ms) of the last SUCCESSFUL poll per account, for view freshness. */
  private lastObservedAt = new Map<string, number>();

  private seeded = new Set<string>();

  private lastError = new Map<string, string>();

  private recentCompleted = new Map<string, DispatchFinalised[]>();

  /** Whether a smart-charge dispatch is currently active on any account. Recomputed
   *  against the clock (via getAccountView) so a window retained across a FAILED poll
   *  is never reported active after it has actually ended, and so this condition, the
   *  `octopus_dispatching` capability, and the settings diagnostics always agree. */
  isActive(): boolean {
    for (const accountNumber of this.states.keys()) {
      if (this.getAccountView(accountNumber).activeNow) return true;
    }
    return false;
  }

  /** Whether a BOOST (bump/user-initiated) dispatch is active on any account right
   *  now. Read-only. Fails closed on stale data: a retained-across-failure window
   *  whose freshness has lapsed does NOT report as boosting, so automations never
   *  act on a boost we can no longer confirm. */
  isBoosting(): boolean {
    for (const accountNumber of this.states.keys()) {
      const view = this.getAccountView(accountNumber);
      if (view.boostingNow && view.freshness !== 'stale') return true;
    }
    return false;
  }

  /**
   * A sanitised, deviceId-free presentation snapshot for widgets: planned/active
   * intent and recent finalised control windows. Never a settlement claim.
   */
  getAccountView(accountNumber: string): DispatchView {
    const now = Date.now();
    const state = this.states.get(accountNumber);
    const windows = (state?.windows ?? []).map((w) => ({
      kind: w.kind, start: w.start, end: w.end, state: w.state, confidence: w.confidence,
    }));
    // Re-verify against the clock so a window retained across a FAILED poll (which
    // fail-closed keeps to avoid a false "ended") is never presented as active or
    // next once it has actually ended (F1: never show stale as current).
    const active = windows.filter((w) => {
      const s = Date.parse(w.start);
      const e = Date.parse(w.end);
      return Number.isFinite(s) && Number.isFinite(e) && now >= s && now < e;
    });
    const planned = windows
      .filter((w) => {
        const s = Date.parse(w.start);
        return Number.isFinite(s) && s > now;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    const finalised = [...(this.recentCompleted.get(accountNumber) ?? [])]
      .sort((a, b) => new Date(b.end).getTime() - new Date(a.end).getTime())
      .slice(0, 5);
    const observedMs = this.lastObservedAt.get(accountNumber);
    // Retained-across-failure windows must not read as fresh: mark stale after
    // ~2.5 poll cycles so automations can fail closed on the freshness field.
    let freshness: FreshnessState = 'unknown';
    if (observedMs) freshness = now - observedMs > this.intervalMs * 2.5 ? 'stale' : 'current';
    return {
      activeNow: active.length > 0,
      boostingNow: active.some((w) => w.kind === 'BOOST'),
      active,
      next: planned[0] ?? null,
      recentFinalised: finalised,
      observedAt: observedMs ? new Date(observedMs).toISOString() : null,
      freshness,
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
    const wasSeeded = this.seeded.has(creds.accountNumber);
    const result = reconcile(prev, planned, ok, completed, Date.now());

    // Transition edges are only meaningful once we have a prior observation:
    // suppress started/ended (and the notification) on the very first poll so an
    // already-active dispatch at startup is seeded silently, never announced as
    // a transition we did not actually observe.
    if (wasSeeded && result.started) {
      const soonest = [...result.activeNow]
        .sort((a, b) => new Date(a.end).getTime() - new Date(b.end).getTime())[0];
      this.fire('dispatch_started', {
        type: soonest?.kind ?? 'unknown',
        end: soonest?.end ? this.fmt(soonest.end) : '',
      });
      if (this.notifyEnabled('notify_dispatch', false)) {
        await this.notify('🚗 Intelligent Octopus Go smart-charge dispatch has started.');
      }
    }
    if (wasSeeded && result.ended) {
      this.fire('dispatch_ended', {});
    }
    // dispatch_cancelled / dispatch_changed: reconcile only populates these from
    // a SUCCESSFUL poll, and only for windows that were still FUTURE at poll time
    // — never fabricated from stale data or from a window merely elapsing.
    if (wasSeeded) {
      for (const w of result.cancelled) {
        this.fire('dispatch_cancelled', {
          type: w.kind, start: this.fmt(w.start), end: this.fmt(w.end),
        });
      }
      for (const w of result.changed) {
        this.fire('dispatch_changed', {
          type: w.kind, start: this.fmt(w.start), end: this.fmt(w.end),
        });
      }
    }
    // Suppress the first completed batch after (re)start to avoid a backfill storm.
    if (wasSeeded) {
      for (const c of result.newlyCompleted) {
        this.fire('dispatch_completed', { end: this.fmt(c.end) });
      }
    }
    // Only seed on a SUCCESSFUL planned poll: a failed poll retains prior state
    // and observes no transition, so the first *successful* poll must seed
    // silently (never announce an already-active dispatch as a fresh "started").
    if (ok) this.seeded.add(creds.accountNumber);
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
    if (ok) {
      this.lastError.delete(creds.accountNumber);
      this.lastObservedAt.set(creds.accountNumber, Date.now());
    }
  }

  private logErrorOnce(creds: { apiKey: string; accountNumber: string }, err: unknown): void {
    // A budget skip is an expected, freshness-preserving skip (retain prior
    // dispatch state), not a fault — do not surface it as an error.
    if (isBudgetError(err)) return;
    const message = this.redact(err, creds.apiKey);
    if (this.lastError.get(creds.accountNumber) !== message) {
      this.lastError.set(creds.accountNumber, message);
      this.app.error('Dispatch poll failed:', message);
    }
  }

  private redact(err: unknown, secret: string): string {
    return redactSecrets(err, [secret]);
  }

  /** Aggregate, identifier-free diagnostics (no account numbers or device ids). */
  private writeDiagnostics(): void {
    let activeAccounts = 0;
    let plannedWindows = 0;
    for (const accountNumber of this.states.keys()) {
      // Recompute "active now" against the clock (same basis as the capability and
      // the dispatch_active condition) rather than the poll-time anyActive flag.
      if (this.getAccountView(accountNumber).activeNow) activeAccounts += 1;
      const state = this.states.get(accountNumber);
      plannedWindows += (state?.windows ?? [])
        .filter((w) => w.state === 'planned' || w.state === 'active').length;
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
