'use strict';

import { KrakenClient, KrakenApiError, KrakenFieldError } from './KrakenClient';
import { accountRetryAt, isBudgetError } from './KrakenBudget';
import {
  Reading, unknownReading, currentReading, staleFrom, isStale,
} from './freshness';

/**
 * Shared, account-scoped live Home Mini demand source (Sprint 42).
 *
 * One poll loop per account runs ONLY while at least one device is subscribed,
 * de-duplicating what used to be a 30s-per-device timer. Values are delivered as
 * `Reading<number>` so consumers can tell a fresh reading from a retained stale
 * one. All Kraken calls flow through the shared request budget (in KrakenClient).
 *
 * Dependencies are injected so the subscription/timer logic is unit-testable
 * without Homey.
 */

export interface LiveDemandCreds {
  apiKey: string;
  accountNumber: string;
}

export type LiveDemandListener = (reading: Reading<number>) => void;

export interface LiveDemandStatus {
  reason: 'unknown' | 'current' | 'stale' | 'rate-limited' | 'budget-limited' | 'no-device' | 'provider-error' | 'empty-telemetry' | 'invalid-demand' | 'invalid-timestamp';
  retryAt: string | null;
}

const COUNTERS = [
  'polls', 'coalesced', 'cooldownSkips', 'discoveryBackoffSkips', 'budgetSkips', 'discoveryAttempts',
  'demandAttempts', 'emptyReadings', 'invalidReadings', 'staleReadings', 'currentReadings', 'providerErrors', 'subscriberErrors',
] as const;
type Counters = Record<typeof COUNTERS[number], number>;
type ErrorKind = 'none' | 'budget' | 'throttled' | 'authentication' | 'field' | 'transport' | 'other';

export interface MiniDiagnostics {
  schemaVersion: 1;
  observedAt: string;
  cadenceSeconds: number;
  activeAccounts: number;
  truncated: boolean;
  accounts: Array<{
    account: number; subscribers: number; timerActive: boolean; inFlight: boolean;
    discovery: 'not-attempted' | 'found' | 'not-found' | 'failed';
    reason: LiveDemandStatus['reason']; readingState: Reading<number>['state'];
    lastPollAt: string | null; lastDiscoveryAt: string | null; lastDemandAt: string | null;
    lastResponseAt: string | null; lastSuccessAt: string | null; readingAt: string | null;
    nextDiscoveryAt: string | null; nextPollAt: string | null; cooldownUntil: string | null;
    lastErrorKind: ErrorKind;
    inFlightSince: string | null;
    counters: Counters;
  }>;
}

export interface LiveDemandDeps {
  getClient(creds: LiveDemandCreds): KrakenClient;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  now(): number;
  onError(message: string, err?: unknown): void;
  onDiagnostics?(snapshot: MiniDiagnostics): void;
}

interface AccountState {
  creds: LiveDemandCreds;
  subscribers: Map<string, LiveDemandListener>;
  timer: unknown | null;
  reading: Reading<number>;
  deviceId: string | null;
  deviceIdResolved: boolean;
  inflight: Promise<void> | null;
  discoveryBackoffUntil: number;
  reason: LiveDemandStatus['reason'];
  discovery: MiniDiagnostics['accounts'][number]['discovery'];
  counters: Counters;
  lastPollAt: string | null;
  lastDiscoveryAt: string | null;
  lastDemandAt: string | null;
  lastResponseAt: string | null;
  lastSuccessAt: string | null;
  generation: number;
  nextPollAt: string | null;
  lastErrorKind: ErrorKind;
  inFlightSince: string | null;
}

const ALLOWED_CADENCE = [60, 120, 300];
const DEFAULT_CADENCE = 120;
const DISCOVERY_BACKOFF_MS = 30 * 60_000;

function clampCadence(seconds: number): number {
  return ALLOWED_CADENCE.includes(seconds) ? seconds : DEFAULT_CADENCE;
}

export class LiveDemandSource {

  private readonly accounts = new Map<string, AccountState>();

  private cadenceMs: number;

  private lastDiagnosticAt: number | null = null;

  constructor(private readonly deps: LiveDemandDeps, cadenceSeconds: number = DEFAULT_CADENCE) {
    this.cadenceMs = clampCadence(cadenceSeconds) * 1000;
  }

