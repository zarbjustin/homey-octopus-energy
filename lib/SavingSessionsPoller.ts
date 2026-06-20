'use strict';

import Homey from 'homey';
import { KrakenClient, SavingSession } from './KrakenClient';

interface PollerState {
  known: string[];
  started: string[];
  ended: string[];
  feStarted?: string[];
  feEnded?: string[];
}

/**
 * Polls Octopus "Saving Sessions" for the account and fires app-level Flow
 * triggers (announced / starting soon / started / ended). Credentials are
 * borrowed from the first added meter device. Best-effort: any error simply
 * results in no triggers for that cycle.
 */
export class SavingSessionsPoller {

  private readonly app: Homey.App;

  private timer: NodeJS.Timeout | null = null;

  constructor(app: Homey.App) {
    this.app = app;
  }

  start(): void {
    this.stop();
    this.poll().catch((err) => this.app.error('Saving sessions poll failed:', err));
    this.timer = this.app.homey.setInterval(() => {
      this.poll().catch((err) => this.app.error('Saving sessions poll failed:', err));
    }, 15 * 60_000);
  }

  stop(): void {
    if (this.timer) {
      this.app.homey.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private credentials(): { apiKey: string; accountNumber: string } | null {
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

  private fmt(iso: string): string {
    const tz = this.app.homey.clock.getTimezone();
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
    }).format(new Date(iso));
  }

  private fire(id: string, tokens: Record<string, unknown>, state: Record<string, unknown> = {}): void {
    try {
      this.app.homey.flow.getTriggerCard(id).trigger(tokens, state).catch((err) => this.app.error(`Trigger ${id} failed:`, err));
    } catch (err) {
      // Card not defined — ignore.
    }
  }

  async poll(): Promise<void> {
    const creds = this.credentials();
    if (!creds) return;

    let sessions: SavingSession[] = [];
    try {
      sessions = await new KrakenClient(creds.apiKey).getSavingSessions(creds.accountNumber);
    } catch (err) {
      return; // Account may not support saving sessions.
    }

    const state: PollerState = this.app.homey.settings.get('saving_sessions_state')
      || { known: [], started: [], ended: [] };
    state.feStarted = state.feStarted ?? [];
    state.feEnded = state.feEnded ?? [];
    const now = Date.now();

    for (const s of sessions) {
      const start = new Date(s.startAt).getTime();
      const end = new Date(s.endAt).getTime();
      const tokens = { start: this.fmt(s.startAt), end: this.fmt(s.endAt), reward: s.rewardPerKwh };

      if (!state.known.includes(s.id)) {
        state.known.push(s.id);
        this.fire('saving_session_announced', tokens);
      }
      if (now < start) {
        const minutesUntil = Math.round((start - now) / 60_000);
        if (minutesUntil <= 245) {
          this.fire('saving_session_starting_soon', tokens, { minutesUntil });
        }
      }
      if (now >= start && now < end && !state.started.includes(s.id)) {
        state.started.push(s.id);
        this.fire('saving_session_started', { end: tokens.end, reward: tokens.reward });
        const enabled = this.app.homey.settings.get('notify_saving_sessions');
        if (enabled === undefined || enabled === null || enabled) {
          this.app.homey.notifications.createNotification({
            excerpt: '🐙 Octopus Saving Session has started — reduce usage to earn OctoPoints.',
          }).catch((err) => this.app.error('Notification failed:', err));
        }
      }
      if (now >= end && !state.ended.includes(s.id)) {
        state.ended.push(s.id);
        this.fire('saving_session_ended', {});
      }
    }

    // Free Electricity sessions (best-effort, separate from Saving Sessions).
    try {
      const fe = await new KrakenClient(creds.apiKey).getFreeElectricitySessions(creds.accountNumber);
      for (const s of fe) {
        const start = new Date(s.startAt).getTime();
        const end = new Date(s.endAt).getTime();
        if (now >= start && now < end && !state.feStarted.includes(s.id)) {
          state.feStarted.push(s.id);
          this.fire('free_electricity_started', { end: this.fmt(s.endAt) });
        }
        if (now >= end && !state.feEnded.includes(s.id)) {
          state.feEnded.push(s.id);
          this.fire('free_electricity_ended', {});
        }
      }
    } catch (err) {
      // No free-electricity support — ignore.
    }

    // Keep the persisted id lists bounded.
    const trim = (arr: string[]) => arr.slice(-50);
    this.app.homey.settings.set('saving_sessions_state', {
      known: trim(state.known),
      started: trim(state.started),
      ended: trim(state.ended),
      feStarted: trim(state.feStarted),
      feEnded: trim(state.feEnded),
    });
  }
}
