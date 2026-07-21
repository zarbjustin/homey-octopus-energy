'use strict';

/**
 * Foundation F0 — a shared, account-scoped request budget for the Kraken GraphQL
 * API.
 *
 * The Kraken API enforces a strict hourly request budget *per account that is
 * shared across every app* touching it (Octopus's own app, other integrations,
 * and this app). Left unmanaged, aggressive polling — e.g. live power once every
 * 30s per device — throttles the whole account and breaks core refreshes.
 *
 * This module provides one token bucket per account, consulted from the single
 * network choke point (`KrakenClient.post`). Because pollers and devices can each
 * build their own `KrakenClient`, the buckets live in a process-module registry
 * keyed by account rather than on any client instance.
 *
 * Target: <= ~90 requests/hour/account (leaving headroom under the ~100–125/hr
 * shared cap for Octopus's own app).
 */

export type KrakenPriority = 'core' | 'live' | 'best';

/** Thrown when a non-core request cannot be admitted under the budget. */
export class BudgetError extends Error {
  readonly budgetSkip = true;

  constructor(message = 'Kraken request budget exhausted; skipping to protect the account rate limit.') {
    super(message);
    this.name = 'BudgetError';
  }
}

/** Whether an error is a budget skip (a soft "retain freshness", not a fault). */
export function isBudgetError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { budgetSkip?: unknown }).budgetSkip === true);
}

export interface BudgetSnapshot {
  tokens: number;
  gated: boolean;
  penalties: number;
}

/** Identifier-free per-priority admission counters (for settings diagnostics). */
export interface BudgetCounters {
  coreAdmitted: number;
  liveAdmitted: number;
  bestAdmitted: number;
  liveDenied: number;
  bestDenied: number;
  gatedDenied: number;
}

type Clock = () => number;

const CAPACITY = 6; // burst
const REFILL_PER_SEC = 90 / 3600; // ~0.025 tokens/s => <= 90/hour sustained
const MAX_BACKOFF_MS = 15 * 60_000;
// Bounded core debt: core is never blocked (outside a 429 gate), but its debt to
// the shared pool is capped so a core burst cannot starve live/best for longer
// than one refill of this reserve. Kept small (< CAPACITY) so live/best recover
// within ~CORE_DEBT_FLOOR/refill seconds after a core burst; sustained core rate
// is held well under budget by request coalescing/caching, not by blocking core.
const CORE_DEBT_FLOOR = -2;

/**
 * A refilling token bucket with an account-level backoff gate for HTTP 429.
 * Core requests are never blocked except while the 429 gate is active; they may
 * drive the balance slightly negative (rare) and refill absorbs it, keeping the
 * long-run rate at the refill ceiling.
 */
export class TokenBucket {

  private tokens: number;

  private lastRefill: number;

  private backoffUntil = 0;

  private penalties = 0;

  private readonly counters: BudgetCounters = {
    coreAdmitted: 0, liveAdmitted: 0, bestAdmitted: 0, liveDenied: 0, bestDenied: 0, gatedDenied: 0,
  };

  constructor(
    private readonly now: Clock = Date.now,
    private readonly capacity: number = CAPACITY,
    private readonly refillPerSec: number = REFILL_PER_SEC,
    private readonly coreDebtFloor: number = CORE_DEBT_FLOOR,
  ) {
    this.tokens = capacity;
    this.lastRefill = now();
  }

  private refill(): void {
    const t = this.now();
    const elapsed = (t - this.lastRefill) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
      this.lastRefill = t;
    }
  }

  /** Whether the account is currently in a 429 backoff window. */
  get gated(): boolean {
    return this.now() < this.backoffUntil;
  }

  /**
   * Try to admit one request. Core requests are admitted whenever the gate is
   * clear; live/best requests require an available token.
   */
  acquire(priority: KrakenPriority): boolean {
    this.refill();
    if (this.gated) {
      this.counters.gatedDenied += 1;
      return false;
    }
    if (priority === 'core') {
      // Core is never blocked (outside a 429 gate) but its debt is bounded to
      // CORE_DEBT_FLOOR so a rare burst cannot starve live/best for longer than
      // that reserve's refill window.
      this.tokens = Math.max(this.tokens - 1, this.coreDebtFloor);
      this.counters.coreAdmitted += 1;
      return true;
    }
    if (this.tokens >= 1) {
      this.tokens -= 1;
      if (priority === 'live') this.counters.liveAdmitted += 1; else this.counters.bestAdmitted += 1;
      return true;
    }
    if (priority === 'live') this.counters.liveDenied += 1; else this.counters.bestDenied += 1;
    return false;
  }

  /** Record a rate-limit rejection: open an exponential backoff gate + drain. */
  penalise(): void {
    this.penalties += 1;
    const base = Math.min(30_000 * 2 ** (this.penalties - 1), MAX_BACKOFF_MS);
    const jitter = base * (0.8 + Math.random() * 0.4);
    this.backoffUntil = this.now() + jitter;
    if (this.tokens > 0) this.tokens = 0;
  }

  /**
   * A successful request clears the backoff escalation — but must NOT lift a
   * currently-active 429 gate, since an in-flight request admitted before the
   * rate limit can complete successfully during the cool-down.
   */
  reward(): void {
    if (this.gated) return;
    this.penalties = 0;
    this.backoffUntil = 0;
  }

  snapshot(): BudgetSnapshot {
    this.refill();
    return { tokens: Math.floor(this.tokens), gated: this.gated, penalties: this.penalties };
  }

  /** Identifier-free per-priority admission counters (cumulative since creation). */
  getCounters(): BudgetCounters {
    return { ...this.counters };
  }
}

const registry = new Map<string, TokenBucket>();
let clock: Clock = Date.now;

/** Override the clock (tests only). */
export function setBudgetClock(fn: Clock): void {
  clock = fn;
}

/** Get (or lazily create) the token bucket for an account key. */
export function getBucket(accountKey: string): TokenBucket {
  let bucket = registry.get(accountKey);
  if (!bucket) {
    bucket = new TokenBucket(clock);
    registry.set(accountKey, bucket);
    // Bound the registry the same way the app bounds its account maps.
    while (registry.size > 20) {
      const oldest = registry.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      registry.delete(oldest);
    }
  }
  return bucket;
}

/** Aggregate, identifier-free snapshot for diagnostics. */
export function budgetDiagnostics(): {
  accounts: number; gated: number; minTokens: number | null; counters: BudgetCounters;
  } {
  let gated = 0;
  let minTokens: number | null = null;
  const counters: BudgetCounters = {
    coreAdmitted: 0, liveAdmitted: 0, bestAdmitted: 0, liveDenied: 0, bestDenied: 0, gatedDenied: 0,
  };
  for (const bucket of registry.values()) {
    const snap = bucket.snapshot();
    if (snap.gated) gated += 1;
    minTokens = minTokens === null ? snap.tokens : Math.min(minTokens, snap.tokens);
    const c = bucket.getCounters();
    counters.coreAdmitted += c.coreAdmitted;
    counters.liveAdmitted += c.liveAdmitted;
    counters.bestAdmitted += c.bestAdmitted;
    counters.liveDenied += c.liveDenied;
    counters.bestDenied += c.bestDenied;
    counters.gatedDenied += c.gatedDenied;
  }
  return {
    accounts: registry.size, gated, minTokens, counters,
  };
}

/** Drop a single account's bucket (credential change) or reset all (tests). */
export function resetBudget(accountKey?: string): void {
  if (accountKey) registry.delete(accountKey);
  else registry.clear();
}
