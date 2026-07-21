'use strict';

/**
 * Canonical DST-safe wall-clock helpers, parameterised by an IANA timezone so
 * they stay pure and unit-testable. Extracted from `OctopusMeterDevice`'s private
 * date logic (and consolidating the copy that lived in `billing/tz.ts`) as the
 * first step of the S52 device decomposition — behaviour-preserving.
 */

export function tzOffsetMs(date: Date, timeZone: string): number {
  const map: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)) map[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(map.hour), Number(map.minute), Number(map.second),
  );
  return asUtc - date.getTime();
}

/** The UTC instant of a given local wall-clock time in `timeZone` (DST-safe). */
export function zonedTime(
  year: number, month1: number, day: number, timeZone: string, hour = 0, minute = 0,
): Date {
  const utcGuess = Date.UTC(year, month1 - 1, day, hour, minute);
  const offset = tzOffsetMs(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offset);
}

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function localDateParts(date: Date, timeZone: string): LocalDateParts {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** Number of days in a given month (month1 is 1-based). */
export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Local midnight `daysFromNow` days from `now`, in `timeZone` (DST-safe). */
export function localMidnight(timeZone: string, daysFromNow: number, now: Date = new Date()): Date {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)) parts[p.type] = p.value;
  const cal = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  cal.setUTCDate(cal.getUTCDate() + daysFromNow);
  return zonedTime(cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(), timeZone);
}

/** Start of the current local month in `timeZone` (DST-safe). */
export function localMonthStart(timeZone: string, now: Date = new Date()): Date {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit',
  }).formatToParts(now)) parts[p.type] = p.value;
  return zonedTime(Number(parts.year), Number(parts.month), 1, timeZone);
}

/** Number of days in the local month containing `date`. */
export function daysInLocalMonth(date: Date, timeZone: string): number {
  const { year, month } = localDateParts(date, timeZone);
  return daysInMonth(year, month);
}

/** Fractional local days elapsed in the current month (>= 0.5), for projections. */
export function elapsedLocalMonthDays(date: Date, timeZone: string): number {
  const { day, hour, minute } = localDateParts(date, timeZone);
  const dayFraction = (hour * 60 + minute) / 1440;
  return Math.max(0.5, (day - 1) + dayFraction);
}
