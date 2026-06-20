'use strict';

/**
 * Pure, network-free helpers for working with Octopus Energy tariff data.
 * Kept separate from OctopusClient so they can be unit-tested without any I/O.
 */

export interface Rate {
  value_exc_vat: number;
  value_inc_vat: number;
  valid_from: string;
  valid_to: string | null;
  payment_method: string | null;
}

export interface ConsumptionRecord {
  consumption: number;
  interval_start: string;
  interval_end: string;
}

export type PriceLevel = 'plunge' | 'cheap' | 'normal' | 'expensive';

/** Sort rates ascending by their start time (returns a new array). */
export function sortRates(rates: Rate[]): Rate[] {
  return [...rates].sort(
    (a, b) => new Date(a.valid_from).getTime() - new Date(b.valid_from).getTime(),
  );
}

/** Pick the VAT-inclusive or VAT-exclusive value of a rate. */
export function valueOf(rate: Rate, incVat = true): number {
  return incVat ? rate.value_inc_vat : rate.value_exc_vat;
}

/**
 * Find the rate that is valid at a given instant.
 * A rate covers [valid_from, valid_to); a null valid_to means "still active".
 */
export function rateAt(rates: Rate[], at: Date = new Date()): Rate | null {
  const t = at.getTime();
  let best: Rate | null = null;
  let bestFrom = -Infinity;
  for (const rate of rates) {
    const from = new Date(rate.valid_from).getTime();
    const to = rate.valid_to ? new Date(rate.valid_to).getTime() : Infinity;
    if (from <= t && t < to && from >= bestFrom) {
      best = rate;
      bestFrom = from;
    }
  }
  return best;
}

/** All rates that start at or after `from` and before `to`, sorted ascending. */
export function ratesInWindow(rates: Rate[], from: Date, to: Date): Rate[] {
  const f = from.getTime();
  const t = to.getTime();
  return sortRates(rates).filter((r) => {
    const start = new Date(r.valid_from).getTime();
    return start >= f && start < t;
  });
}

/** The single cheapest rate within an (optional) window. */
export function cheapestRate(
  rates: Rate[],
  opts: { from?: Date; to?: Date; incVat?: boolean } = {},
): Rate | null {
  const incVat = opts.incVat ?? true;
  let pool = sortRates(rates);
  if (opts.from || opts.to) {
    const f = opts.from ? opts.from.getTime() : -Infinity;
    const t = opts.to ? opts.to.getTime() : Infinity;
    pool = pool.filter((r) => {
      const start = new Date(r.valid_from).getTime();
      return start >= f && start < t;
    });
  }
  let best: Rate | null = null;
  for (const r of pool) {
    if (!best || valueOf(r, incVat) < valueOf(best, incVat)) best = r;
  }
  return best;
}

/**
 * Find the cheapest contiguous block of `slots` consecutive half-hour rates
 * (by average price). Returns the slice of rates, or null if not enough data.
 */
export function cheapestWindow(
  rates: Rate[],
  slots: number,
  opts: { from?: Date; to?: Date; incVat?: boolean } = {},
): Rate[] | null {
  const incVat = opts.incVat ?? true;
  let pool = sortRates(rates);
  if (opts.from || opts.to) {
    const f = opts.from ? opts.from.getTime() : -Infinity;
    const t = opts.to ? opts.to.getTime() : Infinity;
    pool = pool.filter((r) => {
      const start = new Date(r.valid_from).getTime();
      return start >= f && start < t;
    });
  }
  if (slots <= 0 || pool.length < slots) return null;
  let bestStart = 0;
  let bestSum = Infinity;
  for (let i = 0; i + slots <= pool.length; i++) {
    let sum = 0;
    for (let j = i; j < i + slots; j++) sum += valueOf(pool[j], incVat);
    if (sum < bestSum) {
      bestSum = sum;
      bestStart = i;
    }
  }
  return pool.slice(bestStart, bestStart + slots);
}

/**
 * Is the rate covering `at` the cheapest among the rates from now to the end
 * of the known/forward window?
 */
export function isCheapestSlotNow(
  rates: Rate[],
  at: Date = new Date(),
  opts: { withinHours?: number; incVat?: boolean } = {},
): boolean {
  const incVat = opts.incVat ?? true;
  const current = rateAt(rates, at);
  if (!current) return false;
  const to = opts.withinHours
    ? new Date(at.getTime() + opts.withinHours * 3600_000)
    : undefined;
  const forward = sortRates(rates).filter((r) => {
    const end = r.valid_to ? new Date(r.valid_to).getTime() : Infinity;
    const start = new Date(r.valid_from).getTime();
    if (end <= at.getTime()) return false; // already finished
    if (to && start >= to.getTime()) return false;
    return true;
  });
  const cheapest = cheapestRate(forward, { incVat });
  if (!cheapest) return false;
  return valueOf(current, incVat) <= valueOf(cheapest, incVat);
}

