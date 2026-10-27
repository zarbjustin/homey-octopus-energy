'use strict';

const { sourceAge } = require('./statusPresentation');

const AREAS = ['prices', 'meter_data', 'balance', 'carbon', 'monthly_cost', 'billing_summary', 'points', 'daily_usage', 'effective_rate'];
const DECISIONS = ['eligible_preferred', 'eligible_fallback', 'waiting_for_slot', 'insufficient_capacity', 'no_qualifying_slots', 'duration_complete', 'deadline_passed', 'waiting_for_prices', 'not_configured'];
const MINI_REASONS = ['unknown', 'current', 'stale', 'rate-limited', 'budget-limited', 'no-device', 'provider-error', 'empty-telemetry', 'invalid-demand', 'invalid-timestamp'];
const MINI_COUNTERS = ['polls', 'coalesced', 'cooldownSkips', 'discoveryBackoffSkips', 'budgetSkips', 'discoveryAttempts', 'demandAttempts', 'emptyReadings', 'invalidReadings', 'staleReadings', 'currentReadings', 'providerErrors', 'subscriberErrors'];

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1000000 ? value : null;
}

function stamp(value, now, future = false) {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 && (future || parsed <= now) ? new Date(parsed).toISOString() : null;
}

function miniSnapshot(d, now) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const accounts = Array.isArray(d.accounts) ? d.accounts : [];
  return {
    observedAt: stamp(d.observedAt, now),
    cadenceSeconds: [60, 120, 300].includes(d.cadenceSeconds) ? d.cadenceSeconds : null,
    activeAccounts: count(d.activeAccounts),
    truncated: d.truncated === true || accounts.length > 5,
    budget: d.budget && typeof d.budget === 'object' ? {
      accounts: count(d.budget.accounts),
      gated: count(d.budget.gated),
      minTokens: Number.isFinite(d.budget.minTokens) && d.budget.minTokens >= -6 && d.budget.minTokens <= 6 ? d.budget.minTokens : null,
      counters: Object.fromEntries(['coreAdmitted', 'liveAdmitted', 'bestAdmitted', 'liveDenied', 'bestDenied', 'gatedDenied'].map((key) => [key, count(d.budget.counters?.[key])])),
    } : null,
    accounts: accounts.slice(0, 5).map((a, index) => ({
      account: index + 1,
      subscribers: count(a?.subscribers),
      timerActive: typeof a?.timerActive === 'boolean' ? a.timerActive : null,
      inFlight: typeof a?.inFlight === 'boolean' ? a.inFlight : null,
      discovery: ['not-attempted', 'found', 'not-found', 'failed'].includes(a?.discovery) ? a.discovery : 'unknown',
      reason: MINI_REASONS.includes(a?.reason) ? a.reason : 'unknown',
      readingState: ['unknown', 'current', 'stale'].includes(a?.readingState) ? a.readingState : 'unknown',
      lastErrorKind: ['none', 'budget', 'throttled', 'authentication', 'field', 'transport', 'other'].includes(a?.lastErrorKind) ? a.lastErrorKind : 'unknown',
      ...Object.fromEntries(['lastPollAt', 'lastDiscoveryAt', 'lastDemandAt', 'lastResponseAt', 'lastSuccessAt', 'readingAt', 'inFlightSince'].map((key) => [key, stamp(a?.[key], now)])),
      ...Object.fromEntries(['nextDiscoveryAt', 'nextPollAt', 'cooldownUntil'].map((key) => [key, stamp(a?.[key], now, true)])),
      counters: Object.fromEntries(MINI_COUNTERS.map((key) => [key, count(a?.counters?.[key])])),
    })),
  };
}

function miniDelivery(d, now) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  return {
    ...Object.fromEntries(['enabled', 'subscribed', 'capabilityPresent'].map((key) => [key, typeof d[key] === 'boolean' ? d[key] : null])),
    receivedAt: stamp(d.receivedAt, now),
    writtenAt: stamp(d.writtenAt, now),
    writeFailures: count(d.writeFailures),
  };
}

