'use strict';

import { AccountPoller } from './AccountPoller';
import { KrakenClient, SavingSession } from './KrakenClient';

interface PollerState {
  known: string[];
  started: string[];
  ended: string[];
  feStarted?: string[];
  feEnded?: string[];
}

/**
 * Polls Octopus "Saving Sessions" + Free Electricity for the account and fires
 * app-level Flow triggers. Best-effort: any error yields no triggers that cycle.
 */
export class SavingSessionsPoller extends AccountPoller {

  protected readonly intervalMs = 15 * 60_000;

  protected async poll(): Promise<void> {
    for (const creds of this.accounts()) {
      // Keep account state writes ordered and deterministic.
      // eslint-disable-next-line no-await-in-loop
      await this.pollAccount(creds);
    }
  }

  private async pollAccount(creds: { apiKey: string; accountNumber: string }): Promise<void> {
    let sessions: SavingSession[] = [];
    try {
      sessions = await new KrakenClient(creds.apiKey).getSavingSessions(creds.accountNumber);
    } catch (err) {
      return; // Account may not support saving sessions.
    }

    const allState = (this.app.homey.settings.get('saving_sessions_state_v2') || {}) as Record<string, PollerState>;
    const state: PollerState = allState[creds.accountNumber]
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
    allState[creds.accountNumber] = {
      known: trim(state.known),
      started: trim(state.started),
      ended: trim(state.ended),
      feStarted: trim(state.feStarted),
      feEnded: trim(state.feEnded),
    };
    this.app.homey.settings.set('saving_sessions_state_v2', allState);
  }
}
