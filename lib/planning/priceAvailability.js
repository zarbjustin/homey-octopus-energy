'use strict';

const { priceBand, normaliseThresholds } = require('../widgetPriceBands');

/** Pure cached-snapshot contract. Unknown must throw at the Flow adapter,
 * including inverted conditions; returning false would grant unsafe permission.
 * Time inputs are absolute instants, with local deadlines resolved by the adapter.
 */
function evaluatePriceAvailability(rows, options) {
  const {
    from, to, threshold, fresh,
  } = options;
  const unknown = (reason) => ({ status: 'unknown', reason, slots: [] });
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from
    || !Number.isFinite(threshold)) return unknown('invalid-input');
  if (fresh !== true) return unknown('stale-or-unavailable');
  if (!Array.isArray(rows) || rows.some((row) => !row
    || !Number.isFinite(Date.parse(row.valid_from))
    || !Number.isFinite(Date.parse(row.valid_to)))) return unknown('invalid-rates');
  const pool = rows.map((row) => ({
    start: Date.parse(row.valid_from),
    end: Date.parse(row.valid_to),
    price: row.value_inc_vat,
  })).filter((row) => row.end > from && row.start < to)
    .sort((a, b) => a.start - b.start);
  let covered = from;
  for (const row of pool) {
    if (!Number.isFinite(row.start) || !Number.isFinite(row.end)
      || row.end - row.start !== 1800000 || !Number.isFinite(row.price)
      || Math.max(row.start, from) !== covered) return unknown('incomplete-or-ambiguous-horizon');
    covered = Math.min(row.end, to);
  }
  if (covered !== to) return unknown('incomplete-or-ambiguous-horizon');
  const slots = pool.filter((row) => row.price < threshold).map((row) => ({
    start: Math.max(row.start, from), end: Math.min(row.end, to), price: row.price,
  }));
  return { status: slots.length ? 'some' : 'none', reason: null, slots };
}

function evaluatePriceBand(price, thresholds) {
  if (!Number.isFinite(price) || !thresholds
    || normaliseThresholds(thresholds).corrected) return 'unknown';
  if (!['greenMax', 'yellowMax', 'orangeMax'].every((key) => Number.isFinite(thresholds[key]))) return 'unknown';
  return priceBand(price, thresholds);
}

/** Optional duration mode: preferred slots first, cheapest bounded supplement.
 * Capacity is real remaining time, never a full in-progress half-hour.
 */
function evaluateBoundedSlots(rows, options) {
  const {
    duration, fallback, maximum, ...horizon
  } = options;
  if (!Number.isFinite(horizon.threshold)) return { status: 'unknown', reason: 'invalid-policy', slots: [] };
  const all = evaluatePriceAvailability(rows, { ...horizon, threshold: Number.MAX_VALUE });
  if (all.status === 'unknown') return all;
  if (!Number.isFinite(duration) || duration <= 0 || typeof fallback !== 'boolean'
    || (fallback && (!Number.isFinite(maximum) || maximum < horizon.threshold))) {
    return { status: 'unknown', reason: 'invalid-policy', slots: [] };
  }
  const preferred = all.slots.filter((slot) => slot.price < horizon.threshold);
  const supplement = fallback ? all.slots.filter((slot) => slot.price >= horizon.threshold && slot.price <= maximum) : [];
  const cheapest = (a, b) => a.price - b.price || a.start - b.start;
  const candidates = [...preferred.sort(cheapest), ...supplement.sort(cheapest)];
  let remaining = duration * 3600000;
  const selected = [];
  for (const slot of candidates) {
    if (remaining <= 0) break;
    const length = Math.min(remaining, slot.end - slot.start);
    selected.push({ ...slot, end: slot.start + length, fallback: slot.price >= horizon.threshold });
    remaining -= length;
  }
  if (remaining > 0) return { status: 'insufficient', reason: 'insufficient-capacity', slots: [] };
  return { status: 'complete', reason: null, slots: selected.sort((a, b) => a.start - b.start) };
}

function slotSelection(slots, status) {
  if (status === 'unknown') return 'unknown';
  if (!slots.length) return 'none';
  return slots.some((slot) => slot.fallback) ? 'fallback' : 'preferred';
}

module.exports = {
  evaluatePriceAvailability, evaluatePriceBand, evaluateBoundedSlots, slotSelection,
};
