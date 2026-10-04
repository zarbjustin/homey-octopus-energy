'use strict';

import { isBudgetError } from './KrakenBudget';

export interface RecoveryState {
  failures: number;
  retryAt: number;
  authBlocked: boolean;
  status: number | null;
}

/** No timers or requests: consulted only by existing scheduled acquisition. */
export class BackgroundRecovery {

  private states = new Map<string, RecoveryState>();

  constructor(saved?: unknown) {
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
    for (const [key, value] of Object.entries(saved).slice(0, 16)) {
      const s = value as RecoveryState;
      if (s && Number.isFinite(s.failures) && s.failures >= 0
        && Number.isFinite(s.retryAt) && typeof s.authBlocked === 'boolean'
        && (s.status === null || Number.isFinite(s.status))) this.states.set(key, { ...s });
    }
  }

  allowed(area: string, now = Date.now()): boolean {
    const state = this.states.get(area);
    return !state || (!state.authBlocked && now >= state.retryAt);
  }

  state(area: string): RecoveryState | undefined {
    return this.states.get(area);
  }

  success(area: string): void {
    this.states.delete(area);
  }

  failure(area: string, err: unknown, now = Date.now()): void {
    if (isBudgetError(err)) return; // Kraken's account-wide gate remains authoritative.
    const e = err as { status?: number; retryAfterMs?: number; name?: string } | null;
    const status = typeof e?.status === 'number' ? e.status : null;
    const authBlocked = status === 401 || status === 403;
    const transient = status === 0 || status === 429 || (status !== null && status >= 500)
      || err instanceof TypeError || e?.name === 'AbortError';
    if (!authBlocked && !transient) return;
    const failures = Math.min(10, (this.states.get(area)?.failures ?? 0) + 1);
    const delay = Math.min(30 * 60_000, 5 * 60_000 * 2 ** (failures - 1));
    const retryAfter = Number.isFinite(e?.retryAfterMs) ? Math.max(0, e!.retryAfterMs!) : 0;
    this.states.set(area, {
      failures, retryAt: now + Math.max(delay, retryAfter), authBlocked, status,
    });
  }

  snapshot(): Record<string, RecoveryState> {
    return Object.fromEntries([...this.states].map(([key, value]) => [key, { ...value }]));
  }
}
