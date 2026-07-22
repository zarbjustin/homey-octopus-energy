'use strict';

import Homey from 'homey';
import { OctopusMeterDriver } from '../../lib/OctopusMeterDriver';
import { crossedBelow } from '../../lib/rates';

interface ElectricityDevice extends Homey.Device {
  getCurrentPrice(): number | null;
  getPriceLevel(): string | null;
  isCheapestNow(hours?: number): boolean;
  isWithinCheapestPeriod(duration: number, within: number): boolean;
  isInCheapestPlan(duration: number, by: string): boolean;
  isNightRate(): boolean;
  isCheapestPercentile(percent: number, hours: number): boolean;
  getRenewablePercent(): number | null;
  refreshNow(): Promise<void>;
  bumpCharge(): Promise<void>;
  findCheapestSlot(within: number, duration: number): { start_time: string; price: number } | null;
  findCheapestHours(duration: number, by: string): { count: number; first_start: string; price: number } | null;
  getCarbon(): number | null;
  getCarbonLevel(): string | null;
  isGreenestNow(hours?: number): boolean;
  compareTariffs(days: number): Promise<{ best_product: string; current_annual: number; best_annual: number; annual_saving: number } | null>;
  planCharge(neededKwh: number, chargeRateKw: number, by: string): { count: number; first_start: string; price: number; cost: number } | null;
  planGreenCharge(neededKwh: number, chargeRateKw: number, by: string, greenness: number): { count: number; first_start: string; price: number; carbon: number } | null;
  findExtremeSlotAdvanced(kind: 'import' | 'export', within: number, duration: number, tie: string, seed: string): {
    start_time: string; end_time: string; price: number; window_start: string; window_end: string;
    tie_rule: string; price_basis: string; estimate_label: string;
  } | null;
  planAdvanced(kind: 'import' | 'export', neededKwh: number, rateKw: number, by: string, tie: string, seed: string): {
    count: number; first_start: string; last_end: string; weighted_average_price: number;
    estimated_amount: number; baseline_amount: number; estimated_saving: number;
    window_start: string; window_end: string; tie_rule: string; estimate_label: string;
  } | null;
  analysePriceDay(which: 'today' | 'tomorrow'): Record<string, string | number> | null;
  currentPriceBand(): string | null;
  isDataSourceStale(source: string): boolean;
}

type Args<T> = T & { device: ElectricityDevice };

