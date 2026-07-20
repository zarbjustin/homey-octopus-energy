'use strict';

import { Rate, ConsumptionRecord } from '../rates';

/** How the billing period start was determined (drives confidence). */
export type BillingPeriodSource = 'user' | 'calendar';

export type BillingConfidence = 'high' | 'medium' | 'low' | 'unknown';

export interface BillingPeriod {
  /** ISO instant of the local period start. */
  start: string;
  /** ISO instant of the local period end (exclusive). */
  end: string;
  source: BillingPeriodSource;
}

/** Inputs for the pure aggregation — already-fetched REST rows only. */
export interface BillingAggregateInput {
  period: BillingPeriod;
  /** "Settled through" instant — the newest complete consumption interval end. */
  settledThrough: string;
  now: string;
  timeZone: string;
  incVat: boolean;
  import: {
    records: ConsumptionRecord[];
    dayRates: Rate[];
    /** Night rates for a two-register (Economy 7) tariff, else empty. */
    nightRates: Rate[];
    standing: Rate[];
    /** Predicate: is this ISO instant in the night register window? */
    isNight: (iso: string) => boolean;
  };
  /** Present only when an export tariff/rate exists. Absent => export value is unknown. */
  export?: {
    records: ConsumptionRecord[];
    rates: Rate[];
  };
}

export interface BillingSummary {
  period: BillingPeriod;
  settledThrough: string;
  importKwh: number;
  /** null when no export meter/tariff is modelled. */
  exportKwh: number | null;
  importCost: number; // pounds, incl. standing charge component
  standingCharge: number; // pounds
  /** null when no export tariff exists (never presented as £0). */
  exportValue: number | null;
  netPosition: number; // pounds: importCost - (exportValue ?? 0)
  projectedNet: number | null; // pounds, estimated to period end
  actualConfidence: BillingConfidence;
  projectionConfidence: BillingConfidence;
  /** Human-readable reasons for the confidence bands. */
  reasons: string[];
}
