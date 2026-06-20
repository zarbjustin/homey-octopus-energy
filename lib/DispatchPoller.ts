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

  /** Whether a smart-charge dispatch is currently in progress. */
  isActive(): boolean {
    return this.active;
  }

  protected async poll(): Promise<void> {
    const creds = this.credentials();
    if (!creds) return;

    let dispatches: Dispatch[] = [];
    try {
      dispatches = await new KrakenClient(creds.apiKey).getPlannedDispatches(creds.accountNumber);
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
  }
}
