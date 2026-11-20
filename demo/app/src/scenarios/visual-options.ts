import { moveDay, weekStart, sumKnown, type DayRecord } from './records';
export const AS_OF = '2026-11-20';
export const viewOptions = [
  { path: '/blocks', label: '01 時間のブロック', short: '01 ブロック' },
  { path: '/weeks', label: '02 週ごとの積み上げ', short: '02 週の積み上げ' },
  { path: '/calendar', label: '03 カレンダー', short: '03 カレンダー' },
  { path: '/day', label: '04 1日の時間帯', short: '04 時間帯' },
  { path: '/cumulative', label: '比較：累積グラフ', short: '比較：累積グラフ' },
] as const;
export function timeBlocks(seconds: number) {
  const unit = [3600, 18000, 36000, 86400].find(value => Math.ceil(seconds / value) <= 12) ?? Math.ceil(seconds / 12 / 3600) * 3600;
  return { unit, blocks: Array.from({ length: Math.ceil(seconds / unit) }, (_, n) => Math.min(unit, seconds - n * unit)) };
}
export function weekContributions(records: DayRecord[]) {
  const groups = new Map<string, DayRecord[]>();
  for (const record of records) { const key = weekStart(record.day); groups.set(key, [...(groups.get(key) ?? []), record]); }
  return [...groups].map(([key, days]) => ({ key, days, seconds: sumKnown(days), partial: days.some(value => value.seconds === undefined) }));
}
export function calendarCells(period: 'week' | 'month', anchor: string): (string | undefined)[] {
  if (period === 'week') return Array.from({ length: 7 }, (_, n) => moveDay(weekStart(anchor), n));
  const first = anchor.slice(0, 7) + '-01', start = weekStart(first), date = new Date(first + 'T00:00:00Z');
  const count = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  const offset = (Date.parse(first) - Date.parse(start)) / 86400000;
  return Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, n) => { const day = moveDay(start, n); return day.slice(0, 7) === first.slice(0, 7) ? day : undefined; });
}
export type Band = { kind: 'none' | 'restricted' | 'unlock' | 'unknown'; from: number; until: number };
/** Synthetic layout only: confirmed daily minutes are split around a 10-minute unlock. */
export function dayBands(record?: DayRecord): Band[] {
  if (record?.seconds === undefined) return [{ kind: 'unknown', from: 0, until: 1440 }];
  if (record.seconds === 0) return [{ kind: 'none', from: 0, until: 1440 }];
  const minutes = record.seconds / 60, start = minutes > 180 ? 540 : 1230, half = Math.ceil(minutes / 2), end = start + minutes + 10;
  return [{ kind: 'none', from: 0, until: start }, { kind: 'restricted', from: start, until: start + half }, { kind: 'unlock', from: start + half, until: start + half + 10 }, { kind: 'restricted', from: start + half + 10, until: end }, { kind: 'none', from: end, until: 1440 }].filter(value => value.until > value.from) as Band[];
}
export const clockTime = (minutes: number) => { const rounded = Math.round(minutes); return `${Math.floor(rounded / 60).toString().padStart(2, '0')}:${(rounded % 60).toString().padStart(2, '0')}`; };
