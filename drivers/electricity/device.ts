'use strict';

import { Rate } from '../../lib/rates';
import { OctopusMeterDevice } from '../../lib/OctopusMeterDevice';

module.exports = class ElectricityDevice extends OctopusMeterDevice {

  private previousPrice: number | null = null;

  private previousLevel: string | null = null;

  private livePowerTimer: NodeJS.Timeout | null = null;

  private liveDeviceId: string | null = null;

  /** Enable live power polling if the setting is on (opt-in, Home Mini only). */
  protected async onInitExtra(): Promise<void> {
    if (this.getSetting('live_power')) {
      await this.enableLivePower();
    } else if (this.hasCapability('measure_power')) {
      await this.removeCapability('measure_power').catch((err) => this.error('Remove measure_power failed:', err));
    }
  }

  private async enableLivePower(): Promise<void> {
    if (!this.hasCapability('measure_power')) {
      await this.addCapability('measure_power').catch((err) => this.error('Add measure_power failed:', err));
    }
    await this.pollLivePower();
    this.livePowerTimer = this.homey.setInterval(() => {
      this.pollLivePower().catch((err) => this.error('Live power poll failed:', err));
    }, 30_000);
  }

  private async disableLivePower(): Promise<void> {
    if (this.livePowerTimer) {
      this.homey.clearInterval(this.livePowerTimer);
      this.livePowerTimer = null;
    }
    if (this.hasCapability('measure_power')) {
      await this.removeCapability('measure_power').catch((err) => this.error('Remove measure_power failed:', err));
    }
  }

  private async pollLivePower(): Promise<void> {
    const accountNumber = this.getStoreValue('accountNumber');
    if (!accountNumber) return;
    if (!this.liveDeviceId) {
      this.liveDeviceId = await this.kraken.getElectricityDeviceId(accountNumber);
    }
    if (!this.liveDeviceId) return; // No Home Mini on this account.
    const watts = await this.kraken.getDemand(this.liveDeviceId);
    if (watts !== null && this.hasCapability('measure_power')) {
      await this.setCapabilityValue('measure_power', Math.round(watts)).catch(this.error);
    }
  }

  async onSettings(event: { oldSettings: Record<string, unknown>; newSettings: Record<string, unknown>; changedKeys: string[] }): Promise<void> {
    await super.onSettings(event);
    if (event.changedKeys.includes('live_power')) {
      if (event.newSettings.live_power) {
        await this.enableLivePower();
      } else {
        await this.disableLivePower();
      }
    }
  }

  async onDeleted(): Promise<void> {
    await this.disableLivePower();
    await super.onDeleted();
  }

  async onUninit(): Promise<void> {
    if (this.livePowerTimer) {
      this.homey.clearInterval(this.livePowerTimer);
      this.livePowerTimer = null;
    }
    await super.onUninit();
  }

  /** Fire Flow triggers when the half-hourly unit rate changes. */
  protected async onPriceUpdated(value: number, rate: Rate): Promise<void> {
    await super.onPriceUpdated(value, rate);

    const prev = this.previousPrice;
    const levelNow = this.getPriceLevel();

    // Only fire on a genuine change after a baseline is set (avoids firing on
    // every app restart / first refresh).
    if (prev !== null && value !== prev) {
      this.trigger('price_changed', { price: value, previous: prev });
      this.trigger('price_below', { price: value }, { price: value });
      if (value < 0) this.trigger('price_plunge', { price: value });
      this.trigger('cheapest_slot_started', { price: value }, {});
      if (levelNow && levelNow !== this.previousLevel) {
        this.trigger('price_level_changed', {
          level: levelNow,
          previous: this.previousLevel ?? 'normal',
        });
      }
    }

    this.previousPrice = value;
    this.previousLevel = levelNow;
  }

  private trigger(id: string, tokens: Record<string, unknown>, state: Record<string, unknown> = {}): void {
    this.homey.flow.getDeviceTriggerCard(id)
      .trigger(this, tokens, state)
      .catch((err) => this.error(`Trigger ${id} failed:`, err));
  }

};
