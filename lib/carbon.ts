'use strict';

import { withResponseTimeout } from './http';

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

function finiteIntensity(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** GSP region letter (A–P) → Carbon Intensity API regionid (1–14). */
const GSP_TO_REGION_ID: Record<string, number> = {
  A: 10, // East England
  B: 9, // East Midlands
  C: 13, // London
  D: 6, // North Wales & Merseyside
  E: 8, // West Midlands
  F: 4, // North East England
  G: 3, // North West England
  H: 12, // Southern England
  J: 14, // South East England
  K: 7, // South Wales
  L: 11, // South West England
  M: 5, // Yorkshire
  N: 2, // South Scotland
  P: 1, // North Scotland
};

/** Map a GSP region letter to the Carbon Intensity regional id, or null. */
export function regionIdFromGsp(letter: string | null): number | null {
  if (!letter) return null;
  return GSP_TO_REGION_ID[letter.toUpperCase()] ?? null;
}

/** Sum the renewable share (wind + solar + hydro) of a generation mix array. */
export function renewablePercent(mix: Array<{ fuel: string; perc: number }> = []): number {
  return mix
    .filter((m) => ['wind', 'solar', 'hydro'].includes((m.fuel || '').toLowerCase()))
    .reduce((acc, m) => acc + (Number(m.perc) || 0), 0);
}

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
  if (!Number.isFinite(now) || (withinHours !== undefined
    && (!Number.isFinite(withinHours) || withinHours <= 0))) return false;
  const within = withinHours === undefined ? Infinity : now + withinHours * 3600_000;
  const pts = forecast.filter((p) => new Date(p.to).getTime() > now && new Date(p.from).getTime() < within)
    .sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
  if (!pts.length) return false;
  let covered = now;
  for (const p of pts) {
    const from = Date.parse(p.from);
    const to = Date.parse(p.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from
      || Math.max(now, from) !== covered || finiteIntensity(p.intensity) === null) return false;
    covered = Math.min(to, within);
  }
  if (Number.isFinite(within) && covered < within) return false;
  const current = pts.find((p) => {
    const f = new Date(p.from).getTime();
    const t = new Date(p.to).getTime();
    return now >= f && now < t;
  });
  if (!current) return false;
  const min = Math.min(...pts.map((p) => p.intensity));
  return current.intensity <= min;
}

export class CarbonClient {

  private readonly baseUrl: string;

  constructor(baseUrl: string = BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request(path: string): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await withResponseTimeout(fetch, `${this.baseUrl}${path}`, {
          headers: { Accept: 'application/json' },
        }, 15_000, async (response) => {
          if (response.status === 429 || response.status >= 500) {
            throw new Error(`Transient Carbon API error ${response.status}`);
          }
          return response.ok ? response.json() : null;
        });
      } catch (err) {
        if (err instanceof SyntaxError) throw err;
        lastError = err;
      }
      if (attempt < 2) {
        await new Promise((resolve) => {
          globalThis.setTimeout(resolve, 500 * (2 ** attempt));
        });
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Carbon API request failed.');
  }

  /** Current national carbon intensity (gCO₂/kWh) and index, or null. */
  async getCurrent(): Promise<CarbonPoint | null> {
    const json = await this.request('/intensity') as { data?: Array<{ from: string; to: string; intensity?: { forecast?: number; actual?: number; index?: string } }> } | null;
    const d = json?.data?.[0];
    if (!d) return null;
    const intensity = finiteIntensity(d.intensity?.actual ?? d.intensity?.forecast);
    if (intensity === null) return null;
    return {
      from: d.from,
      to: d.to,
      intensity,
      index: String(d.intensity?.index ?? ''),
    };
  }

  /** 48-hour forward national carbon-intensity forecast (half-hourly). */
  async getForecast(): Promise<CarbonPoint[]> {
    const fromIso = new Date().toISOString();
    const json = await this.request(`/intensity/${fromIso}/fw48h`) as { data?: Array<{ from: string; to: string; intensity?: { forecast?: number; index?: string } }> } | null;
    return (json?.data ?? []).flatMap((d) => {
      const intensity = finiteIntensity(d.intensity?.forecast);
      return intensity === null ? [] : [{
        from: d.from,
        to: d.to,
        intensity,
        index: String(d.intensity?.index ?? ''),
      }];
    });
  }

  /** Current regional carbon intensity + index + renewable %, or null. */
  async getRegional(regionId: number): Promise<(CarbonPoint & { renewable: number }) | null> {
    const json = await this.request(`/regional/regionid/${regionId}`) as {
      data?: Array<{ data?: Array<{ from: string; to: string; intensity?: { forecast?: number; index?: string }; generationmix?: Array<{ fuel: string; perc: number }> }> }>;
    } | null;
    const d = json?.data?.[0]?.data?.[0];
    if (!d) return null;
    const intensity = finiteIntensity(d.intensity?.forecast);
    if (intensity === null) return null;
    return {
      from: d.from,
      to: d.to,
      intensity,
      index: String(d.intensity?.index ?? ''),
      renewable: renewablePercent(d.generationmix),
    };
  }

  /** 48-hour forward regional carbon-intensity forecast (half-hourly). */
  async getRegionalForecast(regionId: number): Promise<CarbonPoint[]> {
    const fromIso = new Date().toISOString();
    const json = await this.request(`/regional/intensity/${fromIso}/fw48h/regionid/${regionId}`) as {
      data?: { data?: Array<{ from: string; to: string; intensity?: { forecast?: number; index?: string } }> };
    } | null;
    return (json?.data?.data ?? []).flatMap((d) => {
      const intensity = finiteIntensity(d.intensity?.forecast);
      return intensity === null ? [] : [{
        from: d.from,
        to: d.to,
        intensity,
        index: String(d.intensity?.index ?? ''),
      }];
    });
  }
}
