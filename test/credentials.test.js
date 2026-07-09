'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  normaliseCredentials,
  normaliseManualMeter,
} = require('../.homeybuild/lib/credentials.js');

test('normalises valid Octopus credentials', () => {
  const result = normaliseCredentials('  sk_live_example  ', ' a-abcd1234 ');
  assert.deepStrictEqual(result, {
    apiKey: 'sk_live_example',
    accountNumber: 'A-ABCD1234',
  });
});

test('rejects malformed account numbers without echoing the value', () => {
  const privateValue = 'not-an-account';
  assert.throws(
    () => normaliseCredentials('sk_live_example', privateValue),
    (err) => {
      assert.match(err.message, /account number format/i);
      assert.doesNotMatch(err.message, new RegExp(privateValue));
      return true;
    },
  );
});

test('rejects API keys containing control characters', () => {
  assert.throws(
    () => normaliseCredentials('sk_live_value\nInjected', 'A-ABCD1234'),
    /API key format is invalid/,
  );
});

test('validates and normalises electricity manual meter details', () => {
  const meter = normaliseManualMeter({
    mpxn: '1234567890123',
    serial: ' e-import-1 ',
    tariffCode: ' e-1r-agile-flex-22-11-25-c ',
  }, 'electricity');

  assert.deepStrictEqual(meter, {
    mpxn: '1234567890123',
    serial: 'E-IMPORT-1',
    tariffCode: 'E-1R-AGILE-FLEX-22-11-25-C',
  });
});

test('rejects invalid meter point and path-control characters', () => {
  assert.throws(
    () => normaliseManualMeter({
      mpxn: '123/456',
      serial: 'SERIAL/../../X',
      tariffCode: 'E-1R-AGILE-C',
    }, 'electricity'),
    /MPAN must contain exactly 13 digits/,
  );

  assert.throws(
    () => normaliseManualMeter({
      mpxn: '1234567890123',
      serial: 'SERIAL/1',
      tariffCode: 'E-1R-AGILE-C',
    }, 'electricity'),
    /serial number contains unsupported characters/,
  );
});

test('requires the tariff fuel to match the meter type', () => {
  assert.throws(
    () => normaliseManualMeter({
      mpxn: '1234567890123',
      serial: 'E-1',
      tariffCode: 'G-1R-VAR-C',
    }, 'electricity'),
    /does not match the selected meter type/,
  );
});
