'use strict';

import {
  Rate, ConsumptionRecord, rateAt, valueOf,
} from '../rates';

/**
 * Pure reporting cost helpers, extracted from OctopusMeterDevice (Sprint S60,
 * BL-07 tail). These carry the money maths behind the month-to-date, projected,
 * yesterday and peak/off-peak cost tiles so the trickiest reporting logic is
 * unit-testable in isolation and reusable by BL-18's SettledInsightsService. They
 * are deliberately free of device/Homey/network dependencies: the device supplies
 * resolved rate arrays plus small timezone-bound predicates (isNight/isPeak) and
 * the energy-unit converter, and keeps the fetch + capability-write orchestration.
 *
 * Every record requires an applicable, finite price. Missing coverage is an
 * error, never free consumption. Two-register night records require night rates;
 * they cannot borrow a day rate or an out-of-period night row. All figures are
 * returned in PENCE.
 */

export interface CostOptions {
  incVat: boolean;
  twoRegister: boolean;
  /** Whether an instant falls in the Economy-7 night window (device/tz-bound). */
  isNight: (iso: string) => boolean;
  /** Convert a raw consumption value to the billed energy unit (identity today). */
  toEnergy: (value: number) => number;
}

/** Distinguishes known coverage gaps from transient transport failures. */
export class CostCoverageError extends Error {}

/**
 * The unit rate applicable to a consumption record, honouring Economy-7 day/night
 * registers when the tariff is two-register (mirrors the device's rateForRecord).
 */
export function rateForRecord(
  iso: string, dayRates: Rate[], nightRates: Rate[], opts: Pick<CostOptions, 'twoRegister' | 'isNight'>,
): Rate | null {
  if (opts.twoRegister && opts.isNight(iso)) {
    return rateAt(nightRates, new Date(iso));
  }
  return rateAt(dayRates, new Date(iso));
}

/** A known record and its applicable rate; published zero/negative rates are valid. */
export function recordCostPence(
  record: ConsumptionRecord, rate: Rate | null, toEnergy: CostOptions['toEnergy'], incVat: boolean,
): number {
  if (!Number.isFinite(Date.parse(record.interval_start)) || !Number.isFinite(record.consumption)
    || !rate || !Number.isFinite(valueOf(rate, incVat))) {
    throw new CostCoverageError('Consumption price coverage is unavailable.');
  }
  const energy = toEnergy(record.consumption);
  const cost = energy * valueOf(rate, incVat);
  if (!Number.isFinite(energy) || !Number.isFinite(cost)) throw new CostCoverageError('Consumption cost is unavailable.');
  return cost;
}

/** Energy cost (pence) of a set of consumption records against the given rates. */
export function consumptionCostPence(
  records: ConsumptionRecord[], dayRates: Rate[], nightRates: Rate[], opts: CostOptions,
): number {
  let pence = 0;
  for (const r of records) {
    const rate = rateForRecord(r.interval_start, dayRates, nightRates, opts);
    pence += recordCostPence(r, rate, opts.toEnergy, opts.incVat);
  }
  return pence;
}

/** Energy cost (pence) of records whose interval_start falls in `[startMs, endMs)`. */
export function windowCostPence(
  records: ConsumptionRecord[], startMs: number, endMs: number,
  dayRates: Rate[], nightRates: Rate[], opts: CostOptions,
): number {
  const inWindow = records.filter((r) => {
    const t = new Date(r.interval_start).getTime();
    if (!Number.isFinite(t)) throw new CostCoverageError('Consumption timestamp is unavailable.');
    return t >= startMs && t < endMs;
  });
  return consumptionCostPence(inWindow, dayRates, nightRates, opts);
}

/** Total standing charge (pence) across the supplied per-day sample instants. */
export function standingChargePence(standing: Rate[], sampleTimes: Date[], incVat: boolean): number {
  let pence = 0;
  for (const t of sampleTimes) {
    const sc = rateAt(standing, t);
    if (!Number.isFinite(t.getTime()) || !sc || !Number.isFinite(valueOf(sc, incVat))) {
      throw new CostCoverageError('Standing-charge coverage is unavailable.');
    }
    pence += valueOf(sc, incVat);
  }
  return pence;
}

/**
 * Peak vs off-peak energy cost (pence) for records at/after `sinceMs`, split by
 * the device's timezone-bound `isPeak` predicate (mirrors refreshDayBreakdown).
 */
export function peakOffPeakCostPence(
  records: ConsumptionRecord[], sinceMs: number,
  dayRates: Rate[], nightRates: Rate[], opts: CostOptions, isPeak: (iso: string) => boolean,
): { peak: number; off: number } {
  let peak = 0;
  let off = 0;
  for (const r of records) {
    const t = new Date(r.interval_start).getTime();
    if (!Number.isFinite(t)) throw new CostCoverageError('Consumption timestamp is unavailable.');
    if (t < sinceMs) continue;
    const rate = rateForRecord(r.interval_start, dayRates, nightRates, opts);
    const cost = recordCostPence(r, rate, opts.toEnergy, opts.incVat);
    if (isPeak(r.interval_start)) peak += cost; else off += cost;
  }
  return { peak, off };
}
