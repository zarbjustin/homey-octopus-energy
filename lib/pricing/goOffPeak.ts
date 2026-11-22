import { Rate } from '../rates';
import { localDateParts, zonedTime } from '../timezone';

const UK = 'Europe/London';

export interface GoPeriod {
  start: number;
  end: number;
  offPeak: boolean;
}

/** Standard UK Go. Require a published price change at the off-peak start
 * and an unambiguous current row contained in the relevant tariff period. */
export function goPeriod(product: unknown, rates: Rate[], at: number): GoPeriod | null {
  if (typeof product !== 'string' || !/^GO(?:-|$)/i.test(product) || !Number.isFinite(at)) return null;
  const { year, month, day } = localDateParts(new Date(at), UK);
  const boundary = (offset: number, hour: number) => zonedTime(year, month, day + offset, UK, hour, 30).getTime();
  const nightStart = boundary(0, 0);
  const nightEnd = boundary(0, 5);
  const rateAt = (instant: number) => {
    const matches = rates.filter((rate) => Date.parse(rate.valid_from) <= instant
      && (rate.valid_to === null || Date.parse(rate.valid_to) > instant));
    return matches.length === 1 && Number.isFinite(matches[0].value_inc_vat) ? matches[0] : null;
  };
  const night = rateAt(nightStart);
  const dayBefore = rateAt(nightStart - 1);
  const current = rateAt(at);
  if (!night || !dayBefore || !current || night.value_inc_vat >= dayBefore.value_inc_vat
    || Date.parse(night.valid_from) !== nightStart || Date.parse(dayBefore.valid_to ?? '') !== nightStart) return null;

  const offPeak = at >= nightStart && at < nightEnd;
  const beforeNight = at < nightStart;
  const daytimeStart = beforeNight ? boundary(-1, 5) : nightEnd;
  const daytimeEnd = beforeNight ? nightStart : boundary(1, 0);
  const start = offPeak ? nightStart : daytimeStart;
  const end = offPeak ? nightEnd : daytimeEnd;
  if (Date.parse(current.valid_from) < start || !(Date.parse(current.valid_to ?? '') <= end)) return null;
  if (offPeak ? current.value_inc_vat >= dayBefore.value_inc_vat : current.value_inc_vat <= night.value_inc_vat) return null;
  return { start, end, offPeak };
}
