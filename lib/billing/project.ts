'use strict';

import { BillingSummary, BillingConfidence, BillingAggregateInput } from './types';

const DAY_MS = 86_400_000;

function round(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

/**
 * Derive the projected period-end net and the actual/projection confidence
 * bands from an already-aggregated summary. A projection is ALWAYS an estimate
 * and is never presented as settled (F1).
 */
export function projectAndScore(
  summary: BillingSummary,
  input: BillingAggregateInput,
): { projectedNet: number | null; actualConfidence: BillingConfidence; projectionConfidence: BillingConfidence; reasons: string[] } {
  const startMs = Date.parse(summary.period.start);
  const endMs = Date.parse(summary.period.end);
  const settledMs = Date.parse(summary.settledThrough);
  const nowMs = Date.parse(input.now);
  const periodMs = endMs - startMs;
  const settledElapsedMs = Math.max(0, settledMs - startMs);
  const settledDays = settledElapsedMs / DAY_MS;
  const remainingDays = Math.max(0, (endMs - settledMs) / DAY_MS);
  const reasons: string[] = [];

  let projectedNet: number | null = null;
  if (settledDays >= 2) {
    const perDay = summary.netPosition / settledDays;
    projectedNet = round(summary.netPosition + perDay * remainingDays, 2);
  } else {
    reasons.push('Not enough settled data to project yet.');
  }

  const elapsedFraction = periodMs > 0 ? settledElapsedMs / periodMs : 0;
  const dataLagOk = nowMs - settledMs <= 36 * 3600_000;

  if (summary.period.source === 'calendar') {
    reasons.push('Billing day not set — using the calendar month. Set your billing day in settings for accuracy.');
  }
  if (input.import.nightRates.length) {
    reasons.push('Economy 7 register split is estimated from your day/night settings.');
  }
  if (summary.exportValue === null && summary.exportKwh !== null) {
    reasons.push('Export has no tariff — its value is unavailable (not £0).');
  }
  if (!dataLagOk) {
    reasons.push('Consumption data is lagging; totals are through the last settled reading.');
  }

  let actualConfidence: BillingConfidence = 'low';
  if (elapsedFraction > 0.6 && dataLagOk && summary.period.source === 'user') actualConfidence = 'high';
  else if (elapsedFraction > 0.25 && dataLagOk) actualConfidence = 'medium';

  let projectionConfidence: BillingConfidence = 'unknown';
  if (projectedNet !== null) {
    if (settledDays >= 14 && actualConfidence === 'high') projectionConfidence = 'high';
    else if (settledDays >= 7 && actualConfidence !== 'low') projectionConfidence = 'medium';
    else projectionConfidence = 'low';
  }

  return {
    projectedNet, actualConfidence, projectionConfidence, reasons,
  };
}
