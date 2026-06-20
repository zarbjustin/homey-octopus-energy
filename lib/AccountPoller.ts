'use strict';

import Homey from 'homey';

/**
 * Shared base for app-level account pollers (saving sessions, dispatches).
 * Owns the timer lifecycle, credential lookup, time formatting and Flow firing,
 * so the concrete pollers only implement `poll()`.
 */
export abstract class AccountPoller {

  protected readonly app: Homey.App;

  private timer: NodeJS.Timeout | null = null;

  protected abstract readonly intervalMs: number;

  constructor(app: Homey.App) {
    this.app = app;
  }

  start(): void {
    this.stop();
    this.poll().catch((err) => this.app.error('Poll failed:', err));
    this.timer = this.app.homey.setInterval(() => {
      this.poll().catch((err) => this.app.error('Poll failed:', err));
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      this.app.homey.clearInterval(this.timer);
      this.timer = null;
    }
  }

  protected abstract poll(): Promise<void>;

  /** Borrow API credentials from the first added meter device. */
  protected credentials(): { apiKey: string; accountNumber: string } | null {
    for (const driverId of ['electricity', 'gas', 'export']) {
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

  protected fmt(iso: string): string {
    const tz = this.app.homey.clock.getTimezone();
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
    }).format(new Date(iso));
  }

  protected fire(id: string, tokens: Record<string, unknown>, state: Record<string, unknown> = {}): void {
    try {
      this.app.homey.flow.getTriggerCard(id).trigger(tokens, state).catch((err) => this.app.error(`Trigger ${id} failed:`, err));
    } catch (err) {
      // Card not defined — ignore.
    }
  }

  protected notifyEnabled(key: string, def = false): boolean {
    const v = this.app.homey.settings.get(key);
    return (v === undefined || v === null) ? def : Boolean(v);
  }

  protected async notify(excerpt: string): Promise<void> {
    try {
      await this.app.homey.notifications.createNotification({ excerpt });
    } catch (err) {
      this.app.error('Notification failed:', err);
    }
  }
}
