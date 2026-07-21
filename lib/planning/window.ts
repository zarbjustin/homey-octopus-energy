'use strict';

import { Rate, valueOf } from '../rates';

/**
 * Pure rate-window planning helpers, extracted from OctopusMeterDevice
 * (Phase 2 / S52 slice 5). These compute the token/condition values the device
 * exposes (tonight's cheapest/most-expensive upcoming price, the rate horizon,
 * and the cheapest-percentile condition) without any device/Homey dependency,
 * so they are unit-testable in isolation. VAT-inclusive selection is passed in;
 * local-time formatting stays on the device.
 */

/** The furthest-ahead instant covered by the cached rates (ms), or 0. An
 *  open-ended row (no valid_to) is treated as a single 30-minute slot. */
export function computeRatesHorizon(rates: Rate[]): number {
  let max = 0;
  for (const r of rates) {
    const end = r.valid_to
      ? new Date(r.valid_to).getTime()
      : new Date(r.valid_from).getTime() + 1800_000;
    if (end > max) max = end;
  }
  return max;
}

export interface UpcomingExtremes {
  cheapest: number;
  /** ISO instant of the cheapest upcoming slot's start (caller formats to local). */
  cheapestStartIso: string;
  expensive: number;
}

/** Cheapest / most expensive upcoming rate values (p/kWh, 2dp) among rows still
 *  in effect at or after `nowMs`, or null when nothing lies ahead. An open-ended
 *  row (no valid_to) is always considered still in effect. */
export function computeUpcomingExtremes(
  rates: Rate[],
  nowMs: number,
  incVat: boolean,
): UpcomingExtremes | null {
  const fwd = rates.filter((r) => {
    const end = r.valid_to ? new Date(r.valid_to).getTime() : Infinity;
    return end > nowMs;
  });
  if (!fwd.length) return null;
  let cheapest = fwd[0];
  let expensive = fwd[0];
  for (const r of fwd) {
    if (valueOf(r, incVat) < valueOf(cheapest, incVat)) cheapest = r;
    if (valueOf(r, incVat) > valueOf(expensive, incVat)) expensive = r;
  }
  return {
    cheapest: Number(valueOf(cheapest, incVat).toFixed(2)),
    cheapestStartIso: cheapest.valid_from,
    expensive: Number(valueOf(expensive, incVat).toFixed(2)),
  };
}

/** Whether `current`'s price sits within the cheapest `percent`% of the given
 *  window of rates. Rank counts rows at or below the current price; `percent`
 *  is clamped to [0, 100]. Returns false for an empty window. */
export function isWithinCheapestPercentile(
  windowRates: Rate[],
  current: Rate,
  incVat: boolean,
  percent: number,
): boolean {
  if (!windowRates.length) return false;
  const cv = valueOf(current, incVat);
  const rank = windowRates.filter((r) => valueOf(r, incVat) <= cv).length;
  const pct = (rank / windowRates.length) * 100;
  return pct <= Math.max(0, Math.min(100, percent));
}
