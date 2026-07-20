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
  cancelled: DispatchWindow[];
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
    const freshKeys = new Set(fresh.map((w) => windowKey(w.deviceId, w.start)));
    for (const w of prev.windows) {
      if (w.state === 'planned' && !freshKeys.has(windowKey(w.deviceId, w.start))) {
        cancelled.push({ ...w, state: 'cancelled' });
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
    newlyCompleted,
    stale,
  };
}
