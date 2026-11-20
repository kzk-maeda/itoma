import { moveDay, type DayRecord } from './records';
export const HOUR = 3600, DAY = 24 * HOUR, MONTH = 30 * DAY, YEAR = 365 * DAY;
export const GROWTH_AS_OF = '2026-11-20';
export const growthScenes = [
  { id: 'hours', label: '時間分 · 4時間13分', seconds: 4 * HOUR + 13 * 60 },
  { id: 'days', label: '日分 · 30時間', seconds: 30 * HOUR },
  { id: 'months', label: 'か月分 · 40日', seconds: 40 * DAY },
  { id: 'years', label: '年分 · 438日', seconds: 438 * DAY },
  { id: 'day-before', label: '1日分になる直前', seconds: DAY - 600, after: 'day-after' },
  { id: 'day-after', label: '1日分になったところ', seconds: DAY + 600 },
  { id: 'month-before', label: '1か月分になる直前', seconds: MONTH - 600, after: 'month-after' },
  { id: 'month-after', label: '1か月分になったところ', seconds: MONTH + 600 },
  { id: 'year-before', label: '1年分になる直前', seconds: YEAR - 600, after: 'year-after' },
  { id: 'year-after', label: '1年分になったところ', seconds: YEAR + 600 },
  { id: 'partial', label: '一部未記録 · 既知30時間', seconds: 30 * HOUR, partial: true },
  { id: 'zero', label: '記録あり · 0分', seconds: 0 },
  { id: 'empty', label: 'まだ記録なし', seconds: undefined },
];
export type GrowthScene = (typeof growthScenes)[number];
export function growthReadout(seconds?: number) {
  if (seconds === undefined) return undefined;
  const [kind, size, label] = seconds >= YEAR ? ['years', YEAR, '年分'] as const : seconds >= MONTH ? ['months', MONTH, 'か月分'] as const : seconds >= DAY ? ['days', DAY, '日分'] as const : ['hours', HOUR, '時間分'] as const;
  const whole = Math.floor(seconds / size), remainder = seconds % size;
  return { kind, size, label, whole, remainder, approximate: kind === 'months' || kind === 'years', ringSize: kind === 'hours' ? DAY : size, ringValue: kind === 'hours' ? seconds : remainder };
}
export function durationWords(seconds: number) {
  const days = Math.floor(seconds / DAY), hours = Math.floor(seconds % DAY / HOUR), minutes = Math.floor(seconds % HOUR / 60), rest = seconds % 60;
  return `${days ? `${days.toLocaleString('ja-JP')}日` : ''}${hours ? `${hours}時間` : ''}${minutes ? `${minutes}分` : ''}${rest ? `${rest}秒` : ''}` || '0分';
}
/** A fixed synthetic daily ledger, capped at four hours per day, not an OS DTO. */
export function growthDays(scene: GrowthScene): DayRecord[] {
  if (scene.seconds === undefined) return [];
  if (scene.seconds === 0) return [{ day: GROWTH_AS_OF, seconds: 0 }];
  const count = Math.ceil(scene.seconds / (4 * HOUR));
  const records: DayRecord[] = Array.from({ length: count }, (_, n) => ({ day: moveDay(GROWTH_AS_OF, n - count + 1), seconds: Math.min(4 * HOUR, scene.seconds! - n * 4 * HOUR) }));
  if ('partial' in scene && scene.partial) records.unshift({ day: moveDay(records[0].day, -1) });
  return records;
}
export function growthMilestones(records: DayRecord[]) {
  let total = 0;
  const targets = [{ seconds: HOUR, label: '1時間分' }, { seconds: DAY, label: '1日分' }, { seconds: MONTH, label: '約1か月分' }, { seconds: YEAR, label: '約1年分' }];
  const result: { label: string; day: string; partial: boolean }[] = [];
  let partial = false;
  for (const record of records) {
    if (record.seconds === undefined) { partial = true; continue; }
    total += record.seconds;
    while (targets[result.length] && total >= targets[result.length].seconds) result.push({ label: targets[result.length].label, day: record.day, partial });
  }
  return result;
}
