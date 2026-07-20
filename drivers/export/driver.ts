'use strict';

import Homey from 'homey';
import { OctopusMeterDriver } from '../../lib/OctopusMeterDriver';
import { crossedAbove } from '../../lib/rates';

interface ExportDevice extends Homey.Device {
  findPeakSlot(within: number, duration: number): { start_time: string; price: number } | null;
  isPeakNow(within: number, duration: number): boolean;
  findExtremeSlotAdvanced(kind: 'import' | 'export', within: number, duration: number, tie: string, seed: string): {
    start_time: string; end_time: string; price: number; window_start: string; window_end: string;
    tie_rule: string; price_basis: string; estimate_label: string;
  } | null;
  planAdvanced(kind: 'import' | 'export', neededKwh: number, rateKw: number, by: string, tie: string, seed: string): {
    count: number; first_start: string; last_end: string; weighted_average_price: number;
    estimated_amount: number; baseline_amount: number; estimated_saving: number;
    window_start: string; window_end: string; tie_rule: string; estimate_label: string;
  } | null;
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

    // Sprint 47 — opt-in export planner & analytics (estimates; values may be negative).
    flow.getActionCard('find_peak_export_slot_advanced')
      .registerRunListener(async (args: Args<{ duration: number; within: number; tie_strategy: string; random_seed: string }>) => {
        const r = args.device.findExtremeSlotAdvanced('export', args.within, args.duration, args.tie_strategy, args.random_seed);
        if (!r) throw new Error('No upcoming export rates are available yet.');
        return r;
      });
    flow.getActionCard('plan_export_advanced')
      .registerRunListener(async (args: Args<{ export_kwh: number; discharge_rate: number; by: string; tie_strategy: string; random_seed: string }>) => {
        const r = args.device.planAdvanced('export', args.export_kwh, args.discharge_rate, args.by, args.tie_strategy, args.random_seed);
        if (!r) throw new Error('No upcoming export rates are available yet.');
        return {
          count: r.count,
          first_start: r.first_start,
          last_end: r.last_end,
          weighted_average_rate: r.weighted_average_price,
          estimated_value: r.estimated_amount,
          baseline_value: r.baseline_amount,
          estimated_uplift: r.estimated_saving,
          window_start: r.window_start,
          window_end: r.window_end,
          tie_rule: r.tie_rule,
          estimate_label: r.estimate_label,
        };
      });
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
