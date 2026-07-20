'use strict';

/**
 * Sprint 43 — Intelligent Octopus Go dispatch "truth model" types.
 *
 * Dispatch data is *intent*, never settlement:
 *  - planned dispatches are mutable intent;
 *  - a completed dispatch is a finished control window, NOT proof of the billed rate;
 *  - a BOOST window is NEVER assumed to receive a SMART discount.
 *
 * Nothing here derives a price — effective/settled pricing is Sprint 44. Every
 * window carries provenance + confidence so consumers can reason about trust
 * (Foundation F1).
 */

export type DispatchKind = 'SMART' | 'BOOST' | 'unknown';

export type DispatchState = 'planned' | 'active' | 'completed' | 'cancelled' | 'unknown';

export type DispatchConfidence = 'high' | 'medium' | 'low';

export type DispatchProvenance = 'planned' | 'completed';

export interface DispatchWindow {
  /** Internal only — never logged, persisted, or surfaced. Null for account-scoped completed rows. */
  deviceId: string | null;
  kind: DispatchKind;
  start: string;
  end: string;
  state: DispatchState;
  provenance: DispatchProvenance;
  confidence: DispatchConfidence;
  /** Optional kWh delta from completedDispatches. Presence does NOT establish a billed rate. */
  delta: number | null;
}

export type DeviceCategory =
  | 'EV' | 'CHARGE_POINT' | 'BATTERY' | 'HEAT_PUMP' | 'INVERTER' | 'other' | 'unknown';

export interface SmartFlexDevice {
  /** Internal only — never logged/persisted. */
  deviceId: string;
  typename: string;
  category: DeviceCategory;
  controlState: string | null;
  /** Whether the device appears to be participating in smart-flex control now. */
  participating: boolean;
}

export interface AccountDispatchModel {
  devices: SmartFlexDevice[];
  windows: DispatchWindow[];
  activeNow: DispatchWindow[];
}

/** Classify a raw dispatch `type` string, failing closed to `unknown`. */
export function classifyKind(type: unknown): DispatchKind {
  if (type === 'SMART') return 'SMART';
  if (type === 'BOOST') return 'BOOST';
  return 'unknown';
}
