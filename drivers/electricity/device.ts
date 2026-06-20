'use strict';

import { Rate } from '../../lib/rates';
import { OctopusMeterDevice } from '../../lib/OctopusMeterDevice';
import {
  CarbonClient, CarbonPoint, carbonLevelId, isGreenestNow,
} from '../../lib/carbon';

module.exports = class ElectricityDevice extends OctopusMeterDevice {

  private previousPrice: number | null = null;

  private previousLevel: string | null = null;

  private livePowerTimer: NodeJS.Timeout | null = null;

  private liveDeviceId: string | null = null;

  private carbon = new CarbonClient();

  private carbonNow: number | null = null;

  private carbonForecast: CarbonPoint[] = [];

  private previousCarbonLevel: string | null = null;

  /** Enable live power polling if the setting is on (opt-in, Home Mini only). */
  protected async onInitExtra(): Promise<void> {
    if (this.getSetting('live_power')) {
      await this.enableLivePower();
    } else if (this.hasCapability('measure_power')) {
      await this.removeCapability('measure_power').catch((err) => this.error('Remove measure_power failed:', err));
    }
  }

  /** After consumption, update the smart-charge window and carbon capabilities. */
  protected async refreshExtra(): Promise<void> {
    await super.refreshExtra();
    await this.updateSmartCharge();
    await this.refreshCarbon().catch((err) => this.error('Carbon refresh failed:', err));
  }

  private async refreshCarbon(): Promise<void> {
    if (!this.hasCapability('measure_octopus_carbon')) return;
    const current = await this.carbon.getCurrent();
    if (current) {
      const prev = this.carbonNow;
      this.carbonNow = current.intensity;
      await this.setCapabilityValue('measure_octopus_carbon', Math.round(current.intensity)).catch(this.error);
      if (this.hasCapability('octopus_carbon_level')) {
        const level = carbonLevelId(current.index);
        await this.setCapabilityValue('octopus_carbon_level', level).catch(this.error);
        if (this.previousCarbonLevel !== null && level !== this.previousCarbonLevel) {
          this.trigger('carbon_level_changed', { level, previous: this.previousCarbonLevel });
        }
        this.previousCarbonLevel = level;
      }
      if (prev !== null && Math.round(prev) !== Math.round(current.intensity)) {
        this.trigger('carbon_below', { carbon: Math.round(current.intensity) }, { carbon: current.intensity });
      }
    }
    this.carbonForecast = await this.carbon.getForecast();
    await this.updateGoodNow();
  }

  /** "Good time to use power" = cheap (≤ threshold) and reasonably green. */
  private async updateGoodNow(): Promise<void> {
    if (!this.hasCapability('octopus_good_now')) return;
    const price = this.getCurrentPrice();
    const cheap = Number(this.getSetting('cheap_threshold'));
    const cheapTh = Number.isFinite(cheap) ? cheap : 15;
    const level = this.getCarbonLevel();
    const greenish = level === null || ['very_low', 'low', 'moderate'].includes(level);
    const good = price !== null && price <= cheapTh && greenish;
    await this.setCapabilityValue('octopus_good_now', good).catch(this.error);
  }

  /** Current carbon intensity (gCO₂/kWh), or null. */
  getCarbon(): number | null {
    return this.carbonNow;
  }

  /** Is the current half-hour the greenest in the forward window? */
  isGreenestNow(withinHours?: number): boolean {
    return isGreenestNow(this.carbonForecast, new Date(), withinHours);
  }

  /** Current carbon level enum id, or null. */
  getCarbonLevel(): string | null {
    if (!this.hasCapability('octopus_carbon_level')) return null;
    return (this.getCapabilityValue('octopus_carbon_level') as string) ?? null;
  }

  private async updateSmartCharge(): Promise<void> {
    if (!this.hasCapability('octopus_smart_charge')) return;
    const hours = Number(this.getSetting('smart_charge_hours')) || 3;
    const by = String(this.getSetting('smart_charge_by') || '07:00');
    const inPlan = this.isInCheapestPlan(hours, by);
    const prev = this.getCapabilityValue('octopus_smart_charge');
    await this.setCapabilityValue('octopus_smart_charge', inPlan).catch(this.error);
    if (prev !== null && prev !== inPlan) {
      this.trigger(inPlan ? 'smart_charge_started' : 'smart_charge_ended', {});
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
      if (value < 0) {
        this.trigger('price_plunge', { price: value });
        if (this.notifyEnabled('notify_plunge', true)) {
          this.notify(`⚡ Octopus price is negative: ${value.toFixed(2)} p/kWh — use power now!`).catch((err) => this.error(err));
        }
      }
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
