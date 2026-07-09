'use strict';

import Homey from 'homey';
import { OctopusClient, FuelType, DiscoveredMeter } from './OctopusClient';
import { productCodeFromTariff } from './rates';
import { Credentials, normaliseCredentials, normaliseManualMeter } from './credentials';

interface PairDevice {
  name: string;
  data: { id: string };
  store: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

/**
 * Shared driver base providing credential-based pairing and repair for a given
 * fuel type. Pairing state is scoped to each PairSession so overlapping pairing
 * sessions cannot see or overwrite one another's credentials or meter results.
 */
export class OctopusMeterDriver extends Homey.Driver {

  protected fuel: FuelType = 'electricity';

  private async discover(creds: Credentials): Promise<DiscoveredMeter[]> {
    const client = new OctopusClient({ apiKey: creds.apiKey });
    const meters = await client.discoverMeters(creds.accountNumber);
    const matching = meters.filter((m) => this.accepts(m));
    if (!matching.length) {
      throw new Error('No matching meters were found on this Octopus account.');
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

  private toDevice(meter: DiscoveredMeter, creds: Credentials): PairDevice {
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
    // Never put these on the singleton Driver: one isolated state per session.
    let pairCreds: Credentials | null = null;
    let pairMeters: DiscoveredMeter[] = [];

    session.setHandler('login', async (data: {
      apiKey: string; account: string;
      manual_mpxn?: string; manual_serial?: string; manual_tariff?: string;
    }) => {
      const creds = normaliseCredentials(data.apiKey, data.account);
      const manualValues = [data.manual_mpxn, data.manual_serial, data.manual_tariff];
      const hasAnyManual = manualValues.some((value) => String(value ?? '').trim() !== '');
      const hasAllManual = manualValues.every((value) => String(value ?? '').trim() !== '');

      if (hasAnyManual && !hasAllManual) {
        throw new Error('Enter the meter point, serial number and tariff code, or leave all three blank.');
      }

      if (hasAllManual) {
        // Manual meter entry bypasses discovery, but credentials must still
        // authenticate successfully before any secret is persisted.
        await new OctopusClient({ apiKey: creds.apiKey }).getAccount(creds.accountNumber);
        const manual = normaliseManualMeter({
          mpxn: data.manual_mpxn,
          serial: data.manual_serial,
          tariffCode: data.manual_tariff,
        }, this.fuel);
        const productCode = productCodeFromTariff(manual.tariffCode);
        if (!productCode) throw new Error('The tariff code could not be recognised.');
        pairMeters = [{
          fuel: this.fuel,
          mpxn: manual.mpxn,
          serial: manual.serial,
          isExport: this.fuel === 'electricity' ? this.manualIsExport() : false,
          tariffCode: manual.tariffCode,
          productCode,
        }];
      } else {
        pairMeters = await this.discover(creds);
      }
      pairCreds = creds;
      return true;
    });

    session.setHandler('list_devices', async () => {
      if (!pairCreds) return [];
      return pairMeters.map((meter) => this.toDevice(meter, pairCreds as Credentials));
    });
  }

  async onRepair(session: Homey.Driver.PairSession, device: Homey.Device): Promise<void> {
    session.setHandler('login', async (data: { apiKey: string; account: string }) => {
      const creds = normaliseCredentials(data.apiKey, data.account);
      const meters = await this.discover(creds);
      const wanted = String(device.getStoreValue('mpxn') ?? '');
      const match = meters.find((meter) => meter.mpxn === wanted);
      if (!match) {
        throw new Error('The existing meter was not found on this Octopus account.');
      }

      const replacement: Record<string, unknown> = {
        apiKey: creds.apiKey,
        accountNumber: creds.accountNumber,
        mpxn: match.mpxn,
        serial: match.serial,
        fuel: match.fuel,
        isExport: match.isExport,
        productCode: match.productCode,
        tariffCode: match.tariffCode,
      };
      const previous = Object.fromEntries(
        Object.keys(replacement).map((key) => [key, device.getStoreValue(key)]),
      );
      const meterDevice = device as Homey.Device & { applyCredentials?: () => Promise<void> };

      try {
        for (const [key, value] of Object.entries(replacement)) {
          await device.setStoreValue(key, value);
        }
        if (typeof meterDevice.applyCredentials === 'function') {
          await meterDevice.applyCredentials();
        }
      } catch (err) {
        // Best-effort rollback keeps a failed repair from leaving mixed state.
        for (const [key, value] of Object.entries(previous)) {
          await device.setStoreValue(key, value).catch(() => undefined);
        }
        if (typeof meterDevice.applyCredentials === 'function') {
          await meterDevice.applyCredentials().catch(() => undefined);
        }
        throw new Error('The device could not be repaired; its previous credentials were restored.');
      }

      return { done: true };
    });
  }
}
