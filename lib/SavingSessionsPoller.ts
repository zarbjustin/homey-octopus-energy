'use strict';

import { AccountPoller } from './AccountPoller';
import { isBudgetError } from './KrakenBudget';
import { opaqueKey, opaqueKeyMigrating } from './diagnosticsKey';
import { redactSecrets } from './redact';
import { reconcileSessions, SessionLedger, SessionEmission } from './sessionLifecycle';

const SESSION_CARDS = {
  saving_session: {
    announced: 'saving_session_announced',
    starting_soon: 'saving_session_starting_soon',
    started: 'saving_session_started',
    ended: 'saving_session_ended',
  },
  free_electricity: {
    announced: 'free_electricity_announced',
    starting_soon: 'free_electricity_starting_soon',
    started: 'free_electricity_started',
    ended: 'free_electricity_ended',
  },
};

interface PollerState extends SessionLedger {
  feKnown?: string[];
  feStartingSoon?: string[];
  feStarted?: string[];
  feEnded?: string[];
  feRecords?: SessionLedger['records'];
  feActiveUntil?: number;
}

interface PollDiagnostics {
  lastAttempt: string;
  lastSuccess?: string;
  lastError?: string;
  sessionCount?: number;
  freeElectricityCount?: number;
  freeElectricityLastError?: string;
  saving?: ReturnType<typeof reconcileSessions>['counts'];
  freeElectricity?: ReturnType<typeof reconcileSessions>['counts'];
  triggerAttempts?: number;
}

/** Account-scoped, persisted at-most-once lifecycle attempts; no historical replay. */
export class SavingSessionsPoller extends AccountPoller {

  protected readonly intervalMs = 15 * 60_000;

  protected async poll(): Promise<void> {
    for (const creds of this.accounts()) {
      // Keep writes ordered; failed persistence cannot emit or block siblings.
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.pollAccount(creds);
      } catch (err) {
        this.app.error('Session persistence failed; lifecycle attempts suppressed:',
          redactSecrets(err, [creds.apiKey, creds.accountNumber]));
      }
    }
  }

  private async pollAccount(creds: { apiKey: string; accountNumber: string }): Promise<void> {
    const client = this.kraken(creds);
    const attemptedAt = new Date().toISOString();
    let sessions;
    try {
      sessions = await client.getSavingSessions(creds.accountNumber);
    } catch (err) {
      const previous = this.diagnosticFor(creds.accountNumber);
      const message = isBudgetError(err) ? undefined
        : redactSecrets(err, [creds.apiKey, creds.accountNumber]);
      if (message && previous?.lastError !== message) this.app.error('Saving Sessions poll failed:', message);
      this.updateDiagnostics(creds.accountNumber, { ...previous, lastAttempt: attemptedAt, lastError: message });
      return;
    }
    const stored = this.app.homey.settings.get('saving_sessions_state_v2');
    const validRoot = stored && typeof stored === 'object' && !Array.isArray(stored);
    const allState = (validRoot ? structuredClone(stored) : {}) as Record<string, PollerState>;
    const key = opaqueKeyMigrating(this.app.homey, allState as Record<string, unknown>, creds.accountNumber);
    const state = allState[key];
    const corrupt = (!!stored && !validRoot) || (!!state && (!Array.isArray(state.known)
      || !Array.isArray(state.started) || !Array.isArray(state.ended)));
    const saving = reconcileSessions(sessions, state, Date.now(), corrupt);
    let free: ReturnType<typeof reconcileSessions> | undefined;
    let freeElectricityLastError: string | undefined;
    try {
      const sessionsFree = await client.getFreeElectricitySessions(creds.accountNumber);
      free = reconcileSessions(sessionsFree, state ? {
        records: state.feRecords,
        known: state.feKnown,
        started: state.feStarted,
        ended: state.feEnded,
        startingSoon: state.feStartingSoon,
      } : undefined, Date.now(), corrupt);
    } catch (err) {
      freeElectricityLastError = redactSecrets(err, [creds.apiKey, creds.accountNumber]);
    }
    allState[key] = {
      ...state,
      ...saving.ledger,
      ...(free ? {
        feRecords: free.ledger.records,
        feKnown: free.ledger.known,
        feStartingSoon: free.ledger.startingSoon,
        feStarted: free.ledger.started,
        feEnded: free.ledger.ended,
        feActiveUntil: free.activeUntil,
      } : {}),
    };
    // Persist before dispatch: a failed write emits nothing; a failed Flow is never retried.
    this.app.homey.settings.set('saving_sessions_state_v2', allState);
    for (const event of saving.emissions) this.emitSession('saving_session', event);
    for (const event of free?.emissions || []) this.emitSession('free_electricity', event);
    this.updateDiagnostics(creds.accountNumber, {
      lastAttempt: attemptedAt,
      lastSuccess: new Date().toISOString(),
      sessionCount: sessions.length,
      freeElectricityCount: free?.counts.returned,
      freeElectricityLastError,
      saving: saving.counts,
      freeElectricity: free?.counts,
      triggerAttempts: saving.emissions.length + (free?.emissions.length || 0),
    });
  }

  private emitSession(prefix: 'saving_session' | 'free_electricity', event: SessionEmission): void {
    const r = event.session;
    const tokens: Record<string, string | number> = {};
    if (event.kind === 'announced' || event.kind === 'starting_soon') {
      tokens.start = this.fmt(new Date(r.start).toISOString());
    }
    if (event.kind !== 'ended') {
      tokens.end = this.fmt(new Date(r.end).toISOString());
      if (prefix === 'saving_session') tokens.reward = r.reward;
    }
    this.fire(SESSION_CARDS[prefix][event.kind], tokens,
      event.minutesUntil === undefined ? undefined : { minutesUntil: event.minutesUntil });
    if (event.kind === 'started') {
      const setting = prefix === 'saving_session' ? 'notify_saving_sessions' : 'notify_free_electricity';
      const enabled = this.app.homey.settings.get(setting);
      if (enabled === undefined || enabled === null || enabled) {
        this.app.homey.notifications.createNotification({
          excerpt: this.app.homey.__(`notification.${prefix}_started`),
        }).catch(() => this.app.error('Session notification attempt failed'));
      }
    }
  }

  private diagnostics(): Record<string, PollDiagnostics> {
    return structuredClone(this.app.homey.settings.get('saving_sessions_diagnostics_v1') || {});
  }

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
}
