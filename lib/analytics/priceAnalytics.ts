'use strict';

/**
 * Sprint 47 — relative price analytics (pure).
 *
 * Every metric here is RELATIVE/derived, so — per docs/research/kraken-contracts.md
 * — it declares its comparison population, window, boundaries, negative/equal-value
 * handling, missing-slot behaviour, and price basis. Nothing here is a settled or
 * headline value. No Date.now, no Homey.
 *
 * Rules:
 *  - window is half-open [from, to); population = REST tariff rows tiling it;
 *  - coverage must be exact and contiguous, else the analysis is unavailable
 *    (null) — we never extrapolate a partial day;
 *  - negatives are never clamped; a negative price is its own band;
 *  - equal values share a band (duration-weighted midrank);
 *  - a spike is descriptive only and never changes plan selection.
 */

import { Rate, sortRates, valueOf } from '../rates';

export type RelativeBand = 'negative' | 'low' | 'typical' | 'high' | 'spike';
export type VatBasis = 'vat-inclusive' | 'vat-exclusive';

const EPS = 1e-9;
const SPIKE_FLOOR_PENCE = 5; // Q3 + max(1.5*IQR, 5p) — avoids flagging a spike on a flat day

export interface WeightedPoint { value: number; weightMs: number; }

export interface PriceWindowAnalysis {
  windowFrom: string;
  windowTo: string;
  complete: true;
  priceBasis: VatBasis;
  population: 'tariff-rest';
  boundary: '[from,to)';
  tieRule: 'duration-weighted-midrank';
  timeWeightedAverage: number;
  median: number;
  q1: number;
  q3: number;
  min: number;
  max: number;
  spikeThreshold: number | null;
  negativeSlots: number;
  spikeSlots: number;
  /** Duration share (0..1) of the window in the negative or low bands. */
  relativeOffPeakShare: number;
  slots: number;
  points: WeightedPoint[];
}

function endMs(r: Rate): number {
  return r.valid_to
    ? new Date(r.valid_to).getTime()
    : new Date(r.valid_from).getTime() + 30 * 60_000;
}

/**
 * Confirm the rates tile [from, to) exactly and contiguously (no gap, no overlap).
 * Returns the tiling rows (time-sorted) or null.
 */
export function coveringRows(rates: Rate[], from: Date, to: Date): Rate[] | null {
  const f = from.getTime();
  const t = to.getTime();
  if (!(t > f)) return null;
  const rows = sortRates(rates).filter((r) => {
    const s = new Date(r.valid_from).getTime();
    const e = endMs(r);
    return e > f && s < t; // overlaps the window
  });
  if (!rows.length) return null;
  // First must start at or before `from`; each must butt against the previous;
  // last must reach at or beyond `to`.
  if (new Date(rows[0].valid_from).getTime() > f) return null;
  for (let i = 1; i < rows.length; i++) {
    if (new Date(rows[i].valid_from).getTime() !== endMs(rows[i - 1])) return null;
  }
  if (endMs(rows[rows.length - 1]) < t) return null;
  return rows;
}

function weightedQuantile(points: WeightedPoint[], q: number): number {
  const sorted = [...points].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((a, p) => a + p.weightMs, 0);
  if (total <= 0) return sorted[0]?.value ?? 0;
  const target = q * total;
  let cum = 0;
  for (const p of sorted) {
    cum += p.weightMs;
    if (cum >= target - EPS) return p.value;
  }
  return sorted[sorted.length - 1].value;
}

/** Q3 + max(1.5*IQR, floor). The 5p floor applies even when IQR is zero, so a
 *  lone extreme value in an otherwise-flat window is still flagged. Null only
 *  when there are too few points to reason about a distribution. */
export function spikeThreshold(points: WeightedPoint[]): number | null {
  if (points.length < 4) return null;
  const q1 = weightedQuantile(points, 0.25);
  const q3 = weightedQuantile(points, 0.75);
  const iqr = Math.max(0, q3 - q1);
  return q3 + Math.max(1.5 * iqr, SPIKE_FLOOR_PENCE);
}

/**
 * Classify a value relative to the window population (duration-weighted midrank):
 * negative (<0) → spike (> threshold) → low (midrank ≤ 25%) → high (≥ 75%) → typical.
 */
