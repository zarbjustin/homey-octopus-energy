'use strict';

import {
  Rate, valueOf, cheapestSlots,
} from '../rates';

/**
 * Pure target-rate evaluation (Sprint S61 / BL-22). Answers the single most
 * requested dynamic-tariff automation — "the cheapest N hours at or under a
 * price cap, before a deadline" — as a stateless calculation over a rates
 * snapshot. It is deliberately free of device/Homey/timer/network dependencies:
 * the device recomputes it on the existing rates-updated path (zero new
 * requests) and the Flow trigger/condition read the result.
 *
 * Trust discipline (F1): forward prices are FORECASTS of settled truth, so a
 * caller must label tokens as estimates. The evaluation FAILS CLOSED — if the
 * published horizon can't cover the requested window it returns `available:
 * false` (never invents a slot), and "the cap wasn't satisfiable" is a
 * first-class result (`met: false`, reason `cap-not-met`) so a Flow can branch
 * instead of silently doing nothing.
 */

export interface TargetRateSlot {
  start: string;
  end: string;
  /** p/kWh, VAT per `incVat`. */
  price: number;
}

export type TargetRateReason =
  | 'invalid-window'
  | 'insufficient-window'
  | 'cap-not-met'
  | null;

export interface TargetRateResult {
  /** Whether there was enough published data in the window to evaluate at all. */
  available: boolean;
  /** Whether the cap (if any) was satisfiable for the full requested duration. */
  met: boolean;
  /** Whether `now` is inside one of the chosen slots (backs the condition). */
  activeNow: boolean;
  reason: TargetRateReason;
  /** Chosen slots, ascending by time (empty unless `met`). */
  slots: TargetRateSlot[];
  /** Earliest chosen slot start / latest chosen slot end (null unless `met`). */
  start: string | null;
  end: string | null;
  averagePrice: number | null;
  maxSlotPrice: number | null;
  /** The price you'd have to accept for the full duration ignoring the cap —
   *  explains a `cap-not-met` result (e.g. "cheapest 3h was 31p"). */
  cheapestAvailablePrice: number | null;
}

export interface TargetRateOptions {
  now: Date;
  deadline: Date;
  /** Number of half-hour slots required (hours × 2). */
  durationSlots: number;
  /** Optional price cap (p/kWh, VAT per `incVat`); undefined = no cap. */
  maxPrice?: number;
  incVat?: boolean;
}

const SLOT_MS = 30 * 60_000;

function slotEndMs(r: Rate): number {
  return r.valid_to ? Date.parse(r.valid_to) : Date.parse(r.valid_from) + SLOT_MS;
}

function round(n: number): number {
  return Number(n.toFixed(2));
}

function unavailable(available: boolean, reason: TargetRateReason, cheapest: number | null = null): TargetRateResult {
  return {
    available,
    met: false,
    activeNow: false,
    reason,
    slots: [],
    start: null,
    end: null,
    averagePrice: null,
    maxSlotPrice: null,
    cheapestAvailablePrice: cheapest,
  };
}

/**
 * Evaluate the target-rate window over `rates` for `[now, deadline)`. Reuses the
 * shared non-contiguous cheapest-slot selector (`cheapestSlots`, which already
 * honours a `maxPrice` cap) so this never re-implements pricing.
 */
export function evaluateTargetRate(rates: Rate[], opts: TargetRateOptions): TargetRateResult {
  const incVat = opts.incVat ?? true;
  const {
    now, deadline, durationSlots, maxPrice,
  } = opts;
  if (!(durationSlots > 0) || deadline.getTime() <= now.getTime()) {
    return unavailable(false, 'invalid-window');
  }

  // Include the slot currently in progress: floor `now` to the half-hour so the
  // active slot (which started before `now`) counts toward the plan and the
  // condition can report `activeNow` for a window already running.
  const from = new Date(Math.floor(now.getTime() / SLOT_MS) * SLOT_MS);

  // Fail closed: the published horizon must actually contain enough future
  // in-window slots to cover the requested duration (HA's "unknown past
  // published rates" complaint — we never invent a slot).
  const uncapped = cheapestSlots(rates, durationSlots, { from, to: deadline, incVat });
  if (uncapped.length < durationSlots) {
    return unavailable(false, 'insufficient-window');
  }
  const cheapestAvailablePrice = round(Math.max(...uncapped.map((r) => valueOf(r, incVat))));

  // Apply the cap. Too-tight a cap → not satisfiable is a first-class result.
  const chosen = maxPrice === undefined
    ? uncapped
    : cheapestSlots(rates, durationSlots, {
      from, to: deadline, incVat, maxPrice,
    });
  if (chosen.length < durationSlots) {
    return unavailable(true, 'cap-not-met', cheapestAvailablePrice);
  }

  const nowMs = now.getTime();
  const slots: TargetRateSlot[] = chosen.map((r) => ({
    start: r.valid_from,
    end: new Date(slotEndMs(r)).toISOString(),
    price: round(valueOf(r, incVat)),
  }));
  const prices = slots.map((s) => s.price);
  const activeNow = chosen.some((r) => {
    const s = Date.parse(r.valid_from);
    return nowMs >= s && nowMs < slotEndMs(r);
  });

  return {
    available: true,
    met: true,
    activeNow,
    reason: null,
    slots,
    start: slots[0].start,
    end: slots[slots.length - 1].end,
    averagePrice: round(prices.reduce((a, b) => a + b, 0) / prices.length),
    maxSlotPrice: round(Math.max(...prices)),
    cheapestAvailablePrice,
  };
}
