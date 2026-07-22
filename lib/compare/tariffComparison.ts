'use strict';

/**
 * Pure tariff-comparison ranking (Sprint S62 / BL-19). The old comparison
 * returned a definitive "best_product" from a tiny candidate set with no
 * eligibility, confidence or "estimate" framing — misleading financial guidance
 * (R-015 / BB-09). This module reworks the presentation logic (the risky part)
 * as a pure, testable calculation over already-priced candidates:
 *
 *  - NEVER claims a "best" tariff — only a cheapest ESTIMATE to review.
 *  - Excludes hardware-gated tariffs (IOG needs an EV, Cosy a heat pump) from
 *    the recommendation and lists them separately, so a non-EV household is not
 *    told to switch to an EV tariff. The user's CURRENT tariff is always the
 *    baseline regardless of its eligibility.
 *  - Attaches a CONFIDENCE (history coverage + tariff volatility) with a reason,
 *    because forward prices on variable tariffs (Agile/Tracker) make past
 *    performance an unreliable predictor.
 *  - Reports candidates it could not price as "not evaluated" with a reason,
 *    rather than silently dropping them.
 *
 * The device does the I/O (fetch rates, estimate each candidate's annual cost);
 * this module only ranks/frames — so the honesty rules are unit-testable.
 */

export type TariffEligibility = 'open' | 'requires-ev' | 'requires-heat-pump';
export type TariffVolatility = 'stable' | 'variable';
export type Confidence = 'low' | 'medium' | 'high';

export interface TariffCandidateInput {
  name: string;
  /** Estimated annual cost (£), or null when it could not be priced. */
  annual: number | null;
  eligibility?: TariffEligibility;
  volatility?: TariffVolatility;
  /** Why it couldn't be priced (when `annual` is null). */
  reason?: string | null;
}

export interface RankedTariff {
  name: string;
  annual: number;
  /** Difference vs the current tariff (negative = cheaper estimate). */
  delta: number;
  volatility: TariffVolatility;
}

export interface TariffComparison {
  current: number | null;
  /** Eligible, evaluated candidates, cheapest estimate first (baseline included). */
  ranked: RankedTariff[];
  /** The cheapest ELIGIBLE evaluated option — an estimate, never called "best". */
  cheapestEstimateName: string | null;
  cheapestEstimateAnnual: number | null;
  /** max(0, current − cheapest eligible). 0 when the current tariff is cheapest. */
  estimatedAnnualSaving: number;
  currentIsCheapest: boolean;
  confidence: Confidence;
  confidenceReason: string;
  /** Priced but hardware-gated — shown separately, never recommended. */
  eligibilityGated: Array<{ name: string; requirement: string; annual: number | null }>;
  notEvaluated: Array<{ name: string; reason: string }>;
}

const REQUIREMENT: Record<Exclude<TariffEligibility, 'open'>, string> = {
  'requires-ev': 'Requires an EV / smart charger',
  'requires-heat-pump': 'Requires a heat pump',
};

function round(n: number): number {
  return Number(n.toFixed(2));
}

/**
 * Rank priced candidates honestly. `currentName` identifies the baseline tariff
 * (always evaluated even if hardware-gated). `daysOfData` is the number of days
 * of real consumption the estimate is based on (drives confidence).
 */
export function rankTariffs(
  candidates: TariffCandidateInput[],
  currentName: string,
  opts: { daysOfData: number },
): TariffComparison {
  const notEvaluated: Array<{ name: string; reason: string }> = [];
  const eligibilityGated: Array<{ name: string; requirement: string; annual: number | null }> = [];
  const priced: Array<{ name: string; annual: number; volatility: TariffVolatility }> = [];

  const currentInput = candidates.find((c) => c.name === currentName);
  const currentAnnual = currentInput && typeof currentInput.annual === 'number'
    ? round(currentInput.annual) : null;

  for (const c of candidates) {
    const eligibility = c.eligibility ?? 'open';
    const volatility = c.volatility ?? 'stable';
    if (typeof c.annual !== 'number' || !Number.isFinite(c.annual)) {
      notEvaluated.push({ name: c.name, reason: c.reason ?? 'could not be priced' });
      continue;
    }
    // Hardware-gated candidates (other than the one the user is already on) are
    // not recommendations — surface separately, never in the ranking.
    if (eligibility !== 'open' && c.name !== currentName) {
      eligibilityGated.push({ name: c.name, requirement: REQUIREMENT[eligibility], annual: round(c.annual) });
      continue;
    }
    priced.push({ name: c.name, annual: round(c.annual), volatility });
  }

  const ranked: RankedTariff[] = priced
    .slice()
    .sort((a, b) => a.annual - b.annual)
    .map((p) => ({
      name: p.name,
      annual: p.annual,
      delta: currentAnnual === null ? 0 : round(p.annual - currentAnnual),
      volatility: p.volatility,
    }));

  const cheapest = ranked[0] ?? null;
  const currentIsCheapest = cheapest !== null && cheapest.name === currentName;
  const estimatedAnnualSaving = (currentAnnual !== null && cheapest && !currentIsCheapest)
    ? round(Math.max(0, currentAnnual - cheapest.annual))
    : 0;

  // Confidence: history coverage, then capped by volatility of the recommended option.
  let confidence: Confidence = 'high';
  let confidenceReason = `based on ${Math.round(opts.daysOfData)} days of your usage`;
  if (opts.daysOfData < 14) {
    confidence = 'low';
    confidenceReason = `only ${Math.round(opts.daysOfData)} days of usage data`;
  } else if (opts.daysOfData < 28) {
    confidence = 'medium';
  }
  if (cheapest && !currentIsCheapest && cheapest.volatility === 'variable' && confidence !== 'low') {
    confidence = 'medium';
    confidenceReason = `${confidenceReason}; ${cheapest.name} prices vary, so past performance is only a guide`;
  }

  return {
    current: currentAnnual,
    ranked,
    cheapestEstimateName: cheapest ? cheapest.name : null,
    cheapestEstimateAnnual: cheapest ? cheapest.annual : null,
    estimatedAnnualSaving,
    currentIsCheapest,
    confidence,
    confidenceReason,
    eligibilityGated,
    notEvaluated,
  };
}