function finite(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function planSnapshot(plan) {
  if (!plan || typeof plan !== 'object') return null;
  return {
    decision: DECISIONS.includes(plan.decision) ? plan.decision : 'unknown',
    configured: typeof plan.configured === 'boolean' ? plan.configured : null,
    preferredPrice: finite(plan.preferredPrice, -1000, 1000),
    maximumPrice: finite(plan.maximumPrice, -1000, 1000),
    fallback: typeof plan.fallback === 'boolean' ? plan.fallback : null,
    remainingHours: finite(plan.remainingHours, 0, 24),
    selectedHours: finite(plan.selectedHours, 0, 24),
    // Deliberately no policy, slots, explanation, SOC, deadline or free text.
  };
}

function sessionSnapshot(diagnostics, now) {
  if (!diagnostics || typeof diagnostics !== 'object' || Array.isArray(diagnostics)) return null;
  const entries = Object.values(diagnostics).slice(0, 100);
  return {
    sampledAccounts: entries.length,
    truncated: Object.keys(diagnostics).length > entries.length,
    accounts: entries.map((d) => ({
      attemptAgeMinutes: sourceAge({ updatedAt: d?.lastAttempt }, now).ageMinutes,
      lastCheckFailed: typeof d?.lastError === 'string' ? d.lastError.length > 0 : null,
      saving: Object.fromEntries(['valid', 'expired', 'tracked', 'suppressed', 'overflow'].map((key) => [key, count(d?.saving?.[key])])),
      powerUp: Object.fromEntries(['valid', 'expired', 'tracked', 'suppressed', 'overflow'].map((key) => [key, count(d?.freeElectricity?.[key])])),
    })),
  };
}

function dispatchSnapshot(diagnostics, now) {
  if (!diagnostics || typeof diagnostics !== 'object' || Array.isArray(diagnostics)) return null;
  return {
    attemptAgeMinutes: sourceAge({ updatedAt: diagnostics.lastAttempt }, now).ageMinutes,
    ...Object.fromEntries(['accounts', 'activeAccounts', 'plannedWindows', 'errors', 'eligible', 'ineligible', 'unknown', 'degraded', 'stale', 'successfulEmptyPlans'].map((key) => [key, count(diagnostics[key])])),
  };
}

/** Construct by allowlist, never serialize/redact raw device or settings objects. */
function supportSnapshot({
  version, meters, sessions, dispatch, driverReads, mini,
}, now = Date.now()) {
  return {
    schemaVersion: 1,
    appVersion: typeof version === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version) ? version : null,
    generatedAt: new Date(now).toISOString(),
    scope: 'Cached software diagnostics only; not physical acceptance or complete price coverage. Review before sharing; counts and plan limits can reveal household behaviour.',
    driverReads: ['electricity', 'gas', 'export'].map((driver) => ({
      driver, available: driverReads?.[driver] === true,
    })),
    metersTruncated: meters.length > 100,
    meters: meters.slice(0, 100).map((m, index) => ({
      meter: index + 1, // Ephemeral position, not a stable device identity.
      kind: ['electricity', 'gas', 'export'].includes(m.kind) ? m.kind : 'unknown',
      freshnessRead: m.freshnessRead === true,
      problem: typeof m.freshness?.problem === 'boolean' ? m.freshness.problem : null,
      sources: Object.fromEntries(AREAS.map((area) => [area, sourceAge(m.freshness?.sources?.[area], now)])),
      plan: m.kind === 'electricity' ? planSnapshot(m.plan) : null,
      miniDelivery: m.kind === 'electricity' ? miniDelivery(m.miniDelivery, now) : null,
    })),
    sessions: sessionSnapshot(sessions, now),
    dispatch: dispatchSnapshot(dispatch, now),
    mini: miniSnapshot(mini, now),
  };
}

module.exports = { supportSnapshot };
