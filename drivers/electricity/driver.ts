'use strict';

import Homey from 'homey';
import { OctopusMeterDriver } from '../../lib/OctopusMeterDriver';
import { crossedBelow } from '../../lib/rates';
import { slotSelection } from '../../lib/planning/priceAvailability';

interface ElectricityDevice extends Homey.Device {
  getThresholdSlotsBefore(price: number, by: string): { status: string; slots: Array<{ start: number; end: number; price: number }> };
  configureChargingPlan(mode: string, price: number, by: string, duration: number, fallback: string, maximum: number): Promise<{
    status: string; selection: string; active: boolean; slots: unknown[];
  }>;
  getChargingPlanEligibility(): boolean;
  cancelChargingPlan(): Promise<void>;
  getThresholdSlots(price: number, within: number): { status: string; slots: Array<{ start: number; end: number; price: number }> };
  isInThresholdSlot(price: number, within: number): boolean;
  getConfiguredPriceBand(green: number, yellow: number, orange: number): string;
  getBoundedThresholdSlots(price: number, within: number, duration: number, fallback: boolean, maximum: number): {
    status: string; slots: Array<{ start: number; end: number; price: number }>;
  };
  getCurrentPrice(): number | null;
  getPriceLevel(): string | null;
  isCheapestNow(hours?: number): boolean;
  isWithinCheapestPeriod(duration: number, within: number): boolean;
  isInCheapestPlan(duration: number, by: string): boolean;
  isNightRate(): boolean;
  isCheapestPercentile(percent: number, hours: number): boolean;
  getRenewablePercent(): number | null;
  refreshNow(): Promise<void>;
  bumpCharge(): Promise<{ currentState: string | null }>;
  cancelBoost(): Promise<{ currentState: string | null }>;
  findCheapestSlot(within: number, duration: number): { start_time: string; price: number } | null;
  findCheapestHours(duration: number, by: string): { count: number; first_start: string; price: number } | null;
  getCarbon(): number | null;
  getCarbonLevel(): string | null;
  isGreenestNow(hours?: number): boolean;
  compareTariffs(days: number): Promise<{ best_product: string; current_annual: number; best_annual: number; annual_saving: number; confidence: string; note: string } | null>;
  planCharge(neededKwh: number, chargeRateKw: number, by: string): { count: number; first_start: string; price: number; cost: number } | null;
  planGreenCharge(neededKwh: number, chargeRateKw: number, by: string, greenness: number): {
    count: number; first_start: string; end: string; price: number; carbon: number;
    estimated_cost: number; estimated_emissions: number; extra_price: number;
    carbon_reduction: number; confidence: string; estimate_label: string;
  } | null;
  getCostCarbonPlan(durationHours: number, withinHours: number, greenness: number): {
    available: boolean; activeNow: boolean; start: string | null; end: string | null;
    averagePrice: number | null; averageCarbon: number | null; confidence: string;
  };
  isInCostCarbonWindow(durationHours: number, withinHours: number, greenness: number): boolean;
  costCarbonWindowStartedNow(durationHours: number, withinHours: number, greenness: number): boolean;
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
  isMonthlyCostAbove(amount: number): boolean;
  isInTargetRateWindow(durationHours: number, byTime: string, maxPrice?: number): boolean;
  targetRateStartedNow(durationHours: number, byTime: string, maxPrice?: number): boolean;
  getTargetRatePlan(durationHours: number, byTime: string, maxPrice?: number): {
    start: string; end: string; average_price: number; max_slot_price: number;
    target_met: boolean; cheapest_available: number; slots: number;
  } | null;
  dispatchStartsWithin(minutes: number): boolean;
  getNextDispatch(): {
    start: string; end: string; type: string; confidence: string; minutes_until: number;
  } | null;
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
    for (const kind of ['started', 'ended']) {
      flow.getDeviceTriggerCard(`threshold_slot_${kind}`)
        .registerRunListener(async (args: Args<{ price: number; within: number }>, state: { price: number; previous: number }) => {
          args.device.getThresholdSlots(args.price, args.within); // Errors are never inverted into permission.
          const before = state.previous < args.price;
          const active = state.price < args.price;
          return kind === 'started' ? active && !before : before && !active;
        });
    }
    flow.getDeviceTriggerCard('price_below')
      .registerRunListener(async (args: Args<{ price: number }>, state: { price: number; previous: number | null }) => (
        crossedBelow(state.price, state.previous, args.price)
      ));
    flow.getDeviceTriggerCard('cheapest_slot_started')
      .registerRunListener(async (args: Args<{ hours: number }>) => args.device.isCheapestNow(args.hours));
    flow.getDeviceTriggerCard('target_rate_window_started')
      .registerRunListener(async (args: Args<{ duration: number; by: string; max_price: number }>) => (
        args.device.targetRateStartedNow(args.duration, args.by, args.max_price)
      ));
    flow.getDeviceTriggerCard('green_charge_window_started')
      .registerRunListener(async (args: Args<{ duration: number; within: number; greenness: number }>) => (
        args.device.costCarbonWindowStartedNow(args.duration, args.within, args.greenness)
      ));
    flow.getDeviceTriggerCard('carbon_below')
      .registerRunListener(async (args: Args<{ threshold: number }>, state: { carbon: number; previous: number | null }) => (
        crossedBelow(state.carbon, state.previous, args.threshold)
      ));

