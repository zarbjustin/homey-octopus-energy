'use strict';

import Homey from 'homey';
import { KrakenClient } from './KrakenClient';

/**
 * Shared base for app-level account pollers (saving sessions, dispatches).
 * Owns the timer lifecycle, credential lookup, time formatting and Flow firing,
 * so the concrete pollers only implement `poll()`.
 */
export abstract class AccountPoller {

  protected readonly app: Homey.App;

  private timer: NodeJS.Timeout | null = null;

  private polling = false;

  protected abstract readonly intervalMs: number;

  constructor(app: Homey.App) {
    this.app = app;
  }

  start(): void {
    this.stop();
    this.runPoll();
    this.timer = this.app.homey.setInterval(() => {
      this.runPoll();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      this.app.homey.clearInterval(this.timer);
      this.timer = null;
    }
  }

  protected abstract poll(): Promise<void>;

  protected kraken(creds: { apiKey: string; accountNumber: string }): KrakenClient {
    const app = this.app as Homey.App & {
      getKrakenClient?(apiKey: string, accountNumber: string): KrakenClient;
    };
    return app.getKrakenClient?.(creds.apiKey, creds.accountNumber)
      ?? new KrakenClient(creds.apiKey, creds.accountNumber);
  }

  private runPoll(): void {
    if (this.polling) return;
    this.polling = true;
    this.poll()
      .catch((err) => this.app.error('Poll failed:', err))
      .finally(() => {
        this.polling = false;
      });
  }

  /** Collect one credential set per distinct account across all meter devices. */
  protected accounts(): Array<{ apiKey: string; accountNumber: string }> {
    const accounts = new Map<string, { apiKey: string; accountNumber: string }>();
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
        if (apiKey && accountNumber && !accounts.has(accountNumber)) {
          accounts.set(accountNumber, { apiKey, accountNumber });
        }
      }
    }
    return [...accounts.values()];
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
