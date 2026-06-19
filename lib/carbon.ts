'use strict';

/**
 * National Grid Carbon Intensity API client + pure helpers.
 * Free, unauthenticated: https://api.carbonintensity.org.uk
 */

const BASE_URL = 'https://api.carbonintensity.org.uk';

export interface CarbonPoint {
  from: string;
  to: string;
  intensity: number;
  index: string;
}

export type CarbonLevel = 'very_low' | 'low' | 'moderate' | 'high' | 'very_high';

/** Map the API's textual index to a capability enum id. */
export function carbonLevelId(index: string): CarbonLevel {
  switch ((index || '').toLowerCase()) {
    case 'very low': return 'very_low';
    case 'low': return 'low';
    case 'high': return 'high';
    case 'very high': return 'very_high';
    default: return 'moderate';
  }
}

/** Is the point covering `at` the lowest-intensity in the forward window? */
export function isGreenestNow(
  forecast: CarbonPoint[],
  at: Date = new Date(),
  withinHours?: number,
): boolean {
  const now = at.getTime();
  const within = withinHours ? now + withinHours * 3600_000 : Infinity;
  const pts = forecast.filter((p) => new Date(p.to).getTime() > now && new Date(p.from).getTime() < within);
  if (!pts.length) return false;
  const current = pts.find((p) => {
    const f = new Date(p.from).getTime();
    const t = new Date(p.to).getTime();
    return now >= f && now < t;
  }) ?? pts[0];
  const min = Math.min(...pts.map((p) => p.intensity));
  return current.intensity <= min;
}

export class CarbonClient {

  private readonly baseUrl: string;

  constructor(baseUrl: string = BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /** Current national carbon intensity (gCO₂/kWh) and index, or null. */
  async getCurrent(): Promise<CarbonPoint | null> {
    const res = await fetch(`${this.baseUrl}/intensity`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json() as { data?: Array<{ from: string; to: string; intensity?: { forecast?: number; actual?: number; index?: string } }> };
    const d = json?.data?.[0];
    if (!d) return null;
    return {
      from: d.from,
      to: d.to,
      intensity: Number(d.intensity?.actual ?? d.intensity?.forecast ?? 0),
      index: String(d.intensity?.index ?? ''),
    };
  }

  /** 48-hour forward national carbon-intensity forecast (half-hourly). */
  async getForecast(): Promise<CarbonPoint[]> {
    const fromIso = new Date().toISOString();
    const res = await fetch(`${this.baseUrl}/intensity/${fromIso}/fw48h`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const json = await res.json() as { data?: Array<{ from: string; to: string; intensity?: { forecast?: number; index?: string } }> };
    return (json?.data ?? []).map((d) => ({
      from: d.from,
      to: d.to,
      intensity: Number(d.intensity?.forecast ?? 0),
      index: String(d.intensity?.index ?? ''),
    }));
  }
}
