'use strict';

import { Rate } from '../rates';

/**
 * Pure Intelligent Octopus Go (IOG) schedule helpers, extracted from
 * OctopusMeterDevice (Phase 2 / S52 slice 3). These convert the account's
 * GraphQL agreement data into the `Rate[]` shape the rest of the app prices
 * against. They are deliberately free of device/Homey/network dependencies so
 * the trickiest IOG pricing logic — the area behind the community 156860
 * incident — is unit-testable in isolation.
 */

/** A half-hourly unit rate as carried on a HalfHourlyTariff agreement. */
export interface IogUnitRate {
  validFrom: string;
  validTo: string | null;
  valueIncVat: number;
  valuePreVat: number;
  /** Register/band, e.g. STANDARD, OFF_PEAK, ECO7_NIGHT. Optional (older callers
   *  and fixtures may omit it). */
  rateType?: string | null;
}

/** Household DAY-band rate types (the standard/peak import rate). EV-device and
 *  half-hourly-market-guarantee (HMC) types are deliberately excluded — they are
 *  not the whole-home import price. */
const IOG_DAY_RATE_TYPES = new Set(['STANDARD', 'PEAK', 'ECO7_DAY', 'WEEKDAY']);
/** Household OFF-PEAK (night) band rate types — the guaranteed cheap window. */
const IOG_NIGHT_RATE_TYPES = new Set(['OFF_PEAK', 'ECO7_NIGHT']);

/** The two-band household rates from a DayNight/FourRateEv IOG agreement. */
export interface IogDayNightRates {
  dayRate: number;
  nightRate: number;
  preVatDayRate: number;
  preVatNightRate: number;
}

/**
 * Map a HalfHourlyTariff agreement's authoritative half-hourly rows directly to
 * `Rate[]`. These ARE the price series (like Agile REST rows) — IOG is commonly
 * published this way with an empty public REST feed, so they must be used as a
 * first-class source, never synthesised and never deferred to REST.
 */
export function iogUnitRatesToRates(unitRates: IogUnitRate[]): Rate[] {
  return unitRates.map((r) => ({
    value_inc_vat: r.valueIncVat,
    value_exc_vat: r.valuePreVat,
    valid_from: r.validFrom,
    valid_to: r.validTo,
    payment_method: null,
  }));
}

/**
 * The distinct inc-VAT values carried by a HalfHourlyTariff's `unitRates`.
 *
 * Intelligent Octopus Go is frequently published as a HalfHourlyTariff whose
 * `unitRates` carry ONLY the single standard/day rate (e.g. 28.86p) — the
 * guaranteed 23:30–05:30 off-peak band (e.g. 6.90p) is delivered via the
 * account's day/night schedule and smart-charge dispatches, NOT as distinct
 * settlement rows here. Counting distinct values lets the caller tell a genuine
 * multi-band half-hourly series apart from that flat single-rate case so it does
 * not price the whole day at the standard rate. Values are rounded to 4 dp to
 * avoid float dust producing spurious "distinct" bands.
 */
export function distinctIncVatValues(unitRates: IogUnitRate[]): number[] {
  const seen = new Set<number>();
  for (const r of unitRates) {
    if (typeof r.valueIncVat === 'number' && Number.isFinite(r.valueIncVat)) {
      seen.add(Number(r.valueIncVat.toFixed(4)));
    }
  }
  return [...seen];
}

/**
 * True when a HalfHourlyTariff's `unitRates` carry a single distinct rate (the
 * flat IOG case above). An empty series is NOT flat — there is simply no base to
 * synthesise from, so the caller must not treat it as flat.
 */
export function isFlatUnitRates(unitRates: IogUnitRate[]): boolean {
  return distinctIncVatValues(unitRates).length === 1;
}

/**
 * The single base (day) rate pair from a flat HalfHourly series, or null when
 * the series is not flat / has no finite rows. Used as the DAY band when
 * synthesising a two-band schedule from a configured night rate.
 */
export function iogFlatDayRate(unitRates: IogUnitRate[]): { inc: number; exc: number } | null {
  if (!isFlatUnitRates(unitRates)) return null;
  const row = unitRates.find((r) => Number.isFinite(r.valueIncVat) && Number.isFinite(r.valuePreVat));
  if (!row) return null;
  return { inc: row.valueIncVat, exc: row.valuePreVat };
}

/**
 * Synthesise a half-hourly day/night `Rate[]` across `[fromMs, toMs)` from an
 * authoritative two-band IOG agreement, using `isNight` to pick the band for
 * each slot start. Only valid when the agreement's schedule is trusted
 * (DayNight/FourRateEv) — callers must not synthesise from placeholder rates.
 */
