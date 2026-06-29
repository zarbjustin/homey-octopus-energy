'use strict';

import Homey from 'homey';
import { OctopusMeterDriver } from '../../lib/OctopusMeterDriver';
import { crossedAbove } from '../../lib/rates';

interface ExportDevice extends Homey.Device {
  findPeakSlot(within: number, duration: number): { start_time: string; price: number } | null;
  isPeakNow(within: number, duration: number): boolean;
}

type Args<T> = T & { device: ExportDevice };

module.exports = class ExportDriver extends OctopusMeterDriver {

  async onInit(): Promise<void> {
    this.fuel = 'electricity';
    this.registerFlowCards();
    this.log('Export driver initialised');
  }

  private registerFlowCards(): void {
    const { flow } = this.homey;
    flow.getDeviceTriggerCard('export_rate_above')
      .registerRunListener(async (args: Args<{ price: number }>, state: { price: number; previous: number | null }) => (
        crossedAbove(state.price, state.previous, args.price)
      ));
    flow.getActionCard('find_peak_export_slot')
      .registerRunListener(async (args: Args<{ within: number; duration: number }>) => {
        const result = args.device.findPeakSlot(args.within, args.duration);
        if (!result) throw new Error('No upcoming export rates are available yet.');
        return result;
      });
    flow.getConditionCard('is_peak_export_now')
      .registerRunListener(async (args: Args<{ within: number; duration: number }>) => args.device.isPeakNow(args.within, args.duration));
  }

  protected accepts(meter: { fuel: string; isExport: boolean }): boolean {
    return meter.fuel === 'electricity' && meter.isExport;
  }

  protected manualIsExport(): boolean {
    return true;
  }

  protected deviceName(meter: { mpxn: string }): string {
    const tail = meter.mpxn ? ` ·${meter.mpxn.slice(-4)}` : '';
    return `Export Meter${tail}`;
  }

};
