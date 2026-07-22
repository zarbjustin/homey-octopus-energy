'use strict';

import { ConsumptionRecord } from '../rates';

/**
 * Settlement-completeness helpers, extracted from OctopusMeterDevice (Sprint S60,
 * BL-07 tail / BL-18 groundwork). "Settled through" must be the end of the
 * CONTIGUOUS run of consumption from the earliest record — NOT the maximum
 * `interval_end`. The naive max jumps past a gap (a missing half-hour followed by
 * a later one), so a billing summary would treat the un-settled hole as settled
 * and misprice the period. This walks the sorted records and stops at the first
 * gap, so the boundary never overstates completeness. Pure and unit-testable.
 */

/**
 * The end instant (ISO) of the contiguous consumption run starting at the
 * earliest record, or null when there are no usable records. Records that abut
 * or overlap (`next.start <= runningEnd`) extend the run; the first gap ends it.
 */
export function contiguousSettledThrough(records: ConsumptionRecord[]): string | null {
  const parsed = records
    .map((r) => ({ start: Date.parse(r.interval_start), end: Date.parse(r.interval_end) }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end))
    .sort((a, b) => a.start - b.start);
  if (!parsed.length) return null;

  let { end } = parsed[0];
  for (let i = 1; i < parsed.length; i += 1) {
    if (parsed[i].start <= end) {
      // Contiguous or overlapping — extend the settled boundary.
      if (parsed[i].end > end) end = parsed[i].end;
    } else {
      break; // gap: consumption after this point is not fully settled
    }
  }
  return new Date(end).toISOString();
}
