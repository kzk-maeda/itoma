/** Isolated prototype DTO. No production bridge or OS proof producer is connected. */
export type ReflectionPeriod = 'week' | 'month';
export type ReflectionCoverage = 'recorded' | 'partial' | 'notRecorded' | 'deleted';
export type ReflectionBucket = { day: string; from: number; until: number; knownSeconds?: number; coverage: ReflectionCoverage };
export type ReflectionSnapshot = {
  version: 1; metricVersion: 'restricted-excluding-unlocks-prototype-v1'; token: string;
  proofScope: 'syntheticFixture' | 'pointObservations'; timeZone: string; asOf: number;
  total: ReflectionBucket; trend: ReflectionBucket[]; period: ReflectionPeriod; anchor: string;
  previousAnchor?: string; nextAnchor?: string; selected: ReflectionBucket; buckets: ReflectionBucket[];
};
export type ReflectionRequest = { period: ReflectionPeriod; day: string; expectedToken?: string; clippedTo?: { from: number; until: number } };
export interface ReflectionPrototypeSource { read(request: ReflectionRequest): Promise<string> }
export class ReflectionPrototypeReadError extends Error {
  constructor(readonly code: 'changed' | 'unavailable') { super(code); }
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
/** Allowlist fields; malformed/old data is an error, never an empty or successful measurement. */
export function parseReflectionSnapshot(json: string): ReflectionSnapshot {
  if (json.length > 250_000) throw new Error('bound');
  const s = object(JSON.parse(json));
  if (s.version !== 1 || s.metricVersion !== 'restricted-excluding-unlocks-prototype-v1') throw new Error('version');
  const period = choice(s.period, ['week', 'month']);
  if (!Array.isArray(s.buckets) || s.buckets.length > (period === 'week' ? 7 : 6) || !Array.isArray(s.trend) || s.trend.length > 64) throw new Error('bound');
  const proofScope = choice(s.proofScope, ['syntheticFixture', 'pointObservations']);
  const total = bucket(s.total), selected = bucket(s.selected), buckets = s.buckets.map(bucket), trend = s.trend.map(bucket);
  if (proofScope === 'pointObservations' && [total, selected, ...buckets, ...trend].some(b => b.knownSeconds !== undefined)) throw new Error('unqualified');
  const timeZone = text(s.timeZone); new Intl.DateTimeFormat('ja-JP', { timeZone }).format(0);
  const token = text(s.token); if (!token.startsWith('prototype-v1:')) throw new Error('token');
  return { version: 1, metricVersion: s.metricVersion, token, proofScope, timeZone, asOf: number(s.asOf), total, trend, period,
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
