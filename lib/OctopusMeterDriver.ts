'use strict';

import Homey from 'homey';
import { OctopusClient, FuelType, DiscoveredMeter } from './OctopusClient';
import { productCodeFromTariff } from './rates';

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
    return { apiKey: key, accountNumber: acc };
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
      if (data.manual_mpxn && data.manual_serial && data.manual_tariff) {
        const tariffCode = String(data.manual_tariff).trim().toUpperCase();
        this.pairMeters = [{
          fuel: this.fuel,
          mpxn: String(data.manual_mpxn).trim(),
          serial: String(data.manual_serial).trim(),
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
      const match = meters.find((m) => m.mpxn === wanted) ?? meters[0];
      await device.setStoreValue('apiKey', creds.apiKey);
      await device.setStoreValue('accountNumber', creds.accountNumber);
      await device.setStoreValue('mpxn', match.mpxn);
      await device.setStoreValue('serial', match.serial);
      await device.setStoreValue('fuel', match.fuel);
      await device.setStoreValue('isExport', match.isExport);
      await device.setStoreValue('productCode', match.productCode);
      await device.setStoreValue('tariffCode', match.tariffCode);
      // Rebuild the API clients so the new key takes effect immediately.
      const meterDevice = device as Homey.Device & { applyCredentials?: () => Promise<void> };
      if (typeof meterDevice.applyCredentials === 'function') {
        await meterDevice.applyCredentials();
      }
      return { done: true };
    });
  }
}
