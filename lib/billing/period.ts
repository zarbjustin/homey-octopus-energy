'use strict';

import { BillingPeriod } from './types';
import { zonedTime, localDateParts, daysInMonth } from './tz';

function prevMonth(year: number, month1: number): { year: number; month: number } {
  return month1 === 1 ? { year: year - 1, month: 12 } : { year, month: month1 - 1 };
}

function nextMonth(year: number, month1: number): { year: number; month: number } {
  return month1 === 12 ? { year: year + 1, month: 1 } : { year, month: month1 + 1 };
}

/**
 * Resolve the current billing period. When a valid `billingDay` (1–31) is set,
 * the period runs from the most recent occurrence of that day (clamped to month
 * length) to the next. Otherwise it falls back to the local calendar month.
 * All boundaries are local-midnight and DST-safe.
 */
export function resolveBillingPeriod(now: Date, timeZone: string, billingDay?: number): BillingPeriod {
  const p = localDateParts(now, timeZone);
  if (billingDay && billingDay >= 1 && billingDay <= 31) {
    const anchorDay = Math.min(billingDay, daysInMonth(p.year, p.month));
    const thisAnchor = zonedTime(p.year, p.month, anchorDay, timeZone);
    if (now.getTime() >= thisAnchor.getTime()) {
      const nm = nextMonth(p.year, p.month);
      const end = zonedTime(nm.year, nm.month, Math.min(billingDay, daysInMonth(nm.year, nm.month)), timeZone);
      return { start: thisAnchor.toISOString(), end: end.toISOString(), source: 'user' };
    }
    const pm = prevMonth(p.year, p.month);
    const start = zonedTime(pm.year, pm.month, Math.min(billingDay, daysInMonth(pm.year, pm.month)), timeZone);
    return { start: start.toISOString(), end: thisAnchor.toISOString(), source: 'user' };
  }
  const start = zonedTime(p.year, p.month, 1, timeZone);
  const nm = nextMonth(p.year, p.month);
  const end = zonedTime(nm.year, nm.month, 1, timeZone);
  return { start: start.toISOString(), end: end.toISOString(), source: 'calendar' };
}