  /** Change the poll cadence (60/120/300s) and reschedule active loops. */
  setCadenceSeconds(seconds: number): void {
    const next = clampCadence(seconds) * 1000;
    if (next === this.cadenceMs) return;
    this.cadenceMs = next;
    for (const [accountNumber, state] of this.accounts) {
      if (state.timer !== null) {
        this.deps.clearInterval(state.timer);
        state.timer = this.deps.setInterval(() => this.tick(accountNumber), this.cadenceMs);
        state.nextPollAt = new Date(this.deps.now() + this.cadenceMs).toISOString();
      }
    }
  }

  /** Register a device's interest in live demand for its account. */
  subscribe(creds: LiveDemandCreds, subscriberId: string, onUpdate: LiveDemandListener): void {
    let state = this.accounts.get(creds.accountNumber);
    if (!state) {
      state = {
        creds,
        subscribers: new Map(),
        timer: null,
        reading: unknownReading<number>(),
        deviceId: null,
        deviceIdResolved: false,
        inflight: null,
        discoveryBackoffUntil: 0,
        reason: 'unknown',
        discovery: 'not-attempted',
        counters: Object.fromEntries(COUNTERS.map((key) => [key, 0])) as Counters,
        lastPollAt: null,
        lastDiscoveryAt: null,
        lastDemandAt: null,
        lastResponseAt: null,
        lastSuccessAt: null,
        generation: 0,
        nextPollAt: null,
        lastErrorKind: 'none',
        inFlightSince: null,
      };
      this.accounts.set(creds.accountNumber, state);
    }
    if (state.creds.apiKey !== creds.apiKey) this.invalidate(creds.accountNumber);
    state.creds = creds;
    const first = state.subscribers.size === 0;
    state.subscribers.set(subscriberId, onUpdate);
    try {
      onUpdate(this.getLiveDemand(creds.accountNumber) ?? unknownReading<number>());
    } catch {
      state.counters.subscriberErrors += 1;
    }
    if (first) {
      state.timer = this.deps.setInterval(() => this.tick(creds.accountNumber), this.cadenceMs);
      state.nextPollAt = new Date(this.deps.now() + this.cadenceMs).toISOString();
      this.pollAccount(creds.accountNumber).catch(() => { /* handled in doPoll */ });
    }
  }

  /** Remove a subscriber; the last one to leave stops the account's poll loop. */
  unsubscribe(accountNumber: string, subscriberId: string): void {
    const state = this.accounts.get(accountNumber);
    if (!state) return;
    state.subscribers.delete(subscriberId);
    if (state.subscribers.size === 0) {
      if (state.timer !== null) this.deps.clearInterval(state.timer);
      this.accounts.delete(accountNumber);
    }
  }

  /** The latest reading for an account, or null if no subscribers. */
  getLiveDemand(accountNumber: string): Reading<number> | null {
    const reading = this.accounts.get(accountNumber)?.reading;
    if (!reading) return null;
    return reading.state === 'current' && isStale(reading.readAt, this.cadenceMs, this.deps.now())
      ? staleFrom(reading) : { ...reading };
  }

  /** Presentation only: reading this never polls or resets the shared gate. */
  getStatus(accountNumber: string): LiveDemandStatus | null {
    const state = this.accounts.get(accountNumber);
    if (!state) return null;
    const retryAt = accountRetryAt(accountNumber);
    if (retryAt) return { reason: 'rate-limited', retryAt };
    const reading = this.getLiveDemand(accountNumber);
    const { reason: lastReason } = state;
    const reason = lastReason === 'current' && reading?.state !== 'current' ? 'stale' : lastReason;
    return { reason, retryAt: null };
  }

  hasSubscriber(accountNumber: string, subscriberId: string): boolean {
    return this.accounts.get(accountNumber)?.subscribers.has(subscriberId) ?? false;
  }

