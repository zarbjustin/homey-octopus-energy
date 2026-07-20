'use strict';

import { rateAt, valueOf } from '../rates';
import { BillingSummary, BillingAggregateInput } from './types';
import { projectAndScore } from './project';
import { zonedTime, localDateParts } from './tz';

function round(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

/**
 * Sum the standing charge across each local calendar day that has started within
 * [startIso, endIso). A day counts as soon as its local midnight is before the
 * settled cutoff (Octopus charges a full daily standing charge), and the rate is
 * sampled at that day's local noon to avoid DST edges.
 */
function sumStandingChargePence(standing: Parameters<typeof rateAt>[0], startIso: string, endIso: string, timeZone: string, incVat: boolean): number {
  if (!standing.length) return 0;
  const endMs = Date.parse(endIso);
  const startParts = localDateParts(new Date(startIso), timeZone);
  let dayMidnight = zonedTime(startParts.year, startParts.month, startParts.day, timeZone, 0);
  let pence = 0;
  let guard = 0;
  while (dayMidnight.getTime() < endMs && guard < 400) {
    const p = localDateParts(dayMidnight, timeZone);
    const noon = zonedTime(p.year, p.month, p.day, timeZone, 12);
    const sc = rateAt(standing, noon);
    if (sc) pence += valueOf(sc, incVat);
    const nextUtc = new Date(Date.UTC(p.year, p.month - 1, p.day));
    nextUtc.setUTCDate(nextUtc.getUTCDate() + 1);
    dayMidnight = zonedTime(nextUtc.getUTCFullYear(), nextUtc.getUTCMonth() + 1, nextUtc.getUTCDate(), timeZone, 0);
    guard += 1;
  }
  return pence;
}

/**
 * Pure billing-period summary from already-fetched REST rows. Import cost
 * includes the standing charge; export value is null (never £0) when no export
 * tariff exists; net = importCost - (exportValue ?? 0). Projection + confidence
 * are derived and always labelled as estimates.
 */
export function computeBillingSummary(input: BillingAggregateInput): BillingSummary {
  const { period, settledThrough, incVat } = input;
  const startMs = Date.parse(period.start);
  const settledMs = Date.parse(settledThrough);
  const inWindow = (iso: string): boolean => {
    const t = Date.parse(iso);
    return t >= startMs && t < settledMs;
  };

  let importKwh = 0;
  let energyPence = 0;
  for (const r of input.import.records) {
    if (!inWindow(r.interval_start)) continue;
    importKwh += r.consumption;
    const useNight = input.import.nightRates.length > 0 && input.import.isNight(r.interval_start);
    const rate = rateAt(useNight ? input.import.nightRates : input.import.dayRates, new Date(r.interval_start));
    if (rate) energyPence += r.consumption * valueOf(rate, incVat);
  }

  const standingPence = sumStandingChargePence(input.import.standing, period.start, settledThrough, input.timeZone, incVat);

  let exportKwh: number | null = null;
  let exportPence: number | null = null;
  if (input.export) {
    exportKwh = 0;
    exportPence = 0;
    for (const r of input.export.records) {
      if (!inWindow(r.interval_start)) continue;
      exportKwh += r.consumption;
      const rate = rateAt(input.export.rates, new Date(r.interval_start));
      if (rate) exportPence += r.consumption * valueOf(rate, incVat);
    }
  }

  const importCost = (energyPence + standingPence) / 100;
  const standingCharge = standingPence / 100;
  const exportValue = exportPence === null ? null : exportPence / 100;
  const netPosition = importCost - (exportValue ?? 0);

  const summary: BillingSummary = {
    period,
    settledThrough,
    importKwh: round(importKwh, 3),
    exportKwh: exportKwh === null ? null : round(exportKwh, 3),
    importCost: round(importCost, 2),
    standingCharge: round(standingCharge, 2),
    exportValue: exportValue === null ? null : round(exportValue, 2),
    netPosition: round(netPosition, 2),
    projectedNet: null,
    actualConfidence: 'unknown',
    projectionConfidence: 'unknown',
    reasons: [],
  };

  const scored = projectAndScore(summary, input);
  summary.projectedNet = scored.projectedNet;
  summary.actualConfidence = scored.actualConfidence;
  summary.projectionConfidence = scored.projectionConfidence;
  summary.reasons = scored.reasons;
  return summary;
}