module.exports = class ElectricityDriver extends OctopusMeterDriver {

  async onInit(): Promise<void> {
    this.fuel = 'electricity';
    this.registerFlowCards();
    this.log('Electricity driver initialised');
  }

  protected accepts(meter: { fuel: string; isExport: boolean }): boolean {
    return meter.fuel === 'electricity' && !meter.isExport;
  }

  private registerFlowCards(): void {
    const { flow } = this.homey;

    // Filtered triggers.
    flow.getDeviceTriggerCard('price_below')
      .registerRunListener(async (args: Args<{ price: number }>, state: { price: number; previous: number | null }) => (
        crossedBelow(state.price, state.previous, args.price)
      ));
    flow.getDeviceTriggerCard('cheapest_slot_started')
      .registerRunListener(async (args: Args<{ hours: number }>) => args.device.isCheapestNow(args.hours));
    flow.getDeviceTriggerCard('carbon_below')
      .registerRunListener(async (args: Args<{ threshold: number }>, state: { carbon: number; previous: number | null }) => (
        crossedBelow(state.carbon, state.previous, args.threshold)
      ));

    // Conditions.
    flow.getConditionCard('price_below_now')
      .registerRunListener(async (args: Args<{ price: number }>) => {
        const p = args.device.getCurrentPrice();
        return p !== null && p < args.price;
      });
    flow.getConditionCard('is_cheapest_now')
      .registerRunListener(async (args: Args<{ hours: number }>) => args.device.isCheapestNow(args.hours));
    flow.getConditionCard('price_level_is')
      .registerRunListener(async (args: Args<{ level: string }>) => args.device.getPriceLevel() === args.level);
    flow.getConditionCard('within_cheapest_period')
      .registerRunListener(async (args: Args<{ duration: number; within: number }>) => args.device.isWithinCheapestPeriod(args.duration, args.within));
    flow.getConditionCard('in_cheapest_plan')
      .registerRunListener(async (args: Args<{ duration: number; by: string }>) => args.device.isInCheapestPlan(args.duration, args.by));
    flow.getConditionCard('price_percentile_below')
      .registerRunListener(async (args: Args<{ percent: number; hours: number }>) => args.device.isCheapestPercentile(args.percent, args.hours));
    flow.getConditionCard('is_night_rate')
      .registerRunListener(async (args: Args<unknown>) => args.device.isNightRate());
    flow.getConditionCard('data_source_stale')
      .registerRunListener(async (args: Args<{ source: string }>) => args.device.isDataSourceStale(args.source));
    flow.getConditionCard('renewables_above')
      .registerRunListener(async (args: Args<{ percent: number }>) => {
        const r = args.device.getRenewablePercent();
        return r !== null && r > args.percent;
      });
    flow.getConditionCard('carbon_below')
      .registerRunListener(async (args: Args<{ intensity: number }>) => {
        const c = args.device.getCarbon();
        return c !== null && c < args.intensity;
      });
    flow.getConditionCard('is_greenest_now')
      .registerRunListener(async (args: Args<{ hours: number }>) => args.device.isGreenestNow(args.hours));
    flow.getConditionCard('carbon_level_is')
      .registerRunListener(async (args: Args<{ level: string }>) => args.device.getCarbonLevel() === args.level);
    flow.getConditionCard('good_now')
      .registerRunListener(async (args: Args<{ max_price: number; max_carbon: number }>) => {
        const price = args.device.getCurrentPrice();
        const carbon = args.device.getCarbon();
        return price !== null && carbon !== null
          && price < args.max_price && carbon < args.max_carbon;
      });

    // Actions.
    flow.getActionCard('refresh_now')
      .registerRunListener(async (args: Args<unknown>) => {
        await args.device.refreshNow();
      });
    flow.getActionCard('bump_charge')
      .registerRunListener(async (args: Args<unknown>) => {
        try {
          await args.device.bumpCharge();
        } catch (err) {
          throw new Error('Bump charge is not available for this account/charger (experimental).');
        }
      });
    flow.getActionCard('find_cheapest_slot')
      .registerRunListener(async (args: Args<{ within: number; duration: number }>) => {
        const result = args.device.findCheapestSlot(args.within, args.duration);
        if (!result) throw new Error('No upcoming rates are available yet.');
        return result;
      });
    flow.getActionCard('find_cheapest_hours')
      .registerRunListener(async (args: Args<{ duration: number; by: string }>) => {
        const result = args.device.findCheapestHours(args.duration, args.by);
        if (!result) throw new Error('No upcoming rates are available yet.');
        return result;
      });
    flow.getActionCard('find_best_tariff')
      .registerRunListener(async (args: Args<{ days: number }>) => {
        const result = await args.device.compareTariffs(args.days);
        if (!result) throw new Error('Not enough consumption data to compare tariffs yet.');
        return result;
      });
    flow.getActionCard('plan_charge')
      .registerRunListener(async (args: Args<{ needed_kwh: number; charge_rate: number; by: string }>) => {
        const result = args.device.planCharge(args.needed_kwh, args.charge_rate, args.by);
        if (!result) throw new Error('No upcoming rates are available yet.');
        return result;
      });
    flow.getActionCard('plan_green_charge')
      .registerRunListener(async (args: Args<{ needed_kwh: number; charge_rate: number; by: string; greenness: number }>) => {
        const result = args.device.planGreenCharge(args.needed_kwh, args.charge_rate, args.by, args.greenness);
        if (!result) throw new Error('No upcoming rates are available yet.');
        return result;
      });

    // Sprint 47 — opt-in planner & tariff analytics (all estimates, never settled).
    flow.getActionCard('find_cheapest_slot_advanced')
      .registerRunListener(async (args: Args<{ duration: number; within: number; tie_strategy: string; random_seed: string }>) => {
        const r = args.device.findExtremeSlotAdvanced('import', args.within, args.duration, args.tie_strategy, args.random_seed);
        if (!r) throw new Error('No upcoming rates are available yet.');
        return r;
      });
    flow.getActionCard('plan_charge_advanced')
      .registerRunListener(async (args: Args<{ needed_kwh: number; charge_rate: number; by: string; tie_strategy: string; random_seed: string }>) => {
        const r = args.device.planAdvanced('import', args.needed_kwh, args.charge_rate, args.by, args.tie_strategy, args.random_seed);
        if (!r) throw new Error('No upcoming rates are available yet.');
        return {
          count: r.count,
          first_start: r.first_start,
          last_end: r.last_end,
          weighted_average_price: r.weighted_average_price,
          estimated_cost: r.estimated_amount,
          baseline_cost: r.baseline_amount,
          estimated_saving: r.estimated_saving,
          window_start: r.window_start,
          window_end: r.window_end,
          tie_rule: r.tie_rule,
          estimate_label: r.estimate_label,
        };
      });
    flow.getActionCard('analyse_price_day')
      .registerRunListener(async (args: Args<{ day: string }>) => {
        const r = args.device.analysePriceDay(args.day === 'tomorrow' ? 'tomorrow' : 'today');
        if (!r) throw new Error('Prices for that day are not fully published yet.');
        return r;
      });
    flow.getConditionCard('relative_price_band_is')
      .registerRunListener(async (args: Args<{ band: string }>) => args.device.currentPriceBand() === args.band);
  }

};
