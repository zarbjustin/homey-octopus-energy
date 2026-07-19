'use strict';

import { KrakenClient } from './KrakenClient';
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

export interface LiveDemandDeps {
  getClient(creds: LiveDemandCreds): KrakenClient;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  now(): number;
  onError(message: string, err?: unknown): void;
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
      };
      this.accounts.set(creds.accountNumber, state);
    }
    state.creds = creds;
    const first = state.subscribers.size === 0;
    state.subscribers.set(subscriberId, onUpdate);
    onUpdate(state.reading); // hand the newcomer the latest snapshot immediately
    if (first) {
      state.timer = this.deps.setInterval(() => this.tick(creds.accountNumber), this.cadenceMs);
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
    return this.accounts.get(accountNumber)?.reading ?? null;
  }

  /** Drop cached device id / reading after a credential change. */
  invalidate(accountNumber: string): void {
    const state = this.accounts.get(accountNumber);
    if (!state) return;
    state.deviceId = null;
    state.deviceIdResolved = false;
    state.discoveryBackoffUntil = 0;
    state.reading = unknownReading<number>();
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
    this.pollAccount(accountNumber).catch(() => { /* handled in doPoll */ });
  }

  /** Poll one account, single-flighted so overlapping ticks collapse to one. */
  async pollAccount(accountNumber: string): Promise<void> {
    const state = this.accounts.get(accountNumber);
    if (!state) return;
    if (!state.inflight) {
      state.inflight = this.doPoll(state).finally(() => {
        state.inflight = null;
      });
    }
    await state.inflight;
  }

  private async doPoll(state: AccountState): Promise<void> {
    const now = this.deps.now();
    if (!state.deviceIdResolved) {
      if (now < state.discoveryBackoffUntil) return;
      try {
        const client = this.deps.getClient(state.creds);
        state.deviceId = await client.getElectricityDeviceId(state.creds.accountNumber);
        state.deviceIdResolved = true;
      } catch (err) {
        this.deps.onError('Live demand device discovery failed', err);
        this.markStale(state);
        return;
      }
    }
    if (!state.deviceId) {
      // No Home Mini on this account: retain "unknown" and back off discovery so
      // we do not waste the shared budget re-asking every cadence.
      state.reading = unknownReading<number>();
      state.deviceIdResolved = false;
      state.discoveryBackoffUntil = now + DISCOVERY_BACKOFF_MS;
      this.emit(state);
      return;
    }
    try {
      const client = this.deps.getClient(state.creds);
      const { demand, readAt } = await client.getDemandReading(state.deviceId);
      if (demand === null) {
        this.markStale(state);
        return;
      }
      const at = readAt ?? new Date(now).toISOString();
      const reading = currentReading<number>(demand, at, 'graphql');
      // A returned-but-old sample is stale, not current.
      reading.state = isStale(at, this.cadenceMs, now) ? 'stale' : 'current';
      state.reading = reading;
      this.emit(state);
    } catch (err) {
      this.deps.onError('Live demand refresh failed', err);
      this.markStale(state);
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
        this.deps.onError('Live demand subscriber failed', err);
      }
    }
  }
}