    // Conditions.
    flow.getDeviceTriggerCard('charging_plan_run_started').registerRunListener(async () => true);
    flow.getDeviceTriggerCard('charging_plan_run_ended').registerRunListener(async () => true);
    flow.getConditionCard('threshold_slots_before')
      .registerRunListener(async (args: Args<{ price: number; by: string }>) => args.device.getThresholdSlotsBefore(args.price, args.by).status === 'some');
    flow.getConditionCard('charging_plan_active')
      .registerRunListener(async (args: Args<unknown>) => args.device.getChargingPlanEligibility());
    flow.getActionCard('configure_charging_plan')
      .registerRunListener(async (args: Args<{ mode: string; price: number; by: string; duration: number; fallback: string; maximum: number }>) => {
        const state = await args.device.configureChargingPlan(args.mode, args.price, args.by, args.duration, args.fallback, args.maximum);
        return {
          status: state.status,
          selection: state.selection,
          active: state.active,
          slots: JSON.stringify(state.slots),
          estimate_label: 'Planned eligibility, not measured charging; battery safeguards remain required',
        };
      });
    flow.getActionCard('cancel_charging_plan')
      .registerRunListener(async (args: Args<unknown>) => {
        await args.device.cancelChargingPlan();
      });
    flow.getActionCard('get_threshold_slots_before')
      .registerRunListener(async (args: Args<{ price: number; by: string }>) => {
        const state = args.device.getThresholdSlotsBefore(args.price, args.by);
        return {
          count: state.slots.length,
          slots: JSON.stringify(state.slots.map((slot) => ({
            ...slot, start: new Date(slot.start).toISOString(), end: new Date(slot.end).toISOString(),
          }))),
        };
      });
    flow.getConditionCard('threshold_slots_available')
      .registerRunListener(async (args: Args<{ price: number; within: number }>) => (
        args.device.getThresholdSlots(args.price, args.within).status === 'some'
      ));
    flow.getConditionCard('in_threshold_slot')
      .registerRunListener(async (args: Args<{ price: number; within: number }>) => args.device.isInThresholdSlot(args.price, args.within));
    flow.getConditionCard('configured_price_band')
      .registerRunListener(async (args: Args<{ band: string; green: number; yellow: number; orange: number }>) => {
        if (!['negative', 'green', 'yellow', 'orange', 'red'].includes(args.band)) throw new Error('Choose a valid price band.');
        return args.device.getConfiguredPriceBand(args.green, args.yellow, args.orange) === args.band;
      });
    flow.getActionCard('get_threshold_slots')
      .registerRunListener(async (args: Args<{ price: number; within: number }>) => {
        const result = args.device.getThresholdSlots(args.price, args.within);
        return {
          count: result.slots.length,
          hours: result.slots.reduce((sum, slot) => sum + (slot.end - slot.start) / 3600000, 0),
          slots: JSON.stringify(result.slots.map((slot) => ({
            start: new Date(slot.start).toISOString(), end: new Date(slot.end).toISOString(), price: slot.price,
          }))),
          estimate_label: 'Published unit prices; estimated opportunity, not settlement or measured charging',
        };
      });
    flow.getActionCard('get_bounded_threshold_slots')
      .registerRunListener(async (args: Args<{ price: number; within: number; duration: number; fallback: string; maximum: number }>) => {
        if (!['off', 'on'].includes(args.fallback)) throw new Error('Choose fallback on or off.');
        const result = args.device.getBoundedThresholdSlots(args.price, args.within, args.duration, args.fallback === 'on', args.maximum);
        return {
          complete: result.status === 'complete',
          status: result.status,
          selection: slotSelection(result.slots, result.status),
          slots: JSON.stringify(result.slots.map((slot) => ({
            ...slot, start: new Date(slot.start).toISOString(), end: new Date(slot.end).toISOString(),
          }))),
          estimate_label: 'Estimated opportunity; no battery command performed',
        };
      });
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
    flow.getConditionCard('monthly_cost_above')
      .registerRunListener(async (args: Args<{ amount: number }>) => args.device.isMonthlyCostAbove(args.amount));
    flow.getConditionCard('in_target_rate_window')
      .registerRunListener(async (args: Args<{ duration: number; by: string; max_price: number }>) => (
        args.device.isInTargetRateWindow(args.duration, args.by, args.max_price)
      ));
    flow.getConditionCard('in_green_charge_window')
      .registerRunListener(async (args: Args<{ duration: number; within: number; greenness: number }>) => (
        args.device.isInCostCarbonWindow(args.duration, args.within, args.greenness)
      ));
    flow.getConditionCard('dispatch_starts_within')
      .registerRunListener(async (args: Args<{ minutes: number }>) => args.device.dispatchStartsWithin(args.minutes));
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
        await args.device.bumpCharge();
      });
    flow.getActionCard('cancel_boost')
      .registerRunListener(async (args: Args<unknown>) => {
        await args.device.cancelBoost();
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
    flow.getActionCard('get_target_rate_plan')
      .registerRunListener(async (args: Args<{ duration: number; by: string; max_price: number }>) => {
        const result = args.device.getTargetRatePlan(args.duration, args.by, args.max_price);
        if (!result) throw new Error('No upcoming rates are available yet.');
        return result;
      });
    flow.getActionCard('get_next_dispatch')
      .registerRunListener(async (args: Args<unknown>) => {
        const result = args.device.getNextDispatch();
        if (!result) throw new Error('No fresh planned dispatch is available.');
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
