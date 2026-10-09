'use strict';

const SOURCES = {
  prices: ['Tariff prices', 'Wait for the background price update. Missing future prices are not proof that no cheap periods exist.'],
  meter_data: ['Consumption and cost', 'Octopus consumption is delayed settlement data, not live demand. Wait for the background update; missing readings are not zero usage.'],
  balance: ['Account balance', 'Wait for the background account update. A missing balance is not £0.'],
  carbon: ['Carbon forecast', 'Wait for a complete background forecast. Missing intensity is not zero carbon.'],
  billing_summary: ['Billing summary', 'Wait for complete settled consumption and tariff coverage. Retained costs are not a new settled result.'],
  monthly_cost: ['Monthly cost', 'Wait for complete settled consumption and tariff coverage. Retained costs are not a new settled result.'],
};

/** A source-specific badge must never inherit the whole-device refresh time. */
function sourceAge(source, now = Date.now()) {
  const stamp = typeof source?.updatedAt === 'string' ? Date.parse(source.updatedAt) : NaN;
  const valid = Number.isFinite(stamp) && stamp <= now;
  return {
    state: valid && ['current', 'stale'].includes(source?.state) ? source.state : 'unknown',
    ageMinutes: valid ? Math.floor((now - stamp) / 60000) : null,
  };
}

function summaryMetricFreshness(freshness, values, now = Date.now()) {
  const mapping = {
    balance: 'balance', usage: 'meter_data', cost: 'meter_data', month: 'monthly_cost', points: 'points',
  };
  return Object.fromEntries(Object.entries(mapping).map(([metric, source]) => {
    const age = sourceAge(freshness?.sources?.[source], now);
    if (typeof values?.[metric] !== 'number' || !Number.isFinite(values[metric])) age.state = 'unknown';
    if (freshness?.problem === true && age.state === 'current') age.state = 'stale';
    return [metric, { source, ...age }];
  }));
}

/** Whitelisted, identifier/error-payload-free guidance from cached source state. */
function dataHealthView(freshness, dispatch, now = Date.now()) {
  const sources = freshness?.sources ?? {};
  const items = Object.entries(SOURCES).map(([key, [label, advice]]) => {
    const source = sources[key];
    const parsed = Date.parse(source?.updatedAt ?? '');
    const valid = Number.isFinite(parsed) && parsed <= now;
    const state = valid && ['current', 'stale'].includes(source?.state) ? source.state : 'unknown';
    let message = advice;
    if (state === 'current') {
      message = key === 'meter_data' ? 'Last successful source update; settlement can still lag behind today.' : 'Last successful source update; not a guarantee of complete future coverage.';
    }
    return {
      label,
      state,
      updatedAt: valid ? new Date(parsed).toISOString() : null,
      ageMinutes: valid ? Math.floor((now - parsed) / 60000) : null,
      advice: message,
    };
  });
  if (dispatch) {
    const eligibility = dispatch.eligibility?.state;
    let state = 'unknown';
    let advice = 'Eligibility is not confirmed. Leave dispatch controls off and wait for a successful background account check.';
    if (eligibility === 'ineligible') {
      state = 'unsupported';
      advice = 'Dispatches are not supported for this account/device. Ordinary tariff and consumption features can still work; do not delete or re-pair the meter.';
    } else if (eligibility === 'degraded' || dispatch.freshness === 'stale') {
      state = 'stale';
      advice = 'Dispatch data is temporarily unavailable. Retained intent is not permission to charge; background recovery will retry. Do not re-pair a healthy meter.';
    } else if (eligibility === 'eligible' && dispatch.freshness === 'current') {
      state = 'current';
      advice = 'Fresh dispatch intent is not a billed household rate or proof of physical charging.';
    }
    items.push({
      label: 'Intelligent dispatch', state, updatedAt: null, ageMinutes: null, advice,
    });
  }
  return {
    problem: freshness?.problem === true,
    advice: freshness?.problem === true ? 'Some data is unavailable. Check source details; only update credentials through Repair if authentication actually failed. Do not delete the meter.' : 'Sources update independently; optional sources may not apply to your meter. Current means a recent source update, not live consumption or full future price coverage.',
    items,
  };
}

module.exports = { dataHealthView, sourceAge, summaryMetricFreshness };
