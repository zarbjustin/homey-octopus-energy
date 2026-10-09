'use strict';

const { evaluatePriceAvailability, evaluateBoundedSlots, slotSelection } = require('./priceAvailability');

// Unknown and unconfigured are diagnostic results only, never invertible permission.
const CHARGING_PLAN_DECISIONS = [
  'eligible_preferred', 'eligible_fallback', 'waiting_for_slot',
  'insufficient_capacity', 'no_qualifying_slots', 'duration_complete', 'deadline_passed',
];

/** Describe a freshly reconciled state without writing, polling or issuing commands. */
function describeChargingPlan(state, now) {
  if (!state) return { decision: 'not_configured', explanation: 'No charging eligibility plan is configured for this meter.' };
  if (state.status === 'unknown') {
    return {
      decision: 'waiting_for_prices',
      explanation: 'Waiting for complete fresh prices before the fixed deadline. Missing prices do not mean no cheaper slots; charging eligibility is off.',
    };
  }
  if (state.status === 'expired') return { decision: 'deadline_passed', explanation: 'The fixed charging deadline has passed. Charging eligibility is off; configure a new plan for a new deadline.' };
  if (state.reason === 'duration-complete') {
    return { decision: 'duration_complete', explanation: 'The planned eligible-time budget has elapsed. This does not prove the battery charged or reached its SOC target.' };
  }
  if (state.status === 'insufficient') {
    return { decision: 'insufficient_capacity', explanation: 'Not enough permitted time remains before the deadline for the requested duration. Charging eligibility is off; the price ceiling has not been raised.' };
  }
  if (!state.slots.length) return { decision: 'no_qualifying_slots', explanation: 'Complete fresh prices contain no qualifying slots before the fixed deadline. Charging eligibility is off.' };
  const current = state.slots.find((slot) => slot.start <= now && now < slot.end);
  if (!current) {
    return {
      decision: 'waiting_for_slot',
      explanation: state.slots.some((slot) => slot.fallback)
        ? 'Waiting for a selected period. The plan supplements preferred slots with higher-priced permitted slots to cover the remaining planned duration; the hard maximum is unchanged.'
        : 'Waiting for a selected preferred-price period before the fixed deadline. Future slot availability is not permission to charge now.',
    };
  }
  if (current.fallback) {
    return { decision: 'eligible_fallback', explanation: 'A higher-priced permitted period is eligible now because preferred slots alone cannot cover the remaining planned duration before the deadline. The hard maximum is unchanged.' };
  }
  return {
    decision: 'eligible_preferred',
    explanation: state.slots.some((slot) => slot.fallback)
      ? 'A preferred-price period is eligible now. Higher-priced permitted periods are also selected to cover the remaining planned duration before the deadline.'
      : 'A selected preferred-price period is eligible now. This is not a battery command or confirmation of measured charging.',
  };
}

/** Bounded, identifier-free read-only summary of an already reconciled plan. */
function chargingPlanView(state, now, timezone) {
  const description = describeChargingPlan(state, now);
  if (!state) return { ...description, configured: false, slots: [] };
  const remainingHours = state.policy.mode === 'duration'
    ? Math.max(0, state.policy.duration - state.usedMs / 3600000) : null;
  const slots = state.slots.slice(0, 100).map((slot) => ({
    start: new Date(slot.start).toISOString(),
    end: new Date(slot.end).toISOString(),
    price: slot.price,
    fallback: slot.fallback === true,
  }));
  return {
    ...description,
    configured: true,
    timezone,
    active: state.active,
    deadline: new Date(state.policy.deadline).toISOString(),
    preferredPrice: state.policy.price,
    maximumPrice: state.policy.fallback ? state.policy.maximum : state.policy.price,
    fallback: state.policy.fallback,
    mode: state.policy.mode,
    remainingHours,
    selectedHours: state.status === 'unknown' ? null : state.slots.reduce((sum, slot) => sum + slot.end - slot.start, 0) / 3600000,
    slots,
    estimateLabel: 'Planned eligibility time, not measured charging or battery SOC. No battery command; independent stop limits remain required.',
  };
}

function decisionKey(state, now) {
  return `${describeChargingPlan(state, now).decision}:${state?.selection ?? 'none'}`;
}

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
      if (!this.stopped && previous?.policy && this.options.emitDecision) {
        await this.emitDecision(null);
      }
    });
  }

  async evaluate(policy) {
    if (this.stopped) throw new Error('Charging plan controller is stopped.');
    const now = this.options.now();
    const snapshot = this.options.snapshot();
    const previous = this.options.load();
    const result = reconcileChargingPlan(previous, policy, snapshot.rows, snapshot.fresh, now);
    const key = decisionKey(result.state, now);
    // Older persisted plans seed silently. Once seeded, persist the attempt
    // before emission so repeated refresh/restart cannot replay the decision.
    const changed = !previous || (typeof previous.decisionKey === 'string' && previous.decisionKey !== key);
    result.state.decisionKey = key;
    await this.options.save(result.state);
    this.clearTimer();
    if (this.stopped) return result.state;
    if (result.nextAt && result.nextAt > now) {
      this.timer = this.options.host.setTimeout(() => {
        this.update().catch(this.options.error);
      }, result.nextAt - now);
    }
    for (const edge of result.edges) await this.options.emit(edge, result.state);
    if (changed && this.options.emitDecision) await this.emitDecision(result.state, now);
    return result.state;
  }

  async emitDecision(state, now = this.options.now()) {
    try {
      await this.options.emitDecision(state, now);
    } catch (err) {
      // A diagnostic notification failure must not break existing charging
      // setup/lifecycle. There is no retry of a persisted attempt.
      this.options.error(err);
    }
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

module.exports = {
  reconcileChargingPlan,
  validateChargingPolicy,
  ChargingPlanController,
  describeChargingPlan,
  CHARGING_PLAN_DECISIONS,
  chargingPlanView,
};
