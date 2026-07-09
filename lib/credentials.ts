'use strict';

import type { FuelType } from './OctopusClient';

export interface Credentials {
  apiKey: string;
  accountNumber: string;
}

export interface ManualMeterInput {
  mpxn: unknown;
  serial: unknown;
  tariffCode: unknown;
}

const ACCOUNT_PATTERN = /^A-[A-Z0-9]{8,12}$/;
const MPAN_PATTERN = /^\d{13}$/;
const MPRN_PATTERN = /^\d{6,10}$/;
const SERIAL_PATTERN = /^[A-Z0-9][A-Z0-9 _-]{0,39}$/i;
const TARIFF_PATTERN = /^[EG](?:-[A-Z0-9]+)+$/;

/** Validate and normalise credentials without ever including them in errors. */
export function normaliseCredentials(apiKey: unknown, account: unknown): Credentials {
  const key = String(apiKey ?? '').trim();
  const accountNumber = String(account ?? '').trim().toUpperCase();

  if (!key) throw new Error('Please enter your Octopus API key.');
  if (key.length < 8 || key.length > 200 || /[\r\n]/.test(key)) {
    throw new Error('The Octopus API key format is invalid.');
  }
  if (!accountNumber) {
    throw new Error('Please enter your account number (e.g. A-AAAA1111).');
  }
  if (!ACCOUNT_PATTERN.test(accountNumber)) {
    throw new Error('The Octopus account number format is invalid.');
  }

  return { apiKey: key, accountNumber };
}

/** Validate identifiers before they can become URL segments or device ids. */
export function normaliseManualMeter(
  input: ManualMeterInput,
  fuel: FuelType,
): { mpxn: string; serial: string; tariffCode: string } {
  const mpxn = String(input.mpxn ?? '').trim();
  const serial = String(input.serial ?? '').trim().toUpperCase();
  const tariffCode = String(input.tariffCode ?? '').trim().toUpperCase();

  const meterPointValid = fuel === 'electricity'
    ? MPAN_PATTERN.test(mpxn)
    : MPRN_PATTERN.test(mpxn);
  if (!meterPointValid) {
    throw new Error(fuel === 'electricity'
      ? 'The MPAN must contain exactly 13 digits.'
      : 'The MPRN must contain 6 to 10 digits.');
  }
  if (!SERIAL_PATTERN.test(serial)) {
    throw new Error('The meter serial number contains unsupported characters.');
  }
  if (!TARIFF_PATTERN.test(tariffCode) || !tariffCode.startsWith(fuel === 'electricity' ? 'E-' : 'G-')) {
    throw new Error('The tariff code format does not match the selected meter type.');
  }

  return { mpxn, serial, tariffCode };
}
