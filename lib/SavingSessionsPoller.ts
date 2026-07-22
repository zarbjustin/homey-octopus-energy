'use strict';

import { AccountPoller } from './AccountPoller';
import { SavingSession } from './KrakenClient';
import { isBudgetError } from './KrakenBudget';
import { opaqueKey, opaqueKeyMigrating } from './diagnosticsKey';
import { redactSecrets, maskAccount as maskAccountId } from './redact';

interface PollerState {
  known: string[];
  started: string[];
  ended: string[];
  startingSoon?: string[];
  feKnown?: string[];
  feStartingSoon?: string[];
  feStarted?: string[];
  feEnded?: string[];
  feActiveUntil?: number;
}

interface PollDiagnostics {
  lastAttempt: string;
  lastSuccess?: string;
  lastError?: string;
  sessionCount?: number;
  freeElectricityCount?: number;
  freeElectricityLastError?: string;
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
    const client = this.kraken(creds);
    const attemptedAt = new Date().toISOString();
    let sessions: SavingSession[] = [];
    try {
      sessions = await client.getSavingSessions(creds.accountNumber);
    } catch (err) {
      // A budget skip is an expected, freshness-preserving skip — record the
      // attempt and clear any prior error (it is not currently failing).
      if (isBudgetError(err)) {
        const previous = this.diagnosticFor(creds.accountNumber);
        this.updateDiagnostics(creds.accountNumber, {
          ...previous, lastAttempt: attemptedAt, lastError: undefined,
        });
        return;
      }
      const message = this.errorMessage(err, creds.apiKey);
      const previous = this.diagnosticFor(creds.accountNumber);
      if (previous?.lastError !== message) {
        this.app.error(`Saving Sessions poll failed for ${this.maskAccount(creds.accountNumber)}:`, err);
      }
      this.updateDiagnostics(creds.accountNumber, {
        ...previous,
        lastAttempt: attemptedAt,
        lastError: message,
      });
      return;
    }

    const allState = (this.app.homey.settings.get('saving_sessions_state_v2') || {}) as Record<string, PollerState>;
    const stateKey = opaqueKeyMigrating(this.app.homey, allState as Record<string, unknown>, creds.accountNumber);
    const state: PollerState = allState[stateKey]
      || { known: [], started: [], ended: [] };
    state.feStarted = state.feStarted ?? [];
    state.feEnded = state.feEnded ?? [];
    state.feKnown = state.feKnown ?? [];
    state.feStartingSoon = state.feStartingSoon ?? [];
    state.startingSoon = state.startingSoon ?? [];
    const now = Date.now();

    for (const s of sessions) {
      const start = new Date(s.startAt).getTime();
      const end = new Date(s.endAt).getTime();
      const tokens = { start: this.fmt(s.startAt), end: this.fmt(s.endAt), reward: s.rewardPerKwh };

      if (!state.known.includes(s.id)) {
        state.known.push(s.id);
        this.fire('saving_session_announced', tokens);
      }
      if (s.joined === false) continue;
      if (now < start) {
        const minutesUntil = Math.round((start - now) / 60_000);
        if (minutesUntil <= 245) {
          // De-dup: fire at most once per session per 15-minute bucket. This
          // preserves the per-Flow lead-time window (listener gates on
          // minutesUntil) while suppressing duplicate fires from an extra poll
          // or app restart landing inside the same window.
          const soonKey = `${s.id}:${Math.floor(minutesUntil / 15)}`;
          if (!state.startingSoon.includes(soonKey)) {
            state.startingSoon.push(soonKey);
            this.fire('saving_session_starting_soon', tokens, { minutesUntil });
          }
        }
      }
      if (now >= start && now < end && !state.started.includes(s.id)) {
        state.started.push(s.id);
        this.fire('saving_session_started', { end: tokens.end, reward: tokens.reward });
        const enabled = this.app.homey.settings.get('notify_saving_sessions');
        if (enabled === undefined || enabled === null || enabled) {
          this.app.homey.notifications.createNotification({
            excerpt: this.app.homey.__('notification.saving_session_started'),
          }).catch((err) => this.app.error('Notification failed:', err));
        }
      }
      if (now >= end && !state.ended.includes(s.id)) {
        state.ended.push(s.id);
        this.fire('saving_session_ended', {});
      }
    }

