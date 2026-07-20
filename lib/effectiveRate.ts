'use strict';

/**
 * Sprint 44 — opt-in *estimated* effective rate for Intelligent Octopus Go.
 *
 * This module is pure (no network, no Homey, no Date.now) so every honesty rule
 * is unit-testable in isolation.
 *
 * Core honesty insight: for a whole-home *import* meter, the estimated effective
 * rate equals the household base rate in EVERY case. A bonus SMART dispatch or a
 * BOOST discounts only the separately-metered EV device load (settled
 * midday-to-midday), never the whole-home import price. So:
 *  - `estimatedEffective` is NEVER below `householdBase`;
 *  - EV peak/off-peak rates are exposed SEPARATELY and never folded into the
 *    household figure;
 *  - the result is ALWAYS flagged `estimated: true` / `settlement: false` — it is
 *    an annotation, never a bill or a settled price.
 * The estimate fails closed to `null` when the tariff or household base is
 * unavailable (never substitutes an EV rate).
 */

export type EffectiveDispatchKind = 'SMART' | 'BOOST' | 'unknown';

export type EffectiveConfidence = 'high' | 'medium' | 'low' | 'unknown';

/** Midday-to-midday managed-charging allowance window (label only — the
 *  contract exposes no remaining-kWh figure, so we NEVER fabricate one). */
export const ALLOWANCE_WINDOW = '12:00–12:00 local';

/** Constant reason appended to every result so consumers can never mistake the
 *  estimate for settlement. */
export const ESTIMATE_NOT_SETTLEMENT = 'estimate-not-settlement';

export interface EffectiveRateInput {
  /** Whether this account is on an IOG tariff and opted into the estimate. */
  optedIn: boolean;
  /** Authoritative whole-home unit rate (p/kWh, VAT per device setting). */
  householdBase: number | null;
  /** True during the guaranteed 23:30–05:30 local off-peak window. */
  inGuaranteedWindow: boolean;
  /** Kinds of dispatch active NOW (from the reconciled dispatch view). */
  activeKinds: EffectiveDispatchKind[];
  /** EV-device rates (null for a non-four-rate agreement). */
  tariff: { evPeak: number | null; evOffPeak: number | null } | null;
  /** REST-authoritative previous half-hour household rate, else null. */
  finalisedPrevHalfHour: number | null;
}

export interface EffectiveRateEv {
  peak: number | null;
  offPeak: number | null;
  allowanceWindow: string;
  /** Always null — no remaining-allowance figure is exposed by the contract. */
  allowanceRemaining: null;
}

export interface EffectiveRateResult {
  householdBase: number | null;
  estimatedEffective: number | null;
  finalisedPrevHalfHour: number | null;
  confidence: EffectiveConfidence;
  estimated: true;
  settlement: false;
  reasons: string[];
  ev: EffectiveRateEv;
}

export function computeEffectiveRate(input: EffectiveRateInput): EffectiveRateResult {
  const ev: EffectiveRateEv = {
    peak: input.tariff?.evPeak ?? null,
    offPeak: input.tariff?.evOffPeak ?? null,
    allowanceWindow: ALLOWANCE_WINDOW,
    allowanceRemaining: null,
  };

  const unavailable = (reason: string): EffectiveRateResult => ({
    householdBase: Number.isFinite(input.householdBase as number) ? input.householdBase : null,
    estimatedEffective: null,
    finalisedPrevHalfHour: input.finalisedPrevHalfHour,
    confidence: 'unknown',
    estimated: true,
    settlement: false,
    reasons: [reason, ESTIMATE_NOT_SETTLEMENT],
    ev,
  });

  if (!input.optedIn) return unavailable('not-opted-in');
  if (input.tariff === null) return unavailable('unknown-tariff');
  if (input.householdBase === null || !Number.isFinite(input.householdBase)) {
    return unavailable('household-base-unavailable');
  }

  const hb = input.householdBase;
  const hasSmart = input.activeKinds.includes('SMART');
  const hasBoost = input.activeKinds.includes('BOOST');
  const hasUnknown = input.activeKinds.includes('unknown');

  let confidence: EffectiveConfidence;
  let reasons: string[];
  if (input.inGuaranteedWindow) {
    confidence = 'high';
    reasons = ['guaranteed-whole-home-offpeak'];
  } else if (hasSmart && hasBoost) {
    confidence = 'low';
    reasons = ['dispatch-mixed', 'household-at-base-rate'];
  } else if (hasSmart) {
    confidence = 'medium';
    reasons = ['bonus-smart-ev-only', 'household-at-base-rate'];
  } else if (hasBoost) {
    confidence = 'low';
    reasons = ['boost-no-assumed-discount', 'household-at-base-rate'];
  } else if (hasUnknown) {
    confidence = 'low';
    reasons = ['dispatch-kind-unknown', 'household-at-base-rate'];
  } else {
    confidence = 'high';
    reasons = ['household-base-rate'];
  }

  return {
    householdBase: hb,
    // Whole-home effective == household base in every case; dispatches discount
    // only the separately-metered EV load. Never below base, never an EV rate.
    estimatedEffective: hb,
    finalisedPrevHalfHour: input.finalisedPrevHalfHour,
    confidence,
    estimated: true,
    settlement: false,
    reasons: [...reasons, ESTIMATE_NOT_SETTLEMENT],
    ev,
  };
}
