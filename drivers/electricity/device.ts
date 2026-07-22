'use strict';

import { Rate, rateAt, regionFromTariff } from '../../lib/rates';
import { OctopusMeterDevice } from '../../lib/OctopusMeterDevice';
import type { Reading } from '../../lib/freshness';
import {
  CarbonClient, CarbonPoint, carbonLevelId, isGreenestNow, regionIdFromGsp,
} from '../../lib/carbon';

interface LiveDemandApp {
  subscribeLiveDemand(
    creds: { apiKey: string; accountNumber: string },
    subscriberId: string,
    onUpdate: (reading: Reading<number>) => void,
  ): void;
  unsubscribeLiveDemand(accountNumber: string, subscriberId: string): void;
}

module.exports = class ElectricityDevice extends OctopusMeterDevice {

  private previousPrice: number | null = null;

  private previousLevel: string | null = null;

  private liveSubscribedAccount: string | null = null;

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
  protected async refreshExtra(generation: number): Promise<void> {
    await super.refreshExtra(generation);
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

  /** Reflect whether an Intelligent Octopus Go smart-charge dispatch is active now.
   *  Uses the reconciled, clock-accurate dispatch truth model (DispatchPoller) so the
   *  `octopus_dispatching` capability agrees with the `dispatch_active` condition and
   *  the widget, spends no extra legacy Kraken call, and never retains `true` after a
   *  failed poll (the account view re-verifies windows against the clock). */
  private async refreshDispatching(): Promise<void> {
    if (!this.hasCapability('octopus_dispatching')) return;
    const { accountNumber } = this.store();
    if (!accountNumber) return;
    const app = this.homey.app as typeof this.homey.app & {
      getDispatchView?(account: string): { activeNow?: boolean } | null;
    };
    const active = Boolean(app.getDispatchView?.(accountNumber)?.activeNow);
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
    // Without a price covering NOW the cheapest-window planner cannot say yes or
    // no, so show "unknown" (null → "—") rather than a misleading "No". Gating on
    // a current-covering row (not merely non-empty rates) means stale/historical
    // rows after a failed refresh don't produce a false answer. This also prevents
    // the "window: No" vs "Octopus smart-charging now: Yes" contradiction.
    const hasPrice = rateAt(this.rates) !== null;
    if (!hasPrice) {
      await this.setCapabilityValue('octopus_smart_charge', null).catch(this.error);
      if (this.hasCapability('octopus_charge_start')) {
        await this.setCapabilityValue('octopus_charge_start', '—').catch(this.error);
      }
      return;
    }
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
    // If live power is active, re-point the shared subscription at the (possibly
    // new) account without disturbing the measure_power capability.
    if (this.liveSubscribedAccount !== null && this.getSetting('live_power')) {
      await this.enableLivePower();
    }
  }

  private liveApp(): LiveDemandApp | null {
    const app = this.homey.app as Partial<LiveDemandApp>;
    return (app.subscribeLiveDemand && app.unsubscribeLiveDemand) ? app as LiveDemandApp : null;
  }

  private async enableLivePower(): Promise<void> {
    if (!this.hasCapability('measure_power')) {
      await this.addCapability('measure_power').catch((err) => this.error('Add measure_power failed:', err));
    }
    const { apiKey, accountNumber } = this.store();
    const app = this.liveApp();
    if (!apiKey || !accountNumber || !app) return;
    // Re-point to a new account if credentials changed while subscribed.
    if (this.liveSubscribedAccount && this.liveSubscribedAccount !== accountNumber) {
      app.unsubscribeLiveDemand(this.liveSubscribedAccount, this.getData().id);
    }
    this.liveSubscribedAccount = accountNumber;
    app.subscribeLiveDemand({ apiKey, accountNumber }, this.getData().id, (reading) => {
      // Only apply a genuinely current reading; never write a stale value as live.
      if (reading.state === 'current' && reading.value !== null && this.hasCapability('measure_power')) {
        this.setCapabilityValue('measure_power', Math.round(reading.value)).catch(this.error);
      }
    });
  }

  private async disableLivePower(): Promise<void> {
    const app = this.liveApp();
    if (app && this.liveSubscribedAccount) {
      app.unsubscribeLiveDemand(this.liveSubscribedAccount, this.getData().id);
    }
    this.liveSubscribedAccount = null;
    if (this.hasCapability('measure_power')) {
      await this.removeCapability('measure_power').catch((err) => this.error('Remove measure_power failed:', err));
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
    // Release the shared subscription without removing the capability (the app
    // is shutting down, not the device).
    const app = this.liveApp();
    if (app && this.liveSubscribedAccount) {
      app.unsubscribeLiveDemand(this.liveSubscribedAccount, this.getData().id);
    }
    this.liveSubscribedAccount = null;
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
      // Target-rate (BL-22): candidate on the half-hour price edge; the run
      // listener does the per-Flow rising-edge check (no timer, no polling).
      this.trigger('target_rate_window_started', { price: value }, {});
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
