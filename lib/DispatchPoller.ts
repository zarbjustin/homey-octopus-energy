'use strict';

import Homey from 'homey';
import { KrakenClient, Dispatch } from './KrakenClient';

/**
 * Polls Intelligent Octopus Go planned dispatches and fires app-level Flow
 * triggers when a smart-charge dispatch starts/ends. Exposes `isActive()` for a
 * Flow condition. Best-effort: errors / non-IOG accounts yield no triggers.
 */
export class DispatchPoller {

  private readonly app: Homey.App;

  private timer: NodeJS.Timeout | null = null;

  private active = false;

  private currentEnd: string | null = null;

  constructor(app: Homey.App) {
    this.app = app;
  }

  start(): void {
    this.stop();
    this.poll().catch((err) => this.app.error('Dispatch poll failed:', err));
    this.timer = this.app.homey.setInterval(() => {
      this.poll().catch((err) => this.app.error('Dispatch poll failed:', err));
    }, 5 * 60_000);
  }

  stop(): void {
    if (this.timer) {
      this.app.homey.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Whether a smart-charge dispatch is currently in progress. */
  isActive(): boolean {
    return this.active;
  }

  private credentials(): { apiKey: string; accountNumber: string } | null {
    for (const driverId of ['electricity', 'export', 'gas']) {
      let driver: Homey.Driver;
      try {
        driver = this.app.homey.drivers.getDriver(driverId);
      } catch (err) {
        continue;
      }
      for (const device of driver.getDevices()) {
        const apiKey = device.getStoreValue('apiKey');
        const accountNumber = device.getStoreValue('accountNumber');
        if (apiKey && accountNumber) return { apiKey, accountNumber };
      }
    }
    return null;
  }

  private fmt(iso: string): string {
    const tz = this.app.homey.clock.getTimezone();
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
    }).format(new Date(iso));
  }

  private fire(id: string, tokens: Record<string, unknown>): void {
    try {
      this.app.homey.flow.getTriggerCard(id).trigger(tokens).catch((err) => this.app.error(`Trigger ${id} failed:`, err));
    } catch (err) {
      // Card not defined — ignore.
    }
  }

  async poll(): Promise<void> {
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
      if (this.app.homey.settings.get('notify_dispatch')) {
        this.app.homey.notifications.createNotification({
          excerpt: '🚗 Intelligent Octopus Go smart-charge dispatch has started.',
        }).catch((err) => this.app.error('Notification failed:', err));
      }
    } else if (!nowActive && this.active) {
      this.fire('dispatch_ended', {});
      this.currentEnd = null;
    }
    this.active = nowActive;
  }
}
