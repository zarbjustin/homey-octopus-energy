'use strict';

const DEFAULT_THRESHOLDS = Object.freeze({
  greenMax: 10,
  yellowMax: 20,
  orangeMax: 30,
});

const VALID_PALETTES = new Set(['standard', 'colourblind', 'high_contrast']);
const VALID_MODES = new Set(['price_bands', 'cheapest_slots']);

function finiteNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normaliseThresholds(input = {}) {
  const supplied = [input.greenMax, input.yellowMax, input.orangeMax]
    .some((value) => value !== '' && value !== null && value !== undefined);
  const greenMax = finiteNumber(input.greenMax);
  const yellowMax = finiteNumber(input.yellowMax);
  const orangeMax = finiteNumber(input.orangeMax);
  const valid = greenMax !== null
    && yellowMax !== null
    && orangeMax !== null
    && greenMax >= 0
    && greenMax < yellowMax
    && yellowMax < orangeMax
    && orangeMax <= 200;

  if (!valid) {
    return {
      thresholds: { ...DEFAULT_THRESHOLDS },
      corrected: supplied,
    };
  }
  return {
    thresholds: { greenMax, yellowMax, orangeMax },
    corrected: false,
  };
}

function widgetPriceBandOptions(input = {}) {
  const { thresholds, corrected } = normaliseThresholds(input);
  const palette = VALID_PALETTES.has(input.palette) ? input.palette : 'standard';
  const mode = VALID_MODES.has(input.mode) ? input.mode : 'price_bands';
  return {
    thresholds,
    palette,
    mode,
    corrected,
  };
}

function priceBand(value, thresholds = DEFAULT_THRESHOLDS) {
  const price = Number(value);
  if (!Number.isFinite(price)) return 'unknown';
  if (price < 0) return 'negative';
  if (price <= thresholds.greenMax) return 'green';
  if (price <= thresholds.yellowMax) return 'yellow';
  if (price <= thresholds.orangeMax) return 'orange';
  return 'red';
}

function withPriceBands(rows, options) {
  return rows.map((row) => ({
    ...row,
    band: priceBand(row.price, options.thresholds),
  }));
}

module.exports = {
  DEFAULT_THRESHOLDS,
  normaliseThresholds,
  priceBand,
  widgetPriceBandOptions,
  withPriceBands,
};
