'use strict';

import { DispatchWindow, DispatchKind } from './types';

/**
 * Pure dispatch reconciliation (Sprint 43). Network/Homey-free so DST, overlap,
 * cancellation and fail-closed behaviour are unit-testable in isolation.
 *
 * All interval comparisons use absolute instants, so daylight-saving transitions
 * are handled by construction. The reconciler NEVER infers a cancellation or an
 * "ended" edge from a failed/absent poll — only a *successful* poll that omits a
 * previously-planned future window marks it cancelled.
 */

export interface PlannedInput {
  deviceId: string;
  start: string;
  end: string;
  kind: DispatchKind;
}

export interface CompletedInput {
  start: string;
  end: string;
  delta: number | null;
}

export interface ReconcileState {
  windows: DispatchWindow[];
  anyActive: boolean;
  /** Max completed-window end (ms) already seen — the completed high-water mark. */
  lastCompletedEnd: number;
}

export interface ReconcileResult {
  windows: DispatchWindow[];
  activeNow: DispatchWindow[];
  anyActive: boolean;
  lastCompletedEnd: number;
  /** Aggregate rising edge (0 -> >=1 active). Never true on a stale/failed poll. */
  started: boolean;
  /** Aggregate falling edge (>=1 -> 0 active). Never true on a stale/failed poll. */
  ended: boolean;
  /** Previously-planned windows, still FUTURE at poll time, that a successful
   *  poll omitted — a genuine cancellation. Never inferred from a failed/absent
   *  poll, and never for a window that has already elapsed (ambiguous:
   *  completed vs cancelled). */
  cancelled: DispatchWindow[];
  /** Still-FUTURE planned windows whose end or kind changed vs the prior plan
   *  (same device + start) — a genuine reschedule, not a window elapsing or a
   *  new/removed window. */
  changed: DispatchWindow[];
  newlyCompleted: CompletedInput[];
  /** Planned data was unavailable this cycle; prior windows were retained. */
  stale: boolean;
}

function windowKey(deviceId: string | null, start: string): string {
  return `${deviceId ?? '-'}|${start}`;
}

function ms(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : NaN;
}

export function reconcile(
  prev: ReconcileState,
  planned: PlannedInput[],
  plannedOk: boolean,
  completed: CompletedInput[] | null,
  now: number,
): ReconcileResult {
  let windows: DispatchWindow[];
  const cancelled: DispatchWindow[] = [];
  const changed: DispatchWindow[] = [];
  let stale = false;

  if (!plannedOk) {
    // Fail closed: retain prior windows, never derive cancellation/ended from
    // absence of data.
    stale = true;
    windows = prev.windows.map((w) => ({ ...w }));
  } else {
    const fresh: DispatchWindow[] = [];
    for (const p of planned) {
      const s = ms(p.start);
      const e = ms(p.end);
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue; // drop malformed
      const active = now >= s && now < e;
      let state: DispatchWindow['state'] = 'planned';
      if (active) state = 'active';
      else if (now >= e) state = 'completed';
      fresh.push({
        deviceId: p.deviceId,
        kind: p.kind,
        start: p.start,
        end: p.end,
        state,
        provenance: 'planned',
        confidence: p.kind === 'unknown' ? 'low' : 'medium',
        delta: null,
      });
    }
    const freshByKey = new Map(fresh.map((w) => [windowKey(w.deviceId, w.start), w]));
    for (const w of prev.windows) {
      // Only reason about windows that were still FUTURE at this poll — a
      // previously-planned window that has already elapsed is ambiguous
      // (completed vs cancelled), so we never claim it was cancelled/changed.
      if (w.state !== 'planned' || ms(w.start) <= now) continue;
      const match = freshByKey.get(windowKey(w.deviceId, w.start));
      if (!match) {
        cancelled.push({ ...w, state: 'cancelled' });
      } else if (match.end !== w.end || match.kind !== w.kind) {
        changed.push({ ...match });
      }
    }
    windows = fresh;
  }

  const activeNow = windows.filter((w) => w.state === 'active');
  const anyActive = stale ? prev.anyActive : activeNow.length > 0;
  const started = !stale && anyActive && !prev.anyActive;
  const ended = !stale && !anyActive && prev.anyActive;

  // Completed dispatches: fire only for windows newer than the high-water mark.
  // O(1) state — never re-fires an old completion regardless of history size.
  let { lastCompletedEnd } = prev;
  const newlyCompleted: CompletedInput[] = [];
  if (completed) {
    const ordered = [...completed].sort((a, b) => new Date(a.end).getTime() - new Date(b.end).getTime());
    for (const c of ordered) {
      if (!c.start || !c.end) continue;
      const e = ms(c.end);
      if (!Number.isFinite(e)) continue;
      if (e > prev.lastCompletedEnd) newlyCompleted.push(c);
      if (e > lastCompletedEnd) lastCompletedEnd = e;
    }
  }

  return {
    windows,
    activeNow,
    anyActive,
    lastCompletedEnd,
    started,
    ended,
    cancelled,
    changed,
    newlyCompleted,
    stale,
  };
}
