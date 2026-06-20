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

  private active = false;

  private currentEnd: string | null = null;

  private completed = new Set<string>();

  /** Whether a smart-charge dispatch is currently in progress. */
  isActive(): boolean {
    return this.active;
  }

  protected async poll(): Promise<void> {
    const creds = this.credentials();
    if (!creds) return;

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

    if (nowActive && !this.active) {
      this.currentEnd = current ? current.end : null;
      this.fire('dispatch_started', { end: this.currentEnd ? this.fmt(this.currentEnd) : '' });
      if (this.notifyEnabled('notify_dispatch', false)) {
        await this.notify('🚗 Intelligent Octopus Go smart-charge dispatch has started.');
      }
    } else if (!nowActive && this.active) {
      this.fire('dispatch_ended', {});
      this.currentEnd = null;
    }
    this.active = nowActive;

    // Completed dispatches → fire once per newly-seen completed window.
    try {
      const done = await client.getCompletedDispatches(creds.accountNumber);
      for (const d of done) {
        const key = `${d.start}|${d.end}`;
        if (!this.completed.has(key)) {
          this.completed.add(key);
          // Avoid firing on the very first poll for historical completions.
          if (this.completed.size <= 50 && this.seededCompleted) {
            this.fire('dispatch_completed', { end: this.fmt(d.end) });
          }
        }
      }
      this.seededCompleted = true;
      if (this.completed.size > 100) {
        this.completed = new Set(Array.from(this.completed).slice(-50));
      }
    } catch (err) {
      // No completed-dispatch support — ignore.
    }
  }

  private seededCompleted = false;
}
