'use strict';

import { Rate } from '../../lib/rates';
import { OctopusMeterDevice } from '../../lib/OctopusMeterDevice';

module.exports = class ElectricityDevice extends OctopusMeterDevice {

  private previousPrice: number | null = null;

  private previousLevel: string | null = null;

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
