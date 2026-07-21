'use strict';

/** The availability/health decision for a meter device, derived purely from the
 *  outcome of a refresh cycle. Kept free of Homey/device dependencies so it can
 *  be unit-tested in isolation and reused by the device façade. */
export interface RefreshHealthDecision {
  alarm: boolean;
  fullyHealthy: boolean;
  priceDegraded: boolean;
  markAvailable: boolean;
  markUnavailable: boolean;
  message: string | null;
  warning: string | null;
  authenticationFailure: boolean;
}

/** Convert refresh results into stable Homey availability behaviour. */
export function refreshHealthDecision(
  anySucceeded: boolean,
  priceSucceeded: boolean,
  hasTariff: boolean,
  consecutiveTotalFailures: number,
  err: unknown,
): RefreshHealthDecision {
  const fullyHealthy = anySucceeded && (priceSucceeded || !hasTariff);
  if (fullyHealthy) {
    return {
      alarm: false,
      fullyHealthy: true,
      priceDegraded: false,
      markAvailable: true,
      markUnavailable: false,
      message: null,
      warning: null,
      authenticationFailure: false,
    };
  }

  const raw = err instanceof Error ? err.message : String(err ?? '');
  const authenticationFailure = /401|authenticat|api key/i.test(raw);

  // A price-only degradation: connectivity and authentication are fine (at
  // least one other integration succeeded, no auth error) but the current
  // tariff price is missing. This is a data gap, not a connection problem, so
  // it must NOT raise the generic connection alarm — surface it as an advisory
  // warning instead and keep the device available.
  const priceDegraded = anySucceeded && !authenticationFailure && hasTariff && !priceSucceeded;
  if (priceDegraded) {
    return {
      alarm: false,
      fullyHealthy: false,
      priceDegraded: true,
      markAvailable: true,
      markUnavailable: false,
      message: null,
      warning: 'Current tariff price is temporarily unavailable.',
      authenticationFailure: false,
    };
  }

  let message = 'Octopus Energy is temporarily unavailable.';
  if (authenticationFailure) {
    message = 'Authentication failed - repair the device to update your API key.';
  }

  return {
    alarm: true,
    fullyHealthy: false,
    priceDegraded: false,
    markAvailable: anySucceeded && !authenticationFailure,
    markUnavailable: authenticationFailure || (!anySucceeded && consecutiveTotalFailures >= 3),
    message,
    warning: null,
    authenticationFailure,
  };
}
