'use strict';

import { OctopusMeterDevice } from '../../lib/OctopusMeterDevice';

module.exports = class GasDevice extends OctopusMeterDevice {

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

};
