'use strict';

import Homey from 'homey';
import { OctopusClient, FuelType, DiscoveredMeter } from './OctopusClient';
import { productCodeFromTariff } from './rates';
import type { MeterStore } from './OctopusMeterDevice';

interface Creds {
  apiKey: string;
  accountNumber: string;
}

interface PairDevice {
  name: string;
  data: { id: string };
  store: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

/**
 * Shared driver base providing credential-based pairing and repair for a given
 * fuel type. The custom `start` pairing view collects an API key + account
 * number, we validate them by discovering meters, then present the matching
 * meters as devices to add.
 */
export class OctopusMeterDriver extends Homey.Driver {

  protected fuel: FuelType = 'electricity';

  private pairCreds: Creds | null = null;

  private pairMeters: DiscoveredMeter[] = [];

  private normalise(apiKey: unknown, account: unknown): Creds {
    const key = String(apiKey ?? '').trim();
    const acc = String(account ?? '').trim().toUpperCase();
    if (!key) throw new Error('Please enter your Octopus API key.');
    if (!acc) throw new Error('Please enter your account number (e.g. A-AAAA1111).');
    if (!/^A-[A-Z0-9]+$/.test(acc)) {
      throw new Error('Your Octopus account number should look like A-XXXXXXXX.');
    }
    return { apiKey: key, accountNumber: acc };
  }

  private async validateCredentials(creds: Creds): Promise<void> {
    const client = new OctopusClient({ apiKey: creds.apiKey });
    await client.getAccount(creds.accountNumber);
  }

  private async discover(creds: Creds): Promise<DiscoveredMeter[]> {
    const client = new OctopusClient({ apiKey: creds.apiKey });
    const meters = await client.discoverMeters(creds.accountNumber);
    const matching = meters.filter((m) => this.accepts(m));
    if (!matching.length) {
      throw new Error(`No matching meters were found on account ${creds.accountNumber}.`);
    }
    return matching;
  }

  /**
   * Whether a discovered meter belongs to this driver. Defaults to a fuel match;
   * the electricity/export drivers narrow this further by import vs. export.
   */
  protected accepts(meter: DiscoveredMeter): boolean {
    return meter.fuel === this.fuel;
  }

  protected deviceName(meter: DiscoveredMeter): string {
    const label = this.fuel === 'electricity' ? 'Electricity Meter' : 'Gas Meter';
    const suffix = meter.isExport ? ' (Export)' : '';
    const tail = meter.mpxn ? ` ·${meter.mpxn.slice(-4)}` : '';
    return `${label}${suffix}${tail}`;
  }

  private toDevice(meter: DiscoveredMeter, creds: Creds): PairDevice {
    return {
      name: this.deviceName(meter),
      data: { id: `${meter.fuel}-${meter.mpxn}-${meter.serial}` },
      store: {
        apiKey: creds.apiKey,
        accountNumber: creds.accountNumber,
        mpxn: meter.mpxn,
        serial: meter.serial,
        fuel: meter.fuel,
        isExport: meter.isExport,
        productCode: meter.productCode,
        tariffCode: meter.tariffCode,
      },
    };
  }

  /** Export driver overrides this so a manually-entered electricity meter is marked as export. */
  protected manualIsExport(): boolean {
    return false;
  }

  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    session.setHandler('login', async (data: {
      apiKey: string; account: string;
      manual_mpxn?: string; manual_serial?: string; manual_tariff?: string;
    }) => {
      const creds = this.normalise(data.apiKey, data.account);
      const manual = [data.manual_mpxn, data.manual_serial, data.manual_tariff]
        .map((value) => String(value ?? '').trim());
      if (manual.some(Boolean) && !manual.every(Boolean)) {
        throw new Error('Manual setup requires the meter number, serial number, and full tariff code.');
      }
      if (manual.every(Boolean)) {
        const [mpxn, serial, rawTariff] = manual;
        if (!/^\d{6,20}$/.test(mpxn)) {
          throw new Error('The MPAN or MPRN must contain digits only.');
        }
        if (!/^[A-Za-z0-9 ._-]{1,64}$/.test(serial)) {
          throw new Error('The meter serial number contains unsupported characters.');
        }
        const expectedPrefix = this.fuel === 'gas' ? 'G-' : 'E-';
        const tariffCode = rawTariff.toUpperCase();
        if (!tariffCode.startsWith(expectedPrefix) || !/^[EG]-\d+R-[A-Z0-9-]+-[A-P]$/.test(tariffCode)) {
          throw new Error(`Enter a full ${this.fuel} tariff code including its region letter.`);
        }
        await this.validateCredentials(creds);
        this.pairMeters = [{
          fuel: this.fuel,
          mpxn,
          serial,
          isExport: this.fuel === 'electricity' ? this.manualIsExport() : false,
          tariffCode,
          productCode: productCodeFromTariff(tariffCode),
        }];
      } else {
        this.pairMeters = await this.discover(creds);
      }
      this.pairCreds = creds;
      return true;
    });

    session.setHandler('list_devices', async () => {
      if (!this.pairCreds) return [];
      return this.pairMeters.map((m) => this.toDevice(m, this.pairCreds as Creds));
    });
  }

  async onRepair(session: Homey.Driver.PairSession, device: Homey.Device): Promise<void> {
    session.setHandler('login', async (data: { apiKey: string; account: string }) => {
      const creds = this.normalise(data.apiKey, data.account);
      const meters = await this.discover(creds);
      const wanted = device.getStoreValue('mpxn');
      const wantedSerial = device.getStoreValue('serial');
      const match = meters.find((m) => m.mpxn === wanted && m.serial === wantedSerial);
      if (!match) {
        throw new Error('The original meter was not found on this account. Add it as a new device if the meter has been replaced.');
      }
      const nextStore: MeterStore = {
        apiKey: creds.apiKey,
        accountNumber: creds.accountNumber,
        mpxn: match.mpxn,
        serial: match.serial,
        fuel: match.fuel,
        isExport: match.isExport,
        productCode: match.productCode,
        tariffCode: match.tariffCode,
      };
      // Let the meter device wait for any in-flight refresh, write the new
      // credentials, clear account-scoped caches, and refresh as one operation.
      const meterDevice = device as Homey.Device & {
        applyCredentials?: (store: MeterStore) => Promise<void>;
      };
      if (typeof meterDevice.applyCredentials === 'function') {
        await meterDevice.applyCredentials(nextStore);
      } else {
        for (const [key, value] of Object.entries(nextStore)) {
          // eslint-disable-next-line no-await-in-loop
          await device.setStoreValue(key, value);
        }
      }
      return { done: true };
    });
  }
}
