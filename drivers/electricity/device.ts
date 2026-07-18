'use strict';

import { Rate, regionFromTariff } from '../../lib/rates';
import { OctopusMeterDevice } from '../../lib/OctopusMeterDevice';
import type { Dispatch } from '../../lib/KrakenClient';
import {
  CarbonClient, CarbonPoint, carbonLevelId, isGreenestNow, regionIdFromGsp,
} from '../../lib/carbon';

module.exports = class ElectricityDevice extends OctopusMeterDevice {

  private previousPrice: number | null = null;

  private previousLevel: string | null = null;

  private livePowerTimer: NodeJS.Timeout | null = null;

  private liveDeviceId: string | null = null;

  private carbon = new CarbonClient();

  private carbonNow: number | null = null;

  private renewableNow: number | null = null;

  private carbonForecast: CarbonPoint[] = [];

  private previousCarbonLevel: string | null = null;

  private dispatching = false;

  private previousHorizon = 0;

  private previousNight: boolean | null = null;

  /** Detect when the rate cache extends to cover new (tomorrow's) prices. */
  protected async onRatesUpdated(): Promise<void> {
    const horizon = this.ratesHorizon();
    if (this.previousHorizon !== 0 && horizon > this.previousHorizon + 3600_000) {
      const ext = this.upcomingExtremes();
      if (ext) {
        this.trigger('rates_published', {
          cheapest: ext.cheapest,
          cheapest_start: ext.cheapestStart,
          most_expensive: ext.expensive,
        });
      }
    }
    this.previousHorizon = horizon;
  }

  /** Is the current half-hour on the Economy 7 night (off-peak) register? */
  isNightRate(): boolean {
    return this.isTwoRegisterTariff() && this.isNightTime(new Date().toISOString());
  }

  /** Is the current price in the cheapest `percent`% of the next `hours`? */
  isCheapestPercentile(percent: number, hours: number): boolean {
    return this.isInCheapestPercentile(percent, hours);
  }

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
    await this.updateNightRate();
    await this.refreshDispatching().catch((err) => this.error('Dispatch refresh failed:', err));
    await this.refreshCarbon().catch((err) => this.error('Carbon refresh failed:', err));
  }

  /** Fire night-rate started/ended triggers for Economy 7 tariffs. */
  private async updateNightRate(): Promise<void> {
    if (!this.isTwoRegisterTariff()) return;
    const night = this.isNightRate();
    if (this.previousNight !== null && night !== this.previousNight) {
      this.trigger(night ? 'night_rate_started' : 'night_rate_ended', {});
    }
    this.previousNight = night;
  }

  /** Reflect whether an Intelligent Octopus Go smart-charge dispatch is active now. */
  private async refreshDispatching(): Promise<void> {
    if (!this.hasCapability('octopus_dispatching')) return;
    const apiKey = this.getStoreValue('apiKey');
    const accountNumber = this.getStoreValue('accountNumber');
    if (!apiKey || !accountNumber) return;
    const app = this.homey.app as typeof this.homey.app & {
      getCachedPlannedDispatches?(key: string, account: string): Promise<Dispatch[]>;
    };
    let dispatches: Dispatch[];
    try {
      dispatches = app.getCachedPlannedDispatches
        ? await app.getCachedPlannedDispatches(apiKey, accountNumber)
        : await this.kraken.getPlannedDispatches(accountNumber);
      this.recordIntegrationDiagnostic('dispatches');
    } catch (err) {
      this.recordIntegrationDiagnostic('dispatches', err);
      throw err;
    }
    const now = Date.now();
    const active = dispatches.some((d) => {
      const start = new Date(d.start).getTime();
      const end = new Date(d.end).getTime();
      return now >= start && now < end;
    });
    this.dispatching = active;
    await this.setCapabilityValue('octopus_dispatching', active).catch(this.error);
  }

  private carbonRegionId(): number | null {
    if (this.getSetting('carbon_region') === 'national') return null;
    return regionIdFromGsp(regionFromTariff(String(this.getStoreValue('tariffCode') || '')));
  }

  private async refreshCarbon(): Promise<void> {
    if (!this.hasCapability('measure_octopus_carbon')) return;
    try {
      const regionId = this.carbonRegionId();
      let current: { intensity: number; index: string } | null = null;
      let renewable: number | null = null;
      if (regionId) {
        const [r, forecast] = await Promise.all([
          this.carbon.getRegional(regionId),
          this.carbon.getRegionalForecast(regionId),
        ]);
        if (r) {
          current = r;
          renewable = r.renewable;
        }
        this.carbonForecast = forecast;
      } else {
        const [national, forecast] = await Promise.all([
          this.carbon.getCurrent(), this.carbon.getForecast(),
        ]);
        current = national;
        this.carbonForecast = forecast;
      }
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
          this.trigger('carbon_below', { carbon: Math.round(current.intensity) }, { carbon: current.intensity, previous: prev });
        }
      }
      if (renewable !== null && this.hasCapability('measure_renewable_percent')) {
        this.renewableNow = renewable;
        await this.setCapabilityValue('measure_renewable_percent', Math.round(renewable)).catch(this.error);
      }
      await this.updateGoodNow();
      this.recordIntegrationDiagnostic('carbon');
    } catch (err) {
      this.recordIntegrationDiagnostic('carbon', err);
      throw err;
    }
  }

  /** "Good time to use power" = cheap (≤ threshold) and reasonably green, or in a smart-charge dispatch. */
  private async updateGoodNow(): Promise<void> {
    if (!this.hasCapability('octopus_good_now')) return;
    const price = this.getCurrentPrice();
    const cheap = Number(this.getSetting('cheap_threshold'));
    const cheapTh = Number.isFinite(cheap) ? cheap : 15;
    const level = this.getCarbonLevel();
    const greenish = level !== null && ['very_low', 'low', 'moderate'].includes(level);
    const cheapAndGreen = price !== null && price <= cheapTh && greenish;
    const good = cheapAndGreen || this.dispatching;
    await this.setCapabilityValue('octopus_good_now', good).catch(this.error);
  }

  /** Current carbon intensity (gCO₂/kWh), or null. */
  getCarbon(): number | null {
    return this.carbonNow;
  }

  /** Current renewable generation percentage, or null. */
  getRenewablePercent(): number | null {
    return this.renewableNow;
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
    const inPlan = this.isInCheapestPlan(hours, by, this.smartChargeMaxPrice());
    const prev = this.getCapabilityValue('octopus_smart_charge');
    await this.setCapabilityValue('octopus_smart_charge', inPlan).catch(this.error);
    if (prev !== null && prev !== inPlan) {
      this.trigger(inPlan ? 'smart_charge_started' : 'smart_charge_ended', {});
    }
    if (this.hasCapability('octopus_charge_start')) {
      const start = this.nextChargeStart(hours, by, this.smartChargeMaxPrice());
      await this.setCapabilityValue('octopus_charge_start', start ?? '—').catch(this.error);
    }
  }

  /** Expose the cached carbon forecast for carbon-weighted planning. */
  protected carbonForecastForWeighting(): Array<{ from: string; to: string; intensity: number }> {
    return this.carbonForecast;
  }

  protected async onCredentialsApplied(): Promise<void> {
    this.liveDeviceId = null;
  }

  private async enableLivePower(): Promise<void> {
    if (this.livePowerTimer) {
      this.homey.clearInterval(this.livePowerTimer);
      this.livePowerTimer = null;
    }
    if (!this.hasCapability('measure_power')) {
      await this.addCapability('measure_power').catch((err) => this.error('Add measure_power failed:', err));
    }
    await this.pollLivePower().catch((err) => this.error('Live power poll failed:', err));
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
      this.trigger('price_below', { price: value }, { price: value, previous: prev });
      if (value < 0 && prev >= 0) {
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
