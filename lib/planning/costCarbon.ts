'use strict';

import {
  Rate, sortRates, valueOf,
} from '../rates';

/**
 * BL-25 — price/carbon optimiser.
 *
 * Selects one contiguous half-hour window from already-cached tariff rates and
 * carbon forecast data. No network or Homey dependencies. Price and carbon are
 * min/max normalised before weighting so a 0.5 setting genuinely means an even
 * trade-off (the previous device-local implementation mixed p/kWh with
 * gCO2/kWh/10, whose relative scale varied by day).
 *
 * Trust discipline:
 * - published prices + carbon FORECAST are estimates, never settlement;
 * - the calculation fails closed if either horizon is incomplete;
 * - no invented/default carbon value is substituted for missing data.
 */

export type CostCarbonReason =
  | 'invalid-window'
  | 'insufficient-rates'
  | 'insufficient-carbon'
  | 'no-contiguous-window'
  | null;

export interface CostCarbonSlot {
  start: string;
  end: string;
  /** p/kWh. */
  price: number;
  /** Forecast gCO2/kWh. */
  carbon: number;
}

export interface CarbonForecastPoint {
  from: string;
  to: string;
  intensity: number;
}

export interface CostCarbonPlan {
  available: boolean;
  activeNow: boolean;
  reason: CostCarbonReason;
  slots: CostCarbonSlot[];
  start: string | null;
  end: string | null;
  averagePrice: number | null;
  averageCarbon: number | null;
  /** Estimated charge cost for `energyKwh`, or null when no energy was supplied. */
  estimatedCost: number | null;
  /** Estimated operational emissions (kgCO2) for `energyKwh`. */
  estimatedEmissionsKg: number | null;
  /** Selected-window premium over the price-only cheapest window (p/kWh). */
  extraPriceVsCheapest: number | null;
  /** Forecast reduction vs the price-only cheapest window (gCO2/kWh). */
  carbonReductionVsCheapest: number | null;
  confidence: 'medium';
  provenance: 'published-rates+carbon-forecast';
  estimateLabel: string;
}

export interface CostCarbonOptions {
  now: Date;
  horizonEnd: Date;
  durationSlots: number;
  /** 0 = price only, 1 = carbon only. Values are clamped to [0, 1]. */
  greenness: number;
  incVat?: boolean;
  energyKwh?: number;
  /** Maximum energy delivered in one half-hour slot. */
  energyPerSlotKwh?: number;
  /** Include the current in-progress slot (used by slot-edge Flow evaluation). */
  includeCurrentSlot?: boolean;
}

interface ScoredRate {
  rate: Rate;
  startMs: number;
  endMs: number;
  price: number;
  carbon: number;
  score: number;
}

const SLOT_MS = 30 * 60_000;
const EPSILON = 1e-9;

function round(value: number, places = 2): number {
  return Number(value.toFixed(places));
}

function rateEndMs(rate: Rate): number {
  return rate.valid_to ? Date.parse(rate.valid_to) : Date.parse(rate.valid_from) + SLOT_MS;
}

function unavailable(reason: Exclude<CostCarbonReason, null>): CostCarbonPlan {
  return {
    available: false,
    activeNow: false,
    reason,
    slots: [],
    start: null,
    end: null,
    averagePrice: null,
    averageCarbon: null,
    estimatedCost: null,
    estimatedEmissionsKg: null,
    extraPriceVsCheapest: null,
    carbonReductionVsCheapest: null,
    confidence: 'medium',
    provenance: 'published-rates+carbon-forecast',
    estimateLabel: 'Estimate from published prices and carbon forecast; not a bill or settlement.',
  };
}

function carbonForInterval(points: CarbonForecastPoint[], startMs: number, endMs: number): number | null {
  const covering = points
    .map((point) => ({
      from: Date.parse(point.from),
      to: Date.parse(point.to),
      intensity: Number(point.intensity),
    }))
    .filter((point) => Number.isFinite(point.from) && Number.isFinite(point.to)
      && Number.isFinite(point.intensity) && point.to > startMs && point.from < endMs)
    .sort((a, b) => a.from - b.from);
  let cursor = startMs;
  let weighted = 0;
  for (const point of covering) {
    if (point.from > cursor) return null;
    const segmentStart = Math.max(cursor, point.from);
    const segmentEnd = Math.min(endMs, point.to);
    if (segmentEnd <= segmentStart) continue;
    weighted += point.intensity * (segmentEnd - segmentStart);
    cursor = segmentEnd;
    if (cursor >= endMs) return weighted / (endMs - startMs);
  }
  return null;
}

function normalise(value: number, min: number, max: number): number {
  if (Math.abs(max - min) <= EPSILON) return 0;
  return (value - min) / (max - min);
}

function contiguous(candidate: ScoredRate[]): boolean {
  return candidate.every((slot, index) => index === 0 || candidate[index - 1].endMs === slot.startMs);
}

function average(candidate: ScoredRate[], key: 'price' | 'carbon' | 'score', weights?: number[]): number {
  if (!weights) return candidate.reduce((sum, slot) => sum + slot[key], 0) / candidate.length;
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return candidate.reduce((sum, slot, index) => sum + slot[key] * weights[index], 0) / totalWeight;
}

