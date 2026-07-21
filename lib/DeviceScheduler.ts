'use strict';

/** The subset of Homey's timer API the scheduler needs. Injected so the
 *  scheduler can be unit-tested with a fake host and so timer ownership lives
 *  in one place rather than scattered across the device. */
export interface SchedulerHost {
  setInterval(fn: () => void, ms: number): NodeJS.Timeout;
  clearInterval(timer: NodeJS.Timeout): void;
  setTimeout(fn: () => void, ms: number): NodeJS.Timeout;
  clearTimeout(timer: NodeJS.Timeout): void;
}

/** Tariff-shape inputs that decide which timers run. Read fresh on every
 *  (re)start so a settings or tariff change takes effect on the next start(). */
export interface SchedulerConfig {
  /** Dynamic (intraday-changing) tariff — needs the aligned half-hour tick. */
  isDynamic: boolean;
  /** Agile product — also needs the daily next-day publication tick (~16:05). */
  isAgile: boolean;
  /** Base poll interval in minutes (floored at 5). */
  pollIntervalMinutes: number;
}

export interface DeviceSchedulerOptions {
  host: SchedulerHost;
  /** Trigger a refresh. Rejections are routed to onError; never thrown. */
  refresh: () => Promise<void>;
  /** Read the current tariff-shape config (evaluated on each start()). */
  config: () => SchedulerConfig;
  /** Next local occurrence of an HH:MM (for the Agile publication tick). */
  nextLocalTime: (hhmm: string) => Date;
  /** Report a timer-callback error (kept identical to the device's logging). */
  onError: (message: string, err: unknown) => void;
  /** Clock injection for deterministic tests. Defaults to the system clock. */
  now?: () => Date;
}

/**
 * Owns a meter device's refresh timers: a coarse poll interval, an aligned
 * half-hour tick (so dynamic prices roll seconds after each :00/:30 boundary),
 * and — for Agile — a daily tick just after next-day prices publish (~16:05).
 *
 * Extracted verbatim from OctopusMeterDevice so timer lifecycle is testable and
 * lives in one place. Behaviour is unchanged: start() replaces the previous
 * scheduleRefresh(), stop() replaces stopTimers().
 */
export class DeviceScheduler {
  private refreshTimer: NodeJS.Timeout | null = null;

  private alignTimer: NodeJS.Timeout | null = null;

  private agileTimer: NodeJS.Timeout | null = null;

  private readonly opts: DeviceSchedulerOptions;

  constructor(opts: DeviceSchedulerOptions) {
    this.opts = opts;
  }

  private now(): Date {
    return this.opts.now ? this.opts.now() : new Date();
  }

  private runRefresh(label: string): void {
    this.opts.refresh().catch((err) => this.opts.onError(`${label} failed:`, err));
  }

  /** (Re)start the timers appropriate to the current tariff shape. */
  start(): void {
    this.stop();
    const cfg = this.opts.config();
    if (!cfg.isDynamic) {
      // Flat/fixed tariffs don't change intraday — just poll on the interval.
      this.startInterval(cfg.pollIntervalMinutes);
      return;
    }
    // Start polling immediately so a failed startup refresh retries promptly.
    // Keep an aligned tick that re-fires at EVERY half-hour boundary so the
    // Agile current price rolls within seconds of each new slot (not just once).
    this.startInterval(cfg.pollIntervalMinutes);
    this.scheduleAlignedTick();
    if (cfg.isAgile) this.scheduleAgilePublication();
  }

  /** Stop and clear every timer. Safe to call when nothing is scheduled. */
  stop(): void {
    if (this.refreshTimer) {
      this.opts.host.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.alignTimer) {
      this.opts.host.clearTimeout(this.alignTimer);
      this.alignTimer = null;
    }
    if (this.agileTimer) {
      this.opts.host.clearTimeout(this.agileTimer);
      this.agileTimer = null;
    }
  }

  private startInterval(pollIntervalMinutes: number): void {
    const minutes = Math.max(5, pollIntervalMinutes);
    this.refreshTimer = this.opts.host.setInterval(() => {
      this.runRefresh('Scheduled refresh');
    }, minutes * 60_000);
  }

  /**
   * Refresh just after each :00/:30 boundary so the live Agile price rolls
   * promptly, then reschedule for the following boundary. A one-shot timer
   * would only roll the price once and then drift with the coarse poll interval.
   */
  private scheduleAlignedTick(): void {
    const now = this.now();
    const msToHalfHour = (30 - (now.getMinutes() % 30)) * 60_000
      - now.getSeconds() * 1000 - now.getMilliseconds();
    // Fire ~2s after the boundary so the new slot's price is current.
    const delay = Math.max(1000, msToHalfHour) + 2000;
    this.alignTimer = this.opts.host.setTimeout(() => {
      this.runRefresh('Aligned refresh');
      this.scheduleAlignedTick();
    }, delay);
  }

  /** Refresh shortly after 16:05 daily, when Agile publishes next-day prices. */
  private scheduleAgilePublication(): void {
    const tick = (): void => {
      this.runRefresh('Agile-publication refresh');
      this.agileTimer = this.opts.host.setTimeout(
        tick,
        this.opts.nextLocalTime('16:05').getTime() - Date.now(),
      );
    };
    this.agileTimer = this.opts.host.setTimeout(
      tick,
      this.opts.nextLocalTime('16:05').getTime() - Date.now(),
    );
  }
}
