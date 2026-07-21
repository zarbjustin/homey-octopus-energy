'use strict';

import { Rate } from '../../lib/rates';
import { OctopusMeterDevice } from '../../lib/OctopusMeterDevice';

const GAS_CARBON_G_PER_KWH = 183; // BEIS natural-gas combustion factor

module.exports = class GasDevice extends OctopusMeterDevice {

  private previousGasPrice: number | null = null;

  protected energyMeterCapability(): string | null {
    return 'meter_gas';
  }

  private conversion(): number {
    const cv = Number(this.getSetting('gas_cv'));
    return Number.isFinite(cv) && cv > 0 ? cv : 11.1868;
  }

  private reportsCubicMetres(): boolean {
    return this.getSetting('gas_units') !== 'kwh';
  }

  /** Convert raw consumption to kWh for usage/cost (gas rates are p/kWh). */
  protected toEnergyUnit(value: number): number {
    return this.reportsCubicMetres() ? value * this.conversion() : value;
  }

  /** The cumulative gas meter is tracked in cubic metres. */
  protected toMeterUnit(value: number): number {
    return this.reportsCubicMetres() ? value : value / this.conversion();
  }

  /** Fire a gas price-changed trigger when the unit rate changes. */
  protected async onPriceUpdated(value: number, rate: Rate): Promise<void> {
    await super.onPriceUpdated(value, rate);
    const prev = this.previousGasPrice;
    if (prev !== null && value !== prev) {
      this.homey.flow.getDeviceTriggerCard('gas_price_changed')
        .trigger(this, { price: value, previous: prev })
        .catch((err) => this.error('Trigger gas_price_changed failed:', err));
      this.homey.flow.getDeviceTriggerCard('gas_price_below')
        .trigger(this, { price: value, previous: prev }, { price: value, previous: prev })
        .catch((err) => this.error('Trigger gas_price_below failed:', err));
    }
    this.previousGasPrice = value;
  }

  /** After consumption, estimate embedded carbon from gas usage (kWh × factor). */
  protected async refreshExtra(generation: number): Promise<void> {
    await super.refreshExtra(generation);
    if (this.hasCapability('measure_gas_carbon') && this.hasCapability('octopus_usage_today')) {
      const usageKwh = Number(this.getCapabilityValue('octopus_usage_today')) || 0;
      const kg = (usageKwh * GAS_CARBON_G_PER_KWH) / 1000;
      await this.setCapabilityValue('measure_gas_carbon', Number(kg.toFixed(2))).catch(this.error);
    }
  }

};
