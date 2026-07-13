'use strict';

import { AccountPoller } from './AccountPoller';
import { KrakenClient, Dispatch } from './KrakenClient';

/**
 * Polls Intelligent Octopus Go planned dispatches and fires app-level Flow
 * triggers when a smart-charge dispatch starts/ends. Exposes `isActive()` for a
 * Flow condition. Best-effort: errors / non-IOG accounts yield no triggers.
 */
export class DispatchPoller extends AccountPoller {

  protected readonly intervalMs = 5 * 60_000;

  private activeAccounts = new Set<string>();

  private currentEnds = new Map<string, string>();

  private completed = new Map<string, Set<string>>();

  private seededCompleted = new Set<string>();

  /** Whether a smart-charge dispatch is currently in progress. */
  isActive(): boolean {
    return this.activeAccounts.size > 0;
  }

  protected async poll(): Promise<void> {
    const accounts = this.accounts();
    const configured = new Set(accounts.map((account) => account.accountNumber));
    for (const account of this.activeAccounts) {
      if (!configured.has(account)) this.activeAccounts.delete(account);
    }
    await Promise.all(accounts.map((creds) => this.pollAccount(creds)));
  }

  private async pollAccount(creds: { apiKey: string; accountNumber: string }): Promise<void> {
    const knownEnd = this.currentEnds.get(creds.accountNumber);
    if (knownEnd && new Date(knownEnd).getTime() <= Date.now()) {
      this.activeAccounts.delete(creds.accountNumber);
      this.currentEnds.delete(creds.accountNumber);
      this.fire('dispatch_ended', {});
    }
    const client = new KrakenClient(creds.apiKey);
    let dispatches: Dispatch[] = [];
    try {
      dispatches = await client.getPlannedDispatches(creds.accountNumber);
    } catch (err) {
      return;
    }

    const now = Date.now();
    const current = dispatches.find((d) => {
      const start = new Date(d.start).getTime();
      const end = new Date(d.end).getTime();
      return now >= start && now < end;
    });
    const nowActive = Boolean(current);
    const wasActive = this.activeAccounts.has(creds.accountNumber);

    if (nowActive && !wasActive) {
      if (current) this.currentEnds.set(creds.accountNumber, current.end);
      this.activeAccounts.add(creds.accountNumber);
      this.fire('dispatch_started', { end: current ? this.fmt(current.end) : '' });
      if (this.notifyEnabled('notify_dispatch', false)) {
        await this.notify('🚗 Intelligent Octopus Go smart-charge dispatch has started.');
      }
    } else if (!nowActive && wasActive) {
      this.fire('dispatch_ended', {});
      this.activeAccounts.delete(creds.accountNumber);
      this.currentEnds.delete(creds.accountNumber);
    }

    // Completed dispatches → fire once per newly-seen completed window.
    try {
      const done = await client.getCompletedDispatches(creds.accountNumber);
      const completed = this.completed.get(creds.accountNumber) ?? new Set<string>();
      const seeded = this.seededCompleted.has(creds.accountNumber);
      for (const d of done) {
        const key = `${d.start}|${d.end}`;
        if (!completed.has(key)) {
          completed.add(key);
          if (seeded) this.fire('dispatch_completed', { end: this.fmt(d.end) });
        }
      }
      this.seededCompleted.add(creds.accountNumber);
      this.completed.set(creds.accountNumber, new Set(Array.from(completed).slice(-100)));
    } catch (err) {
      // No completed-dispatch support — ignore.
    }
  }
}
