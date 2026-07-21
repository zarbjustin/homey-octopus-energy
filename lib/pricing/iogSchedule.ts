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
}

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
