'use strict';

import { Rate } from '../../lib/rates';
import { OctopusMeterDevice } from '../../lib/OctopusMeterDevice';

module.exports = class ExportDevice extends OctopusMeterDevice {

  private previousExportRate: number | null = null;

  /** Export energy is tracked as exported (production) for Homey Energy. */
  protected energyMeterCapability(): string | null {
    return 'meter_power.exported';
  }

  /** Export pays earnings; there is no standing charge to add. */
  protected costCapability(): string {
    return 'octopus_earnings_today';
  }

  protected monthCostCapability(): string {
    return 'octopus_earnings_month';
  }

  protected monthProjectedCapability(): string {
    return 'octopus_earnings_projected';
  }

  protected includeStandingChargeInCost(): boolean {
    return false;
  }

  /** Fire export-rate Flow triggers when the export unit rate changes. */
  protected async onPriceUpdated(value: number, rate: Rate): Promise<void> {
    await super.onPriceUpdated(value, rate);
    const prev = this.previousExportRate;
    if (prev !== null && value !== prev) {
      this.trigger('export_rate_changed', { price: value, previous: prev });
      this.trigger('export_rate_above', { price: value }, { price: value, previous: prev });
    }
    this.previousExportRate = value;
  }

  private trigger(id: string, tokens: Record<string, unknown>, state: Record<string, unknown> = {}): void {
    this.homey.flow.getDeviceTriggerCard(id)
      .trigger(this, tokens, state)
      .catch((err) => this.error(`Trigger ${id} failed:`, err));
  }

};