/**
 * Select the `n` cheapest individual half-hour rates (non-contiguous) within an
 * optional window. Returned sorted ascending by time for display/scheduling.
 * `maxPrice` (p/kWh, VAT per incVat) excludes any slot above the cap.
 */
export function cheapestSlots(
  rates: Rate[],
  n: number,
  opts: { from?: Date; to?: Date; incVat?: boolean; maxPrice?: number } = {},
): Rate[] {
  const incVat = opts.incVat ?? true;
  let pool = sortRates(rates);
  if (opts.from || opts.to) {
    const f = opts.from ? opts.from.getTime() : -Infinity;
    const t = opts.to ? opts.to.getTime() : Infinity;
    pool = pool.filter((r) => {
      const start = new Date(r.valid_from).getTime();
      return start >= f && start < t;
    });
  }
  if (opts.maxPrice !== undefined) {
    pool = pool.filter((r) => valueOf(r, incVat) <= (opts.maxPrice as number));
  }
  if (n <= 0) return [];
  const byValue = [...pool].sort((a, b) => valueOf(a, incVat) - valueOf(b, incVat));
  const chosen = byValue.slice(0, n);
  return sortRates(chosen);
}

/**
 * Find the most expensive contiguous block of `slots` half-hours (by average
 * price) — useful for exports, where you want to sell when the rate is highest.
 */
export function expensiveWindow(
  rates: Rate[],
  slots: number,
  opts: { from?: Date; to?: Date; incVat?: boolean } = {},
): Rate[] | null {
  const incVat = opts.incVat ?? true;
  let pool = sortRates(rates);
  if (opts.from || opts.to) {
    const f = opts.from ? opts.from.getTime() : -Infinity;
    const t = opts.to ? opts.to.getTime() : Infinity;
    pool = pool.filter((r) => {
      const start = new Date(r.valid_from).getTime();
      return start >= f && start < t;
    });
  }
  if (slots <= 0 || pool.length < slots) return null;
  let bestStart = 0;
  let bestSum = -Infinity;
  for (let i = 0; i + slots <= pool.length; i++) {
    let sum = 0;
    for (let j = i; j < i + slots; j++) sum += valueOf(pool[j], incVat);
    if (sum > bestSum) {
      bestSum = sum;
      bestStart = i;
    }
  }
  return pool.slice(bestStart, bestStart + slots);
}

/** Whether a rate's half-hour covers the instant `at`. */
export function rateCovers(rate: Rate, at: Date): boolean {
  const from = new Date(rate.valid_from).getTime();
  const to = rate.valid_to ? new Date(rate.valid_to).getTime() : Infinity;
  return at.getTime() >= from && at.getTime() < to;
}

/**
 * Classify a price into a level using simple thresholds (p/kWh, VAT inc).
 * Negative prices ("plunge") are surfaced explicitly for Agile users.
 */
export function priceLevel(
  value: number,
  thresholds: { cheap: number; expensive: number },
): PriceLevel {
  if (value < 0) return 'plunge';
  if (value <= thresholds.cheap) return 'cheap';
  if (value >= thresholds.expensive) return 'expensive';
  return 'normal';
}

/** Sum the consumption (kWh) of a set of half-hourly records. */
export function sumConsumption(records: ConsumptionRecord[]): number {
  return records.reduce((acc, r) => acc + (Number(r.consumption) || 0), 0);
}

/** Total consumption whose interval starts within [from, to). */
export function consumptionBetween(
  records: ConsumptionRecord[],
  from: Date,
  to: Date,
): number {
  const f = from.getTime();
  const t = to.getTime();
  return sumConsumption(
    records.filter((r) => {
      const start = new Date(r.interval_start).getTime();
      return start >= f && start < t;
    }),
  );
}

/**
 * Derive the product code from a full tariff code.
 * e.g. "E-1R-AGILE-FLEX-22-11-25-C" -> "AGILE-FLEX-22-11-25".
 */
export function productCodeFromTariff(tariffCode: string): string {
  return tariffCode.replace(/^[A-Z]-\d+R-/, '').replace(/-[A-P]$/, '');
}

/**
 * Extract the GSP region letter (A-P) from a tariff code, or null if absent.
 * e.g. "E-1R-AGILE-FLEX-22-11-25-C" -> "C".
 */
export function regionFromTariff(tariffCode: string): string | null {
  const m = tariffCode.match(/-([A-P])$/);
  return m ? m[1] : null;
}

/**
 * Whether a tariff is a two-register (e.g. Economy 7) tariff, which uses
 * separate day and night unit rates rather than a single standard rate.
 * e.g. "E-2R-..." is two-register; "E-1R-..." is single-register.
 */
export function isTwoRegister(tariffCode: string): boolean {
  return /^[A-Z]-2R-/.test(tariffCode || '');
}