export function classifyBand(value: number, points: WeightedPoint[], threshold: number | null): RelativeBand {
  if (value < 0) return 'negative';
  if (threshold !== null && value > threshold + EPS) return 'spike';
  const total = points.reduce((a, p) => a + p.weightMs, 0);
  if (total <= 0) return 'typical';
  let below = 0;
  let equal = 0;
  for (const p of points) {
    if (p.value < value - EPS) below += p.weightMs;
    else if (Math.abs(p.value - value) <= EPS) equal += p.weightMs;
  }
  const midrank = (below + equal / 2) / total;
  if (midrank <= 0.25 + EPS) return 'low';
  if (midrank >= 0.75 - EPS) return 'high';
  return 'typical';
}

/**
 * Analyse the price distribution over [from, to). Returns null unless the window
 * is exactly and contiguously covered by REST tariff rows.
 */
export function analysePriceWindow(
  rates: Rate[],
  from: Date,
  to: Date,
  opts: { incVat?: boolean } = {},
): PriceWindowAnalysis | null {
  const incVat = opts.incVat ?? true;
  const rows = coveringRows(rates, from, to);
  if (!rows) return null;
  const f = from.getTime();
  const t = to.getTime();
  const points: WeightedPoint[] = rows.map((r) => {
    const s = Math.max(new Date(r.valid_from).getTime(), f);
    const e = Math.min(endMs(r), t);
    return { value: valueOf(r, incVat), weightMs: Math.max(0, e - s) };
  });
  const totalWeight = points.reduce((a, p) => a + p.weightMs, 0);
  const timeWeightedAverage = totalWeight > 0
    ? points.reduce((a, p) => a + p.value * p.weightMs, 0) / totalWeight
    : 0;
  const threshold = spikeThreshold(points);
  const values = points.map((p) => p.value);
  let negativeShare = 0;
  let negativeSlots = 0;
  let spikeSlots = 0;
  for (const p of points) {
    const band = classifyBand(p.value, points, threshold);
    if (p.value < 0) negativeSlots += 1;
    if (band === 'spike') spikeSlots += 1;
    if (band === 'negative' || band === 'low') negativeShare += p.weightMs;
  }
  return {
    windowFrom: from.toISOString(),
    windowTo: to.toISOString(),
    complete: true,
    priceBasis: incVat ? 'vat-inclusive' : 'vat-exclusive',
    population: 'tariff-rest',
    boundary: '[from,to)',
    tieRule: 'duration-weighted-midrank',
    timeWeightedAverage,
    median: weightedQuantile(points, 0.5),
    q1: weightedQuantile(points, 0.25),
    q3: weightedQuantile(points, 0.75),
    min: Math.min(...values),
    max: Math.max(...values),
    spikeThreshold: threshold,
    negativeSlots,
    spikeSlots,
    relativeOffPeakShare: totalWeight > 0 ? negativeShare / totalWeight : 0,
    slots: points.length,
    points,
  };
}

export interface SavingsEstimate {
  baselineAmount: number; // pence at the uniform-window average
  planAmount: number; // pence at the plan's weighted average
  estimatedSaving: number; // baseline - plan (import) — may be negative
  savingPct: number | null; // null when baseline is not strictly positive
  label: string;
}

/**
 * Estimated saving of a plan versus charging the same energy uniformly across
 * the declared window at its time-weighted average price. Percentage is null
 * (undefined) when the baseline is not strictly positive — callers surface the
 * absolute figure only. Always an estimate, never a settled bill.
 */
export function estimatePlanSavings(
  neededKwh: number,
  planWeightedAverage: number,
  windowAverage: number,
): SavingsEstimate {
  const baselineAmount = neededKwh * windowAverage;
  const planAmount = neededKwh * planWeightedAverage;
  const estimatedSaving = baselineAmount - planAmount;
  return {
    baselineAmount,
    planAmount,
    estimatedSaving,
    savingPct: baselineAmount > EPS ? (estimatedSaving / baselineAmount) * 100 : null,
    label: 'Estimated vs uniform-window baseline — not a settled bill',
  };
}

/** Share (0..1) of a plan's ENERGY allocated to negative/low bands of the window. */
export function lowPriceEnergyShare(
  allocations: Array<{ price: number; kwh: number }>,
  analysis: PriceWindowAnalysis,
): number | null {
  const total = allocations.reduce((a, x) => a + x.kwh, 0);
  if (total <= 0) return null;
  let low = 0;
  for (const a of allocations) {
    const band = classifyBand(a.price, analysis.points, analysis.spikeThreshold);
    if (band === 'negative' || band === 'low') low += a.kwh;
  }
  return low / total;
}
