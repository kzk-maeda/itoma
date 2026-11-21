/** Bounded display DTOs. Production point observations never provide a numeric duration. */
export type ReflectionPeriod = 'week' | 'month';
export type ReflectionCoverage = 'recorded' | 'partial' | 'notRecorded' | 'deleted';
export type ReflectionBucket = { day: string; from: number; until: number; knownSeconds?: number; coverage: ReflectionCoverage };
export type ReflectionCumulativePoint = { at: number; cumulativeSeconds?: number; connected: boolean };
export type ReflectionLandscape = { startDay: string; latestDay: string; points: ReflectionCumulativePoint[] };
export type ReflectionInspectionWeek = { anchor: string; before?: ReflectionBucket; days: ReflectionBucket[] };
export type ReflectionWeekRead = { token: string; week: ReflectionInspectionWeek };
export type ReflectionSnapshot = {
  version: 1; metricVersion: 'restricted-excluding-unlocks-prototype-v1' | 'restricted-excluding-unlocks-v1' | 'native-restricted-excluding-unlocks-v2' | 'rule-schedule-excluding-unlocks-v1'; token: string;
  historyRevision?: string; observationCount?: number; lastObservedAt?: number; incomplete?: boolean;
  transfer?: 'current' | 'pending' | 'unavailable';
  sharedIncomplete?: boolean;
  proofScope: 'syntheticFixture' | 'pointObservations' | 'nativeRecordedIntervals' | 'ruleScheduleLogs'; timeZone: string; asOf: number;
  total: ReflectionBucket; trend: ReflectionBucket[]; period: ReflectionPeriod; anchor: string;
  landscape?: ReflectionLandscape; inspectionWeek?: ReflectionInspectionWeek;
  previousAnchor?: string; nextAnchor?: string; selected: ReflectionBucket; buckets: ReflectionBucket[];
};
export type ReflectionRequest = { period: ReflectionPeriod; day: string; expectedToken?: string; includeLandscape?: boolean; clippedTo?: { from: number; until: number } };
export interface ReflectionSource { readonly identity?: string; read(request: ReflectionRequest): Promise<string>; readWeek?(day: string, token: string): Promise<ReflectionWeekRead> }
export class ReflectionReadError extends Error {
  constructor(readonly code: 'changed' | 'unavailable' | 'not-created' | 'busy' | 'storage-failed' | 'capacity-full' | 'invalid-input') { super(code); }
}
const object = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('shape'); return v as Record<string, unknown>; };
const text = (v: unknown): string => { if (typeof v !== 'string' || v.length > 512) throw new Error('text'); return v; };
const number = (v: unknown): number => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('number'); return v; };
const choice = <T extends string>(v: unknown, options: readonly T[]): T => { if (!options.includes(v as T)) throw new Error('choice'); return v as T; };
const day = (v: unknown): string => { const s = text(v); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('day'); return s; };
function bucket(v: unknown): ReflectionBucket {
  const b = object(v), from = number(b.from), until = number(b.until);
  if (until < from) throw new Error('range');
  const seconds = b.knownSeconds == null ? undefined : number(b.knownSeconds);
  const coverage = choice(b.coverage, ['recorded', 'partial', 'notRecorded', 'deleted']);
  if (seconds !== undefined && (seconds < 0 || seconds > until - from || coverage === 'notRecorded' || coverage === 'deleted')) throw new Error('seconds');
  return { day: b.day === '' ? '' : day(b.day), from, until, knownSeconds: seconds, coverage };
}
function inspectionWeek(input: unknown): ReflectionInspectionWeek {
  const w = object(input), anchor = day(w.anchor);
  if (!Array.isArray(w.days) || w.days.length > 7) throw new Error('week bound');
  const days = w.days.map(bucket);
  if (days.some((b, i) => b.day < anchor || (i > 0 && (days[i - 1].day >= b.day || days[i - 1].until !== b.from)))) throw new Error('week order');
  const before = w.before == null ? undefined : bucket(w.before);
  if (before && days[0] && before.until > days[0].from) throw new Error('overlapping prefix');
  return { anchor, before, days };
}

function cumulative(input: unknown, total: ReflectionBucket, asOf: number): ReflectionLandscape {
  const value = object(input), startDay = day(value.startDay), latestDay = day(value.latestDay);
  if (startDay > latestDay || total.until > asOf || !Array.isArray(value.points) || value.points.length < 1 || value.points.length > 64) throw new Error('landscape bound');
  let previous = total.from, known = 0, previousKnown = true;
  const points = value.points.map(item => {
    const point = object(item), at = number(point.at);
    const seconds = point.cumulativeSeconds == null ? undefined : number(point.cumulativeSeconds);
    if (at <= previous || at > total.until || typeof point.connected !== 'boolean'
      || (point.connected && (!previousKnown || seconds === undefined))
      || (seconds !== undefined && (total.knownSeconds === undefined || seconds < known || seconds > total.knownSeconds || seconds > at - total.from))) throw new Error('cumulative point');
    previous = at; previousKnown = seconds !== undefined;
    if (seconds !== undefined) known = seconds;
    return { at, cumulativeSeconds: seconds, connected: point.connected };
  });
  if (previous !== total.until || points.at(-1)?.cumulativeSeconds !== total.knownSeconds) throw new Error('cumulative endpoint');
  return { startDay, latestDay, points };
}
const tokenValue = (value: unknown, prefix = 'reflection-v1:') => {
  if (typeof value !== 'string' || value.length > 1024 || !value.startsWith(prefix)) throw new Error('token');
  return value;
};
export function parseReflectionWeek(input: unknown): ReflectionWeekRead {
  const r = object(input);
  return { token: tokenValue(r.token), week: inspectionWeek(r.week) };
}

