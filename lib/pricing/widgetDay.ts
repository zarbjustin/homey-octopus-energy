import {
  cheapestSlots, priceLevel, Rate, rateAt, valueOf,
} from '../rates';
import { localDateParts, localMidnight, zonedTime } from '../timezone';

const HALF_HOUR = 30 * 60_000;

export function buildPriceWidgetDay(
  rates: Rate[],
  {
    timeZone, now, dayOffset, cheapestCount, incVat, thresholds,
  }: {
    timeZone: string;
    now: Date;
    dayOffset: number;
    cheapestCount: number;
    incVat: boolean;
    thresholds: Parameters<typeof priceLevel>[1];
  },
) {
  const start = localMidnight(timeZone, dayOffset, now).getTime();
  const end = localMidnight(timeZone, dayOffset + 1, now).getTime();
  const boundaries = new Set([start, end]);
  const applicable = rates.filter((rate) => {
    const from = Date.parse(rate.valid_from);
    const to = rate.valid_to === null ? Infinity : Date.parse(rate.valid_to);
    if (!(from < end && to > start && from < to)) return false;
    boundaries.add(Math.max(from, start));
    boundaries.add(Math.min(to, end));
    return true;
  });

  // Use the same precedence as current-price lookup. Clip at midnight and leave
  // gaps where no cached rate applies.
  const points = [...boundaries].sort((left, right) => left - right);
  const periods: { from: number; to: number; rate: Rate }[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const rate = rateAt(applicable, new Date(from));
    if (!rate || !Number.isFinite(valueOf(rate, incVat))) continue;
    const previous = periods.at(-1);
    if (previous?.rate === rate && previous.to === from) previous.to = to;
    else periods.push({ from, to, rate });
  }

  const hasLongPeriods = applicable.some((rate) => rate.valid_to === null
    || Date.parse(rate.valid_to) - Date.parse(rate.valid_from) > HALF_HOUR);
  const prices = periods.map(({ rate }) => valueOf(rate, incVat));
  const minimum = Math.min(...prices);
  const variablePrices = prices.some((price) => price > minimum);
  const cheapest = hasLongPeriods
    ? new Set(periods.filter(({ rate }) => cheapestCount > 0 && variablePrices && valueOf(rate, incVat) === minimum)
      .map(({ rate }) => rate))
    : new Set(cheapestSlots(periods.map(({ rate }) => rate), cheapestCount, { incVat }));

  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const percent = (duration: number) => (duration / (end - start)) * 100;
  const { year, month, day } = localDateParts(new Date(start), timeZone);
  const ticks = [0, 6, 12, 18, 24].map((hour) => {
    const instant = hour === 24 ? end : zonedTime(year, month, day, timeZone, hour).getTime();
    return { label: hour === 24 ? '24:00' : format.format(instant), position: percent(instant - start) };
  });
  const slots = periods.map(({ from, to, rate }) => {
    const price = Number(valueOf(rate, incVat).toFixed(2));
    return {
      start: new Date(from).toISOString(),
      end: new Date(to).toISOString(),
      label: format.format(from),
      endLabel: to === end ? '24:00' : format.format(to),
      position: percent(from - start),
      width: percent(to - from),
      price,
      level: priceLevel(price, thresholds),
      current: from <= now.getTime() && now.getTime() < to,
      cheapest: cheapest.has(rate),
    };
  });

  return {
    slots,
    ticks,
    hasLongPeriods,
    // Keep the existing near-full-day publication rule for Agile. Go and
    // other long rates can cover the full day with just one or two intervals.
    available: hasLongPeriods
      ? periods.reduce((duration, { from, to }) => duration + to - from, 0) === end - start
      : slots.length >= 24,
  };
}