export function evaluateCostCarbonPlan(
  rates: Rate[],
  carbon: CarbonForecastPoint[],
  options: CostCarbonOptions,
): CostCarbonPlan {
  const {
    now, horizonEnd, durationSlots,
  } = options;
  if (!(durationSlots > 0) || horizonEnd.getTime() <= now.getTime()) {
    return unavailable('invalid-window');
  }

  const slotStartMs = Math.floor(now.getTime() / SLOT_MS) * SLOT_MS;
  const fromMs = options.includeCurrentSlot || now.getTime() === slotStartMs
    ? slotStartMs
    : slotStartMs + SLOT_MS;
  const toMs = horizonEnd.getTime();
  const incVat = options.incVat ?? true;
  const pool = sortRates(rates).filter((rate) => {
    const start = Date.parse(rate.valid_from);
    const end = rateEndMs(rate);
    return Number.isFinite(start) && Number.isFinite(end) && start >= fromMs && end <= toMs;
  });
  if (pool.length < durationSlots) return unavailable('insufficient-rates');
  const requiredEndMs = Math.floor(toMs / SLOT_MS) * SLOT_MS;
  const coversHorizon = pool[0] && Date.parse(pool[0].valid_from) === fromMs
    && pool.every((rate, index) => index === 0 || rateEndMs(pool[index - 1]) === Date.parse(rate.valid_from))
    && rateEndMs(pool[pool.length - 1]) === requiredEndMs;
  if (!coversHorizon) return unavailable('insufficient-rates');

  const joined: Array<Omit<ScoredRate, 'score'>> = [];
  for (const rate of pool) {
    const startMs = Date.parse(rate.valid_from);
    const endMs = rateEndMs(rate);
    const intensity = carbonForInterval(carbon, startMs, endMs);
    if (intensity === null) return unavailable('insufficient-carbon');
    joined.push({
      rate,
      startMs,
      endMs,
      price: valueOf(rate, incVat),
      carbon: intensity,
    });
  }

  const prices = joined.map((slot) => slot.price);
  const intensities = joined.map((slot) => slot.carbon);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const minCarbon = Math.min(...intensities);
  const maxCarbon = Math.max(...intensities);
  const greenness = Math.min(1, Math.max(0, Number(options.greenness) || 0));
  const scored: ScoredRate[] = joined.map((slot) => ({
    ...slot,
    score: (1 - greenness) * normalise(slot.price, minPrice, maxPrice)
      + greenness * normalise(slot.carbon, minCarbon, maxCarbon),
  }));

  const candidates: ScoredRate[][] = [];
  for (let index = 0; index + durationSlots <= scored.length; index++) {
    const candidate = scored.slice(index, index + durationSlots);
    if (contiguous(candidate)) candidates.push(candidate);
  }
  if (!candidates.length) return unavailable('no-contiguous-window');

  const energyKwh = Number(options.energyKwh);
  const energyPerSlotKwh = Number(options.energyPerSlotKwh);
  const hasEnergy = Number.isFinite(energyKwh) && energyKwh > 0;
  const hasSlotEnergy = hasEnergy && Number.isFinite(energyPerSlotKwh) && energyPerSlotKwh > 0;
  let remainingEnergy = energyKwh;
  const weights = hasSlotEnergy
    ? Array.from({ length: durationSlots }, () => {
      const weight = Math.min(energyPerSlotKwh, remainingEnergy);
      remainingEnergy -= weight;
      return weight;
    })
    : undefined;
  const selected = candidates.reduce((best, candidate) => {
    const candidateScore = average(candidate, 'score', weights);
    const bestScore = average(best, 'score', weights);
    return candidateScore < bestScore - EPSILON ? candidate : best;
  });
  const cheapest = candidates.reduce((best, candidate) => (
    average(candidate, 'price', weights) < average(best, 'price', weights) - EPSILON ? candidate : best
  ));

  const averagePrice = average(selected, 'price', weights);
  const averageCarbon = average(selected, 'carbon', weights);
  const cheapestPrice = average(cheapest, 'price', weights);
  const cheapestCarbon = average(cheapest, 'carbon', weights);
  const nowMs = now.getTime();
  const slots: CostCarbonSlot[] = selected.map((slot) => ({
    start: slot.rate.valid_from,
    end: new Date(slot.endMs).toISOString(),
    price: round(slot.price),
    carbon: round(slot.carbon, 0),
  }));

  return {
    available: true,
    activeNow: selected.some((slot) => nowMs >= slot.startMs && nowMs < slot.endMs),
    reason: null,
    slots,
    start: slots[0].start,
    end: slots[slots.length - 1].end,
    averagePrice: round(averagePrice),
    averageCarbon: round(averageCarbon, 0),
    estimatedCost: hasEnergy ? round((energyKwh * averagePrice) / 100) : null,
    estimatedEmissionsKg: hasEnergy ? round((energyKwh * averageCarbon) / 1000) : null,
    extraPriceVsCheapest: round(averagePrice - cheapestPrice),
    carbonReductionVsCheapest: round(cheapestCarbon - averageCarbon, 0),
    confidence: 'medium',
    provenance: 'published-rates+carbon-forecast',
    estimateLabel: 'Estimate from published prices and carbon forecast; not a bill or settlement.',
  };
}