    // Free Electricity sessions (best-effort, separate from Saving Sessions).
    let freeElectricityCount = 0;
    let freeElectricityLastError: string | undefined;
    try {
      const fe = await client.getFreeElectricitySessions(creds.accountNumber);
      freeElectricityCount = fe.length;
      let feActiveUntil = 0;
      for (const s of fe) {
        const start = new Date(s.startAt).getTime();
        const end = new Date(s.endAt).getTime();
        const feTokens = { start: this.fmt(s.startAt), end: this.fmt(s.endAt) };
        if (now >= start && now < end) feActiveUntil = Math.max(feActiveUntil, end);

        if (!state.feKnown.includes(s.id)) {
          state.feKnown.push(s.id);
          this.fire('free_electricity_announced', feTokens);
        }
        if (now < start) {
          const minutesUntil = Math.round((start - now) / 60_000);
          if (minutesUntil <= 245) {
            // Same per-15-minute-bucket de-dup as saving sessions (see BL-20):
            // preserves per-Flow lead times while suppressing restart/extra-poll
            // duplicates.
            const soonKey = `${s.id}:${Math.floor(minutesUntil / 15)}`;
            if (!state.feStartingSoon.includes(soonKey)) {
              state.feStartingSoon.push(soonKey);
              this.fire('free_electricity_starting_soon', feTokens, { minutesUntil });
            }
          }
        }
        if (now >= start && now < end && !state.feStarted.includes(s.id)) {
          state.feStarted.push(s.id);
          this.fire('free_electricity_started', { end: this.fmt(s.endAt) });
          const enabled = this.app.homey.settings.get('notify_free_electricity');
          if (enabled === undefined || enabled === null || enabled) {
            this.app.homey.notifications.createNotification({
              excerpt: this.app.homey.__('notification.free_electricity_started'),
            }).catch((err) => this.app.error('Notification failed:', err));
          }
        }
        if (now >= end && !state.feEnded.includes(s.id)) {
          state.feEnded.push(s.id);
          this.fire('free_electricity_ended', {});
        }
      }
      state.feActiveUntil = feActiveUntil;
    } catch (err) {
      // Free Electricity is not enabled for every account; retain the status for diagnostics.
      freeElectricityLastError = this.errorMessage(err, creds.apiKey);
    }

    // Keep the persisted id lists bounded.
    const trim = (arr: string[]) => arr.slice(-50);
    allState[stateKey] = {
      known: trim(state.known),
      started: trim(state.started),
      ended: trim(state.ended),
      startingSoon: trim(state.startingSoon),
      feKnown: trim(state.feKnown),
      feStartingSoon: trim(state.feStartingSoon),
      feStarted: trim(state.feStarted),
      feEnded: trim(state.feEnded),
      feActiveUntil: state.feActiveUntil,
    };
    this.app.homey.settings.set('saving_sessions_state_v2', allState);
    this.updateDiagnostics(creds.accountNumber, {
      lastAttempt: attemptedAt,
      lastSuccess: new Date().toISOString(),
      sessionCount: sessions.length,
      freeElectricityCount,
      freeElectricityLastError,
    });
  }

  private diagnostics(): Record<string, PollDiagnostics> {
    return (this.app.homey.settings.get('saving_sessions_diagnostics_v1') || {}) as Record<string, PollDiagnostics>;
  }

  /** Current diagnostic for an account, tolerant of a not-yet-migrated raw key. */
  private diagnosticFor(accountNumber: string): PollDiagnostics | undefined {
    const all = this.diagnostics();
    return all[opaqueKey(this.app.homey, accountNumber)] ?? all[accountNumber];
  }

  private updateDiagnostics(accountNumber: string, value: PollDiagnostics): void {
    const all = this.diagnostics();
    const key = opaqueKeyMigrating(this.app.homey, all as Record<string, unknown>, accountNumber);
    all[key] = value;
    this.app.homey.settings.set('saving_sessions_diagnostics_v1', all);
  }

  private errorMessage(err: unknown, secret: string): string {
    return redactSecrets(err, [secret]);
  }

  private maskAccount(accountNumber: string): string {
    return maskAccountId(accountNumber);
  }
}