  /** Allowlisted cached metadata only: no keys, IDs, power values or raw errors. */
  diagnostics(): MiniDiagnostics {
    const now = this.deps.now();
    return {
      schemaVersion: 1,
      observedAt: new Date(now).toISOString(),
      cadenceSeconds: this.cadenceMs / 1000,
      activeAccounts: this.accounts.size,
      truncated: this.accounts.size > 5,
      accounts: [...this.accounts.entries()].slice(0, 5).map(([account, state], index) => ({
        account: index + 1,
        subscribers: state.subscribers.size,
        timerActive: state.timer !== null,
        inFlight: state.inflight !== null,
        discovery: state.discovery,
        reason: this.getStatus(account)?.reason ?? 'unknown',
        readingState: this.getLiveDemand(account)?.state ?? 'unknown',
        lastPollAt: state.lastPollAt,
        lastDiscoveryAt: state.lastDiscoveryAt,
        lastDemandAt: state.lastDemandAt,
        lastResponseAt: state.lastResponseAt,
        lastSuccessAt: state.lastSuccessAt,
        readingAt: state.reading.readAt,
        nextDiscoveryAt: state.discoveryBackoffUntil > now ? new Date(state.discoveryBackoffUntil).toISOString() : null,
        cooldownUntil: accountRetryAt(account),
        nextPollAt: state.nextPollAt,
        lastErrorKind: state.lastErrorKind,
        inFlightSince: state.inFlightSince,
        counters: { ...state.counters },
      })),
    };
  }

  private reportDiagnostics(): void {
    const now = this.deps.now();
    if (this.lastDiagnosticAt !== null && now - this.lastDiagnosticAt < 300000) return;
    this.lastDiagnosticAt = now;
    try {
      this.deps.onDiagnostics?.(this.diagnostics());
    } catch { /* Support telemetry must never stop live polling. */ }
  }

  /** Drop cached device id / reading after a credential change. */
  invalidate(accountNumber: string): void {
    const state = this.accounts.get(accountNumber);
    if (!state) return;
    state.deviceId = null;
    state.deviceIdResolved = false;
    state.discoveryBackoffUntil = 0;
    state.reading = unknownReading<number>();
    state.reason = 'unknown';
    state.discovery = 'not-attempted';
    state.generation += 1;
  }

  /** Number of accounts currently being polled (diagnostics). */
  activeAccounts(): number {
    return this.accounts.size;
  }

  /** Stop every poll loop (app shutdown). */
  stopAll(): void {
    for (const state of this.accounts.values()) {
      if (state.timer !== null) this.deps.clearInterval(state.timer);
    }
    this.accounts.clear();
  }

  private tick(accountNumber: string): void {
    const state = this.accounts.get(accountNumber);
    if (state) state.nextPollAt = new Date(this.deps.now() + this.cadenceMs).toISOString();
    this.pollAccount(accountNumber).catch(() => { /* handled in doPoll */ });
  }

  /** Poll one account, single-flighted so overlapping ticks collapse to one. */
  async pollAccount(accountNumber: string): Promise<void> {
    const state = this.accounts.get(accountNumber);
    if (!state) return;
    state.counters.polls += 1;
    state.lastPollAt = new Date(this.deps.now()).toISOString();
    if (!state.inflight) {
      state.inFlightSince = new Date(this.deps.now()).toISOString();
      state.inflight = this.doPoll(state).finally(() => {
        state.inflight = null;
        state.inFlightSince = null;
        this.reportDiagnostics();
      });
    } else {
      state.counters.coalesced += 1;
      if (state.inFlightSince && this.deps.now() - Date.parse(state.inFlightSince) >= 300000) this.reportDiagnostics();
    }
    await state.inflight;
  }

