'use strict';

/** Explicit-input estimate only. Power is AC input kW, capacity is usable kWh.
 * No telemetry acquisition or battery control; reject stale/unknown inputs.
 */
function estimateBatteryDuration(input, now = Date.now()) {
  const {
    currentSoc, targetSoc, capacity, power, efficiency, readAt, maxAgeMinutes,
  } = input;
  if (![currentSoc, targetSoc, capacity, power, efficiency, maxAgeMinutes, now].every(Number.isFinite)
    || currentSoc < 0 || currentSoc > 100 || targetSoc < 0 || targetSoc > 100
    || capacity < 0.1 || capacity > 1000 || power < 0.01 || power > 1000 || efficiency < 1 || efficiency > 100
    || maxAgeMinutes < 1 || maxAgeMinutes > 60) throw new Error('Enter valid SOC percentages, usable capacity, AC charging power, efficiency and a maximum reading age of 1–60 minutes.');
  const parts = typeof readAt === 'string' ? readAt.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/) : null;
  const calendarValid = parts && Number(parts[2]) >= 1 && Number(parts[2]) <= 12
    && Number(parts[3]) >= 1 && Number(parts[3]) <= new Date(Date.UTC(Number(parts[1]), Number(parts[2]), 0)).getUTCDate()
    && Number(parts[4]) < 24 && Number(parts[5]) < 60 && Number(parts[6]) < 60;
  const measured = calendarValid ? Date.parse(readAt) : NaN;
  if (!Number.isFinite(measured) || measured > now || now - measured > maxAgeMinutes * 60000) {
    throw new Error('Battery SOC reading is missing, invalid, in the future or too old. Supply its actual timestamp.');
  }
  const storedKwh = (capacity * Math.max(0, targetSoc - currentSoc)) / 100;
  const inputKwh = storedKwh / (efficiency / 100);
  const duration = inputKwh / power;
  if (![storedKwh, inputKwh, duration].every(Number.isFinite) || duration > 24) {
    throw new Error('Estimated charging duration exceeds the supported 24-hour plan. Check capacity and power; no partial target is assumed.');
  }
  return {
    duration_hours: duration,
    stored_energy_kwh: storedKwh,
    input_energy_kwh: inputKwh,
    needs_charge: storedKwh > 0,
    estimate_label: 'Estimated from supplied battery SOC, usable capacity, constant AC power and efficiency; not measured charging or a guarantee of target SOC. Native battery limits and stop Flows remain required.',
  };
}

module.exports = { estimateBatteryDuration };