export function synthesiseIogDayNightRates(
  tariff: IogDayNightRates,
  fromMs: number,
  toMs: number,
  isNight: (slotStart: Date) => boolean,
): Rate[] {
  const rates: Rate[] = [];
  for (let start = fromMs; start < toMs; start += 30 * 60_000) {
    const end = start + 30 * 60_000;
    const night = isNight(new Date(start));
    rates.push({
      value_inc_vat: night ? tariff.nightRate : tariff.dayRate,
      value_exc_vat: night ? tariff.preVatNightRate : tariff.preVatDayRate,
      valid_from: new Date(start).toISOString(),
      valid_to: new Date(end).toISOString(),
      payment_method: null,
    });
  }
  return rates;
}

/**
 * The value of the row for a set of rate types that is effective at `asOfMs` —
 * the row covering that instant (validFrom ≤ asOf < validTo, or open-ended),
 * else the most-recent already-started row. Future-dated rows (an upcoming
 * scheduled price change) are NEVER selected to price the current period.
 * Returns null when no matching row has started yet.
 */
function activeBandValue(
  unitRates: IogUnitRate[],
  types: Set<string>,
  asOfMs: number,
): { inc: number; exc: number } | null {
  const started = unitRates
    .filter((r) => typeof r.rateType === 'string' && types.has(r.rateType)
      && Number.isFinite(r.valueIncVat) && Number.isFinite(r.valuePreVat)
      && Date.parse(r.validFrom) <= asOfMs)
    .sort((a, b) => Date.parse(a.validFrom) - Date.parse(b.validFrom));
  if (!started.length) return null;
  // Prefer a row that also still covers `asOf` (validTo in the future / open),
  // else fall back to the most-recent started row (handles a gap after validTo).
  const covering = started.filter((r) => r.validTo === null || Date.parse(r.validTo) > asOfMs);
  const row = (covering.length ? covering : started)[
    (covering.length ? covering : started).length - 1
  ];
  return { inc: row.valueIncVat, exc: row.valuePreVat };
}

/**
 * Reconstruct the two-band household day/night schedule from a HalfHourlyTariff's
 * typed `unitRates` as effective at `asOfMs`, or null when the API does not
 * publish a distinct household off-peak band (so the caller falls back to a
 * configured rate / flat pricing).
 *
 * IOG publishes the guaranteed 23:30–05:30 cheap rate as an OFF_PEAK row next to
 * the STANDARD day row; reading `rateType` lets us price the night band
 * automatically. EV-device rate types are excluded (they price the EV register,
 * not the whole-home import). Returns null unless BOTH a household day band and a
 * household night band are effective at `asOfMs` with different values.
 */
export function iogHouseholdBands(unitRates: IogUnitRate[], asOfMs: number): IogDayNightRates | null {
  const day = activeBandValue(unitRates, IOG_DAY_RATE_TYPES, asOfMs);
  const night = activeBandValue(unitRates, IOG_NIGHT_RATE_TYPES, asOfMs);
  if (!day || !night) return null;
  if (Number(day.inc.toFixed(4)) === Number(night.inc.toFixed(4))) return null;
  return {
    dayRate: day.inc,
    nightRate: night.inc,
    preVatDayRate: day.exc,
    preVatNightRate: night.exc,
  };
}

/**
 * A compact, identifier-free summary of the distinct (rateType → inc-VAT value)
 * pairs present in a HalfHourlyTariff's `unitRates`, e.g. "STANDARD=28.86,
 * OFF_PEAK=6.90" (or "STANDARD=28.86" when only the day rate is published). Used
 * in diagnostics so a field log reveals exactly what a user's account exposes —
 * i.e. whether the off-peak band is available for automatic day/night pricing.
 */
export function iogRateTypeSummary(unitRates: IogUnitRate[]): string {
  const byType = new Map<string, number>();
  // Most-recent value per rateType (by validFrom), so the logged figure matches
  // what `iogHouseholdBands` actually prices across a price change.
  const ordered = [...unitRates]
    .filter((r) => typeof r.rateType === 'string' && Number.isFinite(r.valueIncVat))
    .sort((a, b) => Date.parse(a.validFrom) - Date.parse(b.validFrom));
  for (const r of ordered) {
    byType.set(r.rateType as string, Number(r.valueIncVat.toFixed(4)));
  }
  return [...byType.entries()].map(([t, v]) => `${t}=${v}`).join(',') || 'none';
}
