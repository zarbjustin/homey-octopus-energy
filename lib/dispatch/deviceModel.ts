'use strict';

import { SmartFlexDevice, DeviceCategory } from './types';

/**
 * Normalise the Kraken `devices(accountNumber)` response into internal
 * SmartFlexDevice records, failing closed on anything unexpected. A device with
 * no id is skipped; an unknown `__typename`/`deviceType` becomes category
 * `unknown` (kept, not dropped) so the account is never silently mis-modelled.
 */

interface RawDevice {
  __typename?: string;
  id?: string;
  deviceType?: string;
  status?: { currentState?: string } | null;
}

function classifyCategory(typename: string | undefined, deviceType: string | undefined): DeviceCategory {
  const hay = `${typename ?? ''} ${deviceType ?? ''}`.toUpperCase();
  if (/VEHICLE|\bEV\b|CAR/.test(hay)) return 'EV';
  if (/CHARGE|CHARGER/.test(hay)) return 'CHARGE_POINT';
  if (/BATTER/.test(hay)) return 'BATTERY';
  if (/HEAT.?PUMP/.test(hay)) return 'HEAT_PUMP';
  if (/INVERTER/.test(hay)) return 'INVERTER';
  return typename || deviceType ? 'other' : 'unknown';
}

/** Whether a control state string indicates active/eligible smart-flex participation. */
export function isParticipating(controlState: string | null): boolean {
  if (!controlState) return false;
  return /SMART_CONTROL|IN_PROGRESS|CAPABLE|BOOST/i.test(controlState);
}

export function normaliseDevices(raw: unknown): SmartFlexDevice[] {
  const wrapped = (raw as { devices?: unknown })?.devices;
  let list: RawDevice[] = [];
  if (Array.isArray(wrapped)) list = wrapped as RawDevice[];
  else if (Array.isArray(raw)) list = raw as RawDevice[];
  const out: SmartFlexDevice[] = [];
  for (const d of list) {
    const deviceId = d?.id;
    if (!deviceId || typeof deviceId !== 'string') continue; // fail closed: no id → skip
    const controlState = d?.status?.currentState ?? null;
    out.push({
      deviceId,
      typename: String(d.__typename ?? d.deviceType ?? 'unknown'),
      category: classifyCategory(d.__typename, d.deviceType),
      controlState,
      participating: isParticipating(controlState),
    });
  }
  return out;
}
