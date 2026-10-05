'use strict';

const { evaluatePriceAvailability, evaluateBoundedSlots, slotSelection } = require('./priceAvailability');

function validateChargingPolicy(policy, now) {
  if (!policy || !['all', 'duration'].includes(policy.mode)
    || !Number.isFinite(policy.price) || !Number.isFinite(policy.deadline)
    || policy.deadline <= now || policy.deadline > now + 49 * 3600000
    || (policy.mode === 'duration' && (!Number.isFinite(policy.duration) || policy.duration <= 0
      || policy.duration > 24 || typeof policy.fallback !== 'boolean'
      || (policy.fallback && (!Number.isFinite(policy.maximum) || policy.maximum < policy.price))))) {
    throw new Error('Invalid charging policy, duration, deadline or hard price maximum.');
  }
}

/** One explicitly configured plan per meter. No I/O; duration measures planned
 * eligible time, never measured charging or battery state. Fixed deadline cannot
 * roll forward during refresh/restart. Replans never reset the duration budget.
 */
function reconcileChargingPlan(previous, policy, rows, fresh, now) {
  validateChargingPolicy({ ...policy, deadline: now + 1 }, now);
  if (!Number.isFinite(policy.deadline)) throw new Error('Invalid persisted charging deadline.');
  if (!Number.isFinite(now) || (previous && (!Number.isFinite(previous.checkedAt)
    || previous.checkedAt > now || !Number.isFinite(previous.usedMs) || previous.usedMs < 0
    || !Number.isFinite(previous.validUntil) || typeof previous.active !== 'boolean'
    || !Array.isArray(previous.slots)
    || previous.slots.some((slot) => !Number.isFinite(slot.start) || !Number.isFinite(slot.end)
      || slot.end <= slot.start || !Number.isFinite(slot.price))))) throw new Error('Invalid persisted charging plan clock or state.');
  const same = previous && JSON.stringify(previous.policy) === JSON.stringify(policy);
  const prior = same ? previous : null;
  let usedMs = prior?.usedMs || 0;
  if (prior && now > prior.checkedAt) {
    for (const slot of prior.slots) {
      usedMs += Math.max(0, Math.min(now, slot.end, prior.validUntil) - Math.max(prior.checkedAt, slot.start));
    }
  }
  let result;
  if (now >= policy.deadline) result = { status: 'expired', reason: 'deadline', slots: [] };
  else if (policy.mode === 'duration' && usedMs >= policy.duration * 3600000) {
    result = { status: 'complete', reason: 'duration-complete', slots: [] };
  } else {
    const options = {
      from: now, to: policy.deadline, threshold: policy.price, fresh: fresh.current && fresh.until > now,
    };
    result = policy.mode === 'all'
      ? evaluatePriceAvailability(rows, options)
      : evaluateBoundedSlots(rows, {
        ...options,
        duration: (policy.duration * 3600000 - usedMs) / 3600000,
        fallback: policy.fallback,
        maximum: policy.maximum,
      });
  }
  const slots = result.slots;
  const active = slots.some((slot) => slot.start <= now && now < slot.end);
  const wasActive = previous?.active === true;
  const edges = [];
  if (wasActive && (!active || !same)) edges.push('ended');
  if (active && (!wasActive || !same)) edges.push('started');
  const validUntil = Math.min(policy.deadline, Number.isFinite(fresh.until) ? fresh.until : now);
  const boundaries = slots.flatMap((slot) => [slot.start, slot.end]);
  const nextAt = Math.min(...[policy.deadline, validUntil, ...boundaries].filter((at) => at > now));
  return {
    state: {
      policy,
      checkedAt: now,
      usedMs,
      active,
      status: result.status,
      selection: slotSelection(slots, result.status),
      reason: result.reason,
      slots,
      validUntil,
    },
    edges,
    nextAt: Number.isFinite(nextAt) ? nextAt : null,
  };
}

/** Owns only a local eligibility timer; never refreshes/fetches rates. Serialises
 * all mutations and persists each transition BEFORE attempting a Flow emission.
 * No retry after crash => at-most-once attempts, not guaranteed physical delivery.
 */
class ChargingPlanController {
  constructor(options) {
    this.options = options;
    this.timer = null;
    this.queue = Promise.resolve();
    this.stopped = false;
  }

  serial(fn) {
    const task = this.queue.then(fn);
    this.queue = task.catch(() => {});
    return task;
  }

  configure(policy) {
    return this.serial(async () => {
      validateChargingPolicy(policy, this.options.now());
      return this.evaluate(policy);
    });
  }

  update() {
    return this.serial(async () => {
      const previous = this.options.load();
      if (!previous?.policy || this.stopped) return null;
      return this.evaluate(previous.policy);
    });
  }

  async cancel() {
    return this.serial(async () => {
      const previous = this.options.load();
      await this.options.save(null);
      this.clearTimer();
      if (previous?.active) await this.options.emit('ended', { status: 'cancelled', reason: 'cancelled' });
    });
  }

  async evaluate(policy) {
    if (this.stopped) throw new Error('Charging plan controller is stopped.');
    const now = this.options.now();
    const snapshot = this.options.snapshot();
    const previous = this.options.load();
    const result = reconcileChargingPlan(previous, policy, snapshot.rows, snapshot.fresh, now);
    await this.options.save(result.state);
    this.clearTimer();
    if (this.stopped) return result.state;
    if (result.nextAt && result.nextAt > now) {
      this.timer = this.options.host.setTimeout(() => {
        this.update().catch(this.options.error);
      }, result.nextAt - now);
    }
    for (const edge of result.edges) await this.options.emit(edge, result.state);
    return result.state;
  }

  clearTimer() {
    if (this.timer !== null) this.options.host.clearTimeout(this.timer);
    this.timer = null;
  }

  stop() {
    this.stopped = true;
    this.clearTimer();
  }
}

module.exports = { reconcileChargingPlan, validateChargingPolicy, ChargingPlanController };
