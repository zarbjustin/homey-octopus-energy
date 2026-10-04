import { SavingSession } from './KrakenClient';

/** Bounds storage without evicting actionable records and recreating announcements. */
export const SESSION_LIMIT = 512;
const RETENTION_MS = 24 * 3600_000;

export interface SessionRecord {
  id: string;
  start: number;
  end: number;
  joined: boolean;
  reward: number;
  announced: boolean;
  started: boolean;
  ended: boolean;
  activeObserved: boolean;
  soon: string[];
}

export interface SessionLedger {
  records: SessionRecord[];
  known: string[];
  started: string[];
  ended: string[];
  startingSoon: string[];
}

export interface SessionEmission {
  kind: 'announced' | 'starting_soon' | 'started' | 'ended';
  session: SessionRecord;
  minutesUntil?: number;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function isRecord(value: unknown): value is SessionRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as SessionRecord;
  return typeof r.id === 'string' && r.id.length > 0
    && Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start
    && Number.isFinite(r.reward) && typeof r.joined === 'boolean'
    && ['announced', 'started', 'ended', 'activeObserved'].every((k) => typeof (r as unknown as Record<string, unknown>)[k] === 'boolean')
    && Array.isArray(r.soon) && r.soon.every((s) => typeof s === 'string');
}

/** Pure reducer. Callers must persist its result BEFORE attempting any emitted Flow. */
export function reconcileSessions(input: SavingSession[], previous: Partial<SessionLedger> | undefined,
  now: number, corrupt = false) {
  const emissions: SessionEmission[] = [];
  const counts = {
    returned: input.length,
    valid: 0,
    expired: 0,
    new: 0,
    suppressed: 0,
    overflow: 0,
    pruned: 0,
    tracked: 0,
  };
  const records = new Map<string, SessionRecord>();
  const oldRecords = Array.isArray(previous?.records) ? previous.records : [];
  // Invalid persisted records suppress discovery notifications for this cycle.
  const quiet = corrupt || oldRecords.some((r) => !isRecord(r));
  for (const r of oldRecords.filter(isRecord)) {
    if (r.end + RETENTION_MS < now) counts.pruned += 1;
    else if (!records.has(r.id)) records.set(r.id, { ...r, soon: [...r.soon] });
  }
  const retainedIds = new Set(records.keys());
  const expiredIds = new Set(oldRecords.filter(isRecord)
    .filter((r) => !retainedIds.has(r.id)).map((r) => r.id));
  const known = new Set(strings(previous?.known).filter((id) => !expiredIds.has(id)));
  const started = new Set(strings(previous?.started).filter((id) => !expiredIds.has(id)));
  const ended = new Set(strings(previous?.ended).filter((id) => !expiredIds.has(id)));
  const startingSoon = new Set(strings(previous?.startingSoon)
    .filter((key) => ![...expiredIds].some((id) => key.startsWith(`${id}:`))));
  const feed = new Map<string, SavingSession>();
  const ambiguous = new Set<string>();
  for (const s of input) {
    if (!s || typeof s.id !== 'string' || !s.id || s.id.length > 256
      || !Number.isFinite(Date.parse(s.startAt)) || !Number.isFinite(Date.parse(s.endAt))
      || Date.parse(s.endAt) <= Date.parse(s.startAt) || !Number.isFinite(s.rewardPerKwh)) {
      counts.suppressed += 1;
      continue;
    }
    const other = feed.get(s.id);
    if (other && (other.startAt !== s.startAt || other.endAt !== s.endAt
      || other.joined !== s.joined || other.rewardPerKwh !== s.rewardPerKwh)) ambiguous.add(s.id);
    feed.set(s.id, s);
  }
  for (const s of feed.values()) {
    if (ambiguous.has(s.id)) {
      counts.suppressed += 1; continue;
    }
    counts.valid += 1;
    const start = Date.parse(s.startAt);
    const end = Date.parse(s.endAt);
    const existing = records.get(s.id);
    if (end <= now) {
      counts.expired += 1;
      // Expired feed history is never used to create or resurrect records.
      if (existing) {
        existing.start = start;
        existing.end = end;
        existing.joined = s.joined !== false;
      } else {
        known.delete(s.id);
        started.delete(s.id);
        ended.delete(s.id);
        for (const key of startingSoon) if (key.startsWith(`${s.id}:`)) startingSoon.delete(key);
      }
      continue;
    }
    if (!existing && (records.size >= SESSION_LIMIT
      || (!known.has(s.id) && known.size >= SESSION_LIMIT * 2))) {
      counts.overflow += 1;
      continue;
    }
    const r: SessionRecord = existing || {
      id: s.id,
      start,
      end,
      reward: s.rewardPerKwh,
      joined: s.joined !== false,
      announced: known.has(s.id),
      started: started.has(s.id),
      ended: ended.has(s.id),
      activeObserved: false,
      soon: [],
    };
    r.start = start;
    r.end = end;
    r.joined = s.joined !== false;
    r.reward = s.rewardPerKwh;
    records.set(s.id, r);
    if (!existing) counts.new += 1;
    if (quiet || (!existing && start <= now)) {
      // Upgrade corruption and first discovery of active sessions seed silently.
      r.announced = true;
      if (start <= now) r.started = true;
    }
    if (!r.announced && start > now) {
      r.announced = true;
      emissions.push({ kind: 'announced', session: { ...r } });
    }
    known.add(s.id);
    if (!r.joined) continue;
    if (start > now && !quiet) {
      const minutesUntil = Math.round((start - now) / 60_000);
      const key = `${s.id}:${Math.floor(minutesUntil / 15)}`;
      if (minutesUntil <= 245 && !startingSoon.has(key)) {
        startingSoon.add(key);
        r.soon.push(key);
        emissions.push({ kind: 'starting_soon', session: { ...r }, minutesUntil });
      }
    }
    if (start <= now) {
      r.activeObserved = true;
      if (!r.started) {
        r.started = true;
        emissions.push({ kind: 'started', session: { ...r } });
      }
      started.add(s.id);
    }
  }
  // Only a previously observed active event can end, even if absent from the feed.
  for (const r of records.values()) {
    if (r.joined && r.activeObserved && r.end <= now && !r.ended && !quiet) {
      r.ended = true;
      ended.add(r.id);
      emissions.push({ kind: 'ended', session: { ...r } });
    }
  }
  counts.tracked = records.size;
  // Legacy un-timed IDs remain bounded tombstones. Overflow fails closed instead
  // of discarding a seen ID; a subsequent reducer call must remain quiet too.
  const legacyOverflow = known.size > SESSION_LIMIT * 2;
  if (legacyOverflow) counts.overflow += known.size - SESSION_LIMIT * 2;
  const ledger: SessionLedger = {
    records: [...records.values()],
    known: [...known],
    started: [...started],
    ended: [...ended],
    startingSoon: [...startingSoon],
  };
  const activeUntil = Math.max(0, ...ledger.records
    .filter((r) => r.start <= now && r.end > now).map((r) => r.end));
  return {
    ledger, emissions: quiet || legacyOverflow ? [] : emissions, counts, activeUntil,
  };
}