  private async doPoll(state: AccountState): Promise<void> {
    const now = this.deps.now();
    const { generation, creds } = state;
    const active = () => this.accounts.get(creds.accountNumber) === state && generation === state.generation;
    // No discovery/demand attempt while ANY Kraken consumer has opened this
    // account's cooldown. Existing cadence performs recovery; no new timer.
    if (accountRetryAt(state.creds.accountNumber)) {
      state.reason = 'rate-limited';
      state.counters.cooldownSkips += 1;
      this.markStale(state);
      return;
    }
    if (!state.deviceIdResolved) {
      if (now < state.discoveryBackoffUntil) {
        state.counters.discoveryBackoffSkips += 1;
        return;
      }
      try {
        state.counters.discoveryAttempts += 1;
        state.lastDiscoveryAt = new Date(this.deps.now()).toISOString();
        const client = this.deps.getClient(state.creds);
        const deviceId = await client.getElectricityDeviceId(state.creds.accountNumber);
        if (!active()) return;
        state.deviceId = deviceId;
        state.deviceIdResolved = true;
        state.discovery = deviceId ? 'found' : 'not-found';
      } catch (err) {
        if (!active()) return;
        state.discovery = 'failed';
        this.recordFailure(state, err);
        if (!isBudgetError(err)) this.deps.onError(`Live demand device discovery failed (${state.lastErrorKind})`);
        this.markStale(state);
        return;
      }
    }
    if (!state.deviceId) {
      // No Home Mini on this account: retain "unknown" and back off discovery so
      // we do not waste the shared budget re-asking every cadence.
      state.reading = unknownReading<number>();
      state.reason = 'no-device';
      state.deviceIdResolved = false;
      state.discoveryBackoffUntil = now + DISCOVERY_BACKOFF_MS;
      this.emit(state);
      return;
    }
    try {
      state.counters.demandAttempts += 1;
      state.lastDemandAt = new Date(this.deps.now()).toISOString();
      const client = this.deps.getClient(state.creds);
      const { demand, readAt, outcome } = await client.getDemandReading(state.deviceId);
      if (!active()) return;
      state.lastResponseAt = new Date(this.deps.now()).toISOString();
      state.lastErrorKind = 'none';
      if (demand === null) {
        state.reason = outcome === 'invalid-demand' ? 'invalid-demand' : 'empty-telemetry';
        if (state.reason === 'invalid-demand') state.counters.invalidReadings += 1;
        else state.counters.emptyReadings += 1;
        this.markStale(state);
        return;
      }
      // A receipt time cannot stand in for an absent/invalid measurement time.
      const parsed = readAt ? Date.parse(readAt) : NaN;
      if (!Number.isFinite(demand) || !Number.isFinite(parsed) || parsed > this.deps.now()) {
        state.reason = Number.isFinite(demand) ? 'invalid-timestamp' : 'invalid-demand';
        state.counters.invalidReadings += 1;
        this.markStale(state);
        return;
      }
      const at = new Date(parsed).toISOString();
      const reading = currentReading<number>(demand, at, 'graphql');
      // A returned-but-old sample is stale, not current.
      reading.state = isStale(at, this.cadenceMs, this.deps.now()) ? 'stale' : 'current';
      state.reading = reading;
      state.reason = reading.state === 'current' ? 'current' : 'stale';
      if (reading.state === 'current') {
        state.counters.currentReadings += 1;
        state.lastSuccessAt = new Date(this.deps.now()).toISOString();
      } else state.counters.staleReadings += 1;
      this.emit(state);
    } catch (err) {
      if (!active()) return;
      this.recordFailure(state, err);
      // A budget skip just means "keep the last reading, marked stale" — it is an
      // expected protection of the shared account budget, not a fault to surface.
      if (!isBudgetError(err)) this.deps.onError(`Live demand refresh failed (${state.lastErrorKind})`);
      this.markStale(state);
    }
  }

  private recordFailure(state: AccountState, err: unknown): void {
    if (isBudgetError(err)) state.counters.budgetSkips += 1;
    else state.counters.providerErrors += 1;
    if (err instanceof KrakenApiError && err.status === 429) state.reason = 'rate-limited';
    else state.reason = isBudgetError(err) ? 'budget-limited' : 'provider-error';
    state.lastErrorKind = 'other';
    if (isBudgetError(err)) state.lastErrorKind = 'budget';
    else if (err instanceof KrakenFieldError) state.lastErrorKind = 'field';
    else if (err instanceof KrakenApiError) {
      if (err.status === 429) state.lastErrorKind = 'throttled';
      else if ([401, 403].includes(err.status)) state.lastErrorKind = 'authentication';
      else state.lastErrorKind = 'transport';
    }
  }

  private markStale(state: AccountState): void {
    state.reading = staleFrom(state.reading);
    this.emit(state);
  }

  private emit(state: AccountState): void {
    for (const cb of state.subscribers.values()) {
      try {
        cb(state.reading);
      } catch (err) {
        state.counters.subscriberErrors += 1;
        this.deps.onError('Live demand subscriber failed');
      }
    }
  }
}
