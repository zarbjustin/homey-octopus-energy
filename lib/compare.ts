'use strict';

import {
  Rate, ConsumptionRecord, rateAt, valueOf,
} from './rates';

/**
 * Pure tariff-comparison helpers. The cost of a tariff over a set of consumption
 * records is the sum of (kWh × unit rate) plus a per-day standing charge.
 */

/** Total consumption cost (pence) for the records against a set of unit rates. */
export function consumptionCostPence(
  records: ConsumptionRecord[],
  rates: Rate[],
  incVat = true,
): number {
  let pence = 0;
  for (const r of records) {
    const rate = rateAt(rates, new Date(r.interval_start));
    if (rate) pence += Number(r.consumption) * valueOf(rate, incVat);
  }
  return pence;
}

/** Whole days spanned by the records (at least 1). */
export function daysSpanned(records: ConsumptionRecord[]): number {
  if (!records.length) return 1;
  const times = records.map((r) => new Date(r.interval_start).getTime());
  const min = Math.min(...times);
  const max = Math.max(...times);
  return Math.max(1, Math.round((max - min) / 86_400_000) || 1);
}

/**
 * Estimate the annual cost (£) of a tariff from a sample of consumption.
 * `standingPencePerDay` is the (VAT-adjusted) daily standing charge.
 */
export function estimateAnnualCost(
  records: ConsumptionRecord[],
  rates: Rate[],
  standingPencePerDay: number,
  incVat = true,
): number {
  const days = daysSpanned(records);
  const consumptionPence = consumptionCostPence(records, rates, incVat);
  const windowPence = consumptionPence + standingPencePerDay * days;
  const perDay = windowPence / days;
  return (perDay * 365) / 100;
}
