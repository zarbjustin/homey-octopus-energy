'use strict';

/**
 * Sprint 47 — tie-aware planning primitives (pure).
 *
 * Wraps the existing selection logic in lib/rates.ts with an explicit, declared
 * tie-resolution strategy for equal-priced slots/windows. No Date.now, no Homey,
 * no mutable global state — every result is deterministic and unit-testable.
 *
 * Invariants:
 *  - negative prices are NEVER clamped;
 *  - `earliest` reproduces the existing implicit "earliest wins" behaviour;
 *  - `random` is deterministic for a given seed (seed material must never
 *    contain account/meter/device identifiers or the wall clock);
 *  - a plan either allocates ALL requested energy or returns null (no partial
 *    plans), preserving the existing planCharge contract.
 */

import { Rate, sortRates, valueOf } from '../rates';

export type TieStrategy = 'earliest' | 'latest' | 'random';

const EPSILON = 1e-9;

/** FNV-1a 32-bit hash of a string → uint32 (deterministic; identifier-free by
 *  the caller's contract). */
export function seedToUint32(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG → a function returning floats in [0, 1). Deterministic. */
export function createSeededRandom(seed: string): () => number {
  let a = seedToUint32(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Choose one item from a time-sorted tie group by strategy. */
export function pickTie<T>(sortedByTime: T[], strategy: TieStrategy, rng: () => number): T {
  if (sortedByTime.length === 1) return sortedByTime[0];
  if (strategy === 'latest') return sortedByTime[sortedByTime.length - 1];
  if (strategy === 'random') return sortedByTime[Math.floor(rng() * sortedByTime.length)];
  return sortedByTime[0]; // earliest (default)
}

function startMs(r: Rate): number {
  return new Date(r.valid_from).getTime();
}

function endMs(r: Rate): number {
  return r.valid_to
    ? new Date(r.valid_to).getTime()
    : new Date(r.valid_from).getTime() + 30 * 60_000;
}

function inWindow(pool: Rate[], from?: Date, to?: Date): Rate[] {
  if (!from && !to) return pool;
  const f = from ? from.getTime() : -Infinity;
  const t = to ? to.getTime() : Infinity;
  // A slot must START at/after `from` AND FINISH by `to` — a "by <deadline>"
  // plan never includes a slot that runs past the deadline.
  return pool.filter((r) => startMs(r) >= f && endMs(r) <= t);
}

function contiguous(candidate: Rate[]): boolean {
  return candidate.every((rate, index) => {
    if (index === 0) return true;
    const previous = candidate[index - 1];
    const previousEnd = previous.valid_to
      ? new Date(previous.valid_to).getTime()
      : new Date(previous.valid_from).getTime() + 30 * 60_000;
    return previousEnd === new Date(rate.valid_from).getTime();
  });
}

interface WindowOpts {
  from?: Date; to?: Date; incVat?: boolean; tie?: TieStrategy; rng?: () => number;
}

/**
 * Contiguous block of `slots` half-hours with the extreme (min for import, max
 * for export) average price, resolving equal-sum blocks by tie strategy.
 */
function selectWindow(rates: Rate[], slots: number, mode: 'min' | 'max', opts: WindowOpts): Rate[] | null {
  const incVat = opts.incVat ?? true;
  const tie = opts.tie ?? 'earliest';
  const rng = opts.rng ?? (() => 0);
  const pool = inWindow(sortRates(rates), opts.from, opts.to);
  if (slots <= 0 || pool.length < slots) return null;

  const blocks: Array<{ start: number; sum: number }> = [];
  for (let i = 0; i + slots <= pool.length; i++) {
    const candidate = pool.slice(i, i + slots);
    if (!contiguous(candidate)) continue;
    let sum = 0;
    for (let j = i; j < i + slots; j++) sum += valueOf(pool[j], incVat);
    blocks.push({ start: i, sum });
  }
  if (!blocks.length) return null;

  const best = blocks.reduce(
    (acc, b) => (mode === 'min' ? Math.min(acc, b.sum) : Math.max(acc, b.sum)),
    mode === 'min' ? Infinity : -Infinity,
  );
  const tied = blocks
    .filter((b) => Math.abs(b.sum - best) <= EPSILON)
    .sort((a, b) => a.start - b.start); // time order (pool is time-sorted)
  const chosen = pickTie(tied, tie, rng);
  return pool.slice(chosen.start, chosen.start + slots);
}

export function selectCheapestWindow(rates: Rate[], slots: number, opts: WindowOpts = {}): Rate[] | null {
  return selectWindow(rates, slots, 'min', opts);
}

export function selectExpensiveWindow(rates: Rate[], slots: number, opts: WindowOpts = {}): Rate[] | null {
  return selectWindow(rates, slots, 'max', opts);
}

interface SlotOpts extends WindowOpts { maxPrice?: number; mode?: 'cheapest' | 'dearest'; }

/** Deterministic sample of `k` items from an array (seeded Fisher–Yates). */
function seededSample<T>(items: T[], k: number, rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, k);
}

/**
 * The `n` most extreme individual half-hour rates (non-contiguous), resolving
 * the equal-priced BOUNDARY group by tie strategy. Slots strictly better than
 * the boundary price are always included. Returned time-sorted.
 */
export function selectExtremeSlots(rates: Rate[], n: number, opts: SlotOpts = {}): Rate[] {
  const incVat = opts.incVat ?? true;
  const tie = opts.tie ?? 'earliest';
  const rng = opts.rng ?? (() => 0);
  const dearest = opts.mode === 'dearest';
  let pool = inWindow(sortRates(rates), opts.from, opts.to);
  if (opts.maxPrice !== undefined && !dearest) {
    pool = pool.filter((r) => valueOf(r, incVat) <= (opts.maxPrice as number));
  }
  if (n <= 0 || pool.length === 0) return [];
  if (pool.length <= n) return sortRates(pool);

  const sign = dearest ? -1 : 1;
  const byValue = [...pool].sort((a, b) => sign * (valueOf(a, incVat) - valueOf(b, incVat)));
  const threshold = valueOf(byValue[n - 1], incVat);
  const strictlyBetter = pool.filter((r) => sign * (valueOf(r, incVat) - threshold) < -EPSILON);
  const boundary = sortRates(pool.filter((r) => Math.abs(valueOf(r, incVat) - threshold) <= EPSILON));
  const remaining = n - strictlyBetter.length;

  let picked: Rate[];
  if (remaining >= boundary.length) {
    picked = boundary;
  } else if (tie === 'latest') {
    picked = boundary.slice(boundary.length - remaining);
  } else if (tie === 'random') {
    picked = seededSample(boundary, remaining, rng);
  } else {
    picked = boundary.slice(0, remaining);
  }
  return sortRates([...strictlyBetter, ...picked]);
}

export interface PlanAllocation { from: string; to: string; kwh: number; price: number; }

export interface EnergyPlan {
  kind: 'import' | 'export';
  allocations: PlanAllocation[];
  count: number;
  neededKwh: number;
  weightedAveragePrice: number;
  estimatedAmount: number; // pence: import cost, export value (may be negative)
  tie: TieStrategy;
}

/** Energy-weighted average price of a set of allocations. */
export function energyWeightedAverage(allocations: PlanAllocation[]): number | null {
  const kwh = allocations.reduce((a, x) => a + x.kwh, 0);
  if (kwh <= 0) return null;
  const spend = allocations.reduce((a, x) => a + x.price * x.kwh, 0);
  return spend / kwh;
}

/**
 * Build a complete energy plan: allocate `neededKwh` across the most favourable
 * half-hour slots (cheapest for import, dearest for export) at `powerKw`
 * (max powerKw*0.5 kWh per slot; final slot may be partial). Returns null if the
 * available window cannot supply all the requested energy (never a partial plan).
 */
export function planEnergy(
  rates: Rate[],
  neededKwh: number,
  powerKw: number,
  opts: SlotOpts & { kind?: 'import' | 'export' } = {},
): EnergyPlan | null {
  const incVat = opts.incVat ?? true;
  const kind = opts.kind ?? 'import';
  if (neededKwh <= 0 || powerKw <= 0) return null;
  const perSlot = powerKw * 0.5;
  const slotsNeeded = Math.ceil(neededKwh / perSlot - EPSILON);
  const chosen = selectExtremeSlots(rates, slotsNeeded, {
    ...opts, mode: kind === 'export' ? 'dearest' : 'cheapest',
  });
  const capacity = chosen.length * perSlot;
  if (chosen.length < slotsNeeded || capacity + EPSILON < neededKwh) return null;

  // Allocate in PRICE-preference order so a partial final slot lands on the
  // least-favourable chosen slot (dearest for import, cheapest for export) — the
  // full amount always goes to the best slots. Present the result time-sorted.
  const sign = kind === 'export' ? -1 : 1;
  const byPriority = [...chosen].sort((a, b) => sign * (valueOf(a, incVat) - valueOf(b, incVat)));
  const kwhByFrom = new Map<string, number>();
  let remaining = neededKwh;
  for (const r of byPriority) {
    if (remaining <= EPSILON) break;
    const kwh = Math.min(perSlot, remaining);
    remaining -= kwh;
    kwhByFrom.set(r.valid_from, kwh);
  }
  const allocations: PlanAllocation[] = chosen
    .filter((r) => kwhByFrom.has(r.valid_from))
    .map((r) => ({
      from: r.valid_from,
      to: r.valid_to ?? new Date(new Date(r.valid_from).getTime() + 30 * 60_000).toISOString(),
      kwh: Number((kwhByFrom.get(r.valid_from) as number).toFixed(4)),
      price: valueOf(r, incVat),
    }));
  const weightedAveragePrice = energyWeightedAverage(allocations) ?? 0;
  const estimatedAmount = allocations.reduce((a, x) => a + x.price * x.kwh, 0);
  return {
    kind,
    allocations,
    count: allocations.length,
    neededKwh,
    weightedAveragePrice,
    estimatedAmount,
    tie: opts.tie ?? 'earliest',
  };
}

/** Whether the instant `atMs` falls within any allocation half-open [from,to). */
export function isPlanActive(plan: EnergyPlan, atMs: number): boolean {
  return plan.allocations.some((a) => {
    const s = new Date(a.from).getTime();
    const e = new Date(a.to).getTime();
    return atMs >= s && atMs < e;
  });
}
