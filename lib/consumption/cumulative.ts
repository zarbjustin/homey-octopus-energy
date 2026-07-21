'use strict';

import { ConsumptionRecord, sumConsumption } from '../rates';

/**
 * The single cumulative-meter writer, extracted from OctopusMeterDevice
 * (Phase 2 / S52 slice 4). Centralising this read-modify-write in one pure
 * function removes the double-count / lost-delta risk (R-004 / BL-08) from the
 * device and makes the monotonic-total arithmetic testable in isolation. Unit
 * conversion is injected so the gas/electricity/export subclasses keep their
 * own scaling without this module depending on the device.
 */
export interface CumulativeUpdate {
  /** New value for the `lastConsumptionEnd` cursor (the newest interval_end). */
  cursorIso: string;
  /** New value for the `cumulativeMeter` running total (kWh or m³). */
  cumulative: number;
}

/**
 * Compute the next cumulative meter reading and cursor from freshly-fetched
 * consumption records, given the persisted cursor and prior running total.
 *
 * `sortedRecords` MUST be sorted ascending by interval_start (as the device
 * sorts them). Only records whose `interval_end` is strictly after the cursor
 * are added, so overlapping fetch windows never double-count. Returns `null`
 * when there is nothing newer than the cursor to add — the caller should then
 * leave the stored total untouched.
 *
 * Rounds the running total to 3 dp to match the meter capability's precision
 * and avoid unbounded floating-point drift across refreshes.
 */
export function computeCumulativeUpdate(
  sortedRecords: ConsumptionRecord[],
  persistedEndIso: string | null,
  priorCumulative: number,
  toMeterUnit: (raw: number) => number,
): CumulativeUpdate | null {
  if (!sortedRecords.length) return null;
  const lastEnd = persistedEndIso ? new Date(persistedEndIso).getTime() : 0;
  const fresh = sortedRecords.filter((r) => new Date(r.interval_end).getTime() > lastEnd);
  if (!fresh.length) return null;
  const add = toMeterUnit(sumConsumption(fresh));
  const cumulative = Number((priorCumulative + add).toFixed(3));
  return { cursorIso: sortedRecords[sortedRecords.length - 1].interval_end, cumulative };
}
