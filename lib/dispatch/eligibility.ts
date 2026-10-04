'use strict';

import { isBudgetError } from '../KrakenBudget';
import { DispatchEligibility, SmartFlexDevice } from './types';

export class DispatchSchemaError extends Error {

  constructor() {
    super('Dispatch response is missing or malformed; retaining the previous plan.');
    this.name = 'DispatchSchemaError';
  }

}

export function deviceEligibility(devices: SmartFlexDevice[], now = Date.now()): DispatchEligibility {
  let state: DispatchEligibility['state'] = 'unknown';
  let reason: DispatchEligibility['reason'] = devices.length ? 'unknown-device' : 'no-device';
  if (devices.some((d) => d.participating || d.category === 'EV' || d.category === 'CHARGE_POINT')) {
    state = 'eligible';
    reason = 'device-supported';
  } else if (devices.length && devices.every((d) => ['BATTERY', 'HEAT_PUMP', 'INVERTER'].includes(d.category) && d.controlState !== null && !d.participating)) {
    state = 'ineligible';
    reason = 'unsupported-category';
  }
  return { state, reason, observedAt: new Date(now).toISOString() };
}

export function dispatchFailure(err: unknown, now = Date.now()): DispatchEligibility {
  const status = (err as { status?: number } | null)?.status;
  let reason: DispatchEligibility['reason'] = 'provider-error';
  if (status === 401 || status === 403) reason = 'authentication';
  else if (status === 429 || isBudgetError(err)) reason = 'throttled';
  else if (status === 0 || (status !== undefined && status >= 500)) reason = 'transient';
  else if (err instanceof DispatchSchemaError) reason = 'schema';
  return { state: 'degraded', reason, observedAt: new Date(now).toISOString() };
}

/** Validate the entire snapshot, not filter out malformed rows into a false empty plan. */
export function validDispatchRows(value: unknown): value is Array<{ start?: string; end?: string }> {
  return Array.isArray(value) && value.every((row) => {
    if (!row || typeof row !== 'object') return false;
    const rawStart = row.start ?? row.startDt;
    const rawEnd = row.end ?? row.endDt;
    if (typeof rawStart !== 'string' || typeof rawEnd !== 'string') return false;
    const start = Date.parse(rawStart);
    const end = Date.parse(rawEnd);
    return Number.isFinite(start) && Number.isFinite(end) && end > start;
  });
}
