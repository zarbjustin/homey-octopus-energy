'use strict';

/**
 * Self-contained, DST-safe wall-clock helpers for the pure billing engine.
 * Mirrors the private timezone logic in OctopusMeterDevice but takes the
 * timezone as a parameter so the billing modules stay pure and unit-testable.
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