/** Allowlist fields; malformed/old data is an error, never an empty or successful measurement. */
function parse(json: string, prototype: boolean): ReflectionSnapshot {
  if (json.length > 250_000) throw new Error('bound');
  const s = object(JSON.parse(json));
  if (s.version !== 1) throw new Error('version');
  const metricVersion = choice(s.metricVersion, prototype ? ['restricted-excluding-unlocks-prototype-v1'] : ['restricted-excluding-unlocks-v1', 'native-restricted-excluding-unlocks-v2', 'rule-schedule-excluding-unlocks-v1']);
  const period = choice(s.period, ['week', 'month']);
  if (!Array.isArray(s.buckets) || s.buckets.length > (period === 'week' ? 7 : 6) || !Array.isArray(s.trend) || s.trend.length > 64) throw new Error('bound');
  const proofScope = choice(s.proofScope, prototype ? ['syntheticFixture', 'pointObservations'] : ['pointObservations', 'nativeRecordedIntervals', 'ruleScheduleLogs']);
  const metrics: Record<string, string> = { pointObservations: 'restricted-excluding-unlocks-v1', nativeRecordedIntervals: 'native-restricted-excluding-unlocks-v2', ruleScheduleLogs: 'rule-schedule-excluding-unlocks-v1' };
  if (!prototype && metrics[proofScope] !== metricVersion) throw new Error('scope');
  const total = bucket(s.total), selected = bucket(s.selected), buckets = s.buckets.map(bucket), trend = s.trend.map(bucket);
  if (proofScope === 'pointObservations' && [total, selected, ...buckets, ...trend].some(b => b.knownSeconds !== undefined)) throw new Error('unqualified');
  const timeZone = text(s.timeZone); new Intl.DateTimeFormat('ja-JP', { timeZone }).format(0);
  const token = tokenValue(s.token, prototype ? 'prototype-v1:' : 'reflection-v1:');
  const asOf = number(s.asOf);
  const landscape = s.landscape == null ? undefined : cumulative(s.landscape, total, asOf);
  const week = s.inspectionWeek == null ? undefined : inspectionWeek(s.inspectionWeek);
  if (landscape && (!week || week.days.at(-1)?.day !== landscape.latestDay) || week && !landscape) throw new Error('latest week');
  if (proofScope === 'pointObservations' && week && [week.before, ...week.days].some(b => b?.knownSeconds !== undefined)) throw new Error('unqualified');
  const metadata: Partial<ReflectionSnapshot> = {};
  if (!prototype) {
    const revision = text(s.historyRevision), count = number(s.observationCount);
    if (!/^(0|[1-9][0-9]*)$/.test(revision) || !Number.isSafeInteger(count) || count < 0 || typeof s.incomplete !== 'boolean') throw new Error('metadata');
    const last = s.lastObservedAt == null ? undefined : number(s.lastObservedAt);
    if ((count === 0) !== (last === undefined) || (last !== undefined && last > number(s.asOf))) throw new Error('metadata');
    Object.assign(metadata, { historyRevision: revision, observationCount: count, lastObservedAt: last, incomplete: s.incomplete });
    if (s.transfer != null) metadata.transfer = choice(s.transfer, ['current', 'pending', 'unavailable'] as const);
    if (s.sharedIncomplete != null) {
      if (typeof s.sharedIncomplete !== 'boolean') throw new Error('sample');
      metadata.sharedIncomplete = s.sharedIncomplete;
    }
  }
  return { ...metadata, version: 1, metricVersion, token, proofScope, timeZone, asOf, total, trend, landscape, inspectionWeek: week, period,
    anchor: day(s.anchor), previousAnchor: s.previousAnchor == null ? undefined : day(s.previousAnchor),
    nextAnchor: s.nextAnchor == null ? undefined : day(s.nextAnchor), selected, buckets };
}

/** Display rounding only. Interval arithmetic and calendar buckets belong to Swift. */
export function reflectionDuration(seconds: number | undefined): string {
  if (seconds === undefined) return '—';
  if (seconds === 0) return '0分';
  if (seconds < 60) return '1分未満';
  const minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60);
  return hours ? `${hours}時間${minutes % 60 ? `${minutes % 60}分` : ''}` : `${minutes}分`;
}

export const parseReflectionSnapshot = (json: string): ReflectionSnapshot => parse(json, false);
export const parseReflectionPrototypeSnapshot = (json: string): ReflectionSnapshot => parse(json, true);
