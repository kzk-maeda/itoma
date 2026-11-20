/** Synthetic day records. This file is not a native restriction evaluator or product DTO. */
export type DayRecord = { day: string; seconds?: number };
export type Dataset = { id: string; label: string; days: DayRecord[] };
const day = (date: string) => new Date(date + 'T00:00:00Z');
export const moveDay = (date: string, count: number) => { const d = day(date); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0, 10); };
export const weekStart = (date: string) => moveDay(date, -(day(date).getUTCDay() + 6) % 7);
const normal = [50, 70, 13, 80, 40].map((minutes, n) => ({ day: moveDay('2026-11-16', n), seconds: minutes * 60 }));
const longValues: Record<string, number> = { '2026-09-01': 480, '2026-09-08': 450, '2026-09-15': 630, '2026-09-22': 500, '2026-10-01': 720, '2026-10-08': 660, '2026-10-15': 400, '2026-10-22': 520, '2026-11-01': 300, '2026-11-09': 200 };
for (const record of normal) longValues[record.day] = record.seconds / 60;
const longDays = Array.from({ length: 81 }, (_, n) => { const date = moveDay('2026-09-01', n); return { day: date, seconds: (longValues[date] ?? 0) * 60 }; });
export const datasets: Dataset[] = [
  { id: 'normal', label: '通常 · 4時間13分', days: normal },
  { id: 'gap', label: '一部の記録なし', days: normal.map((record, n) => n === 2 ? { day: record.day } : record) },
  { id: 'empty', label: 'まだ記録なし', days: [] },
  { id: 'zero', label: '記録あり · 0分', days: normal.map(record => ({ ...record, seconds: 0 })) },
  { id: 'long', label: '長期間の積み上げ', days: longDays },
];
export function sumKnown(records: DayRecord[]): number | undefined {
  const known = records.filter(record => record.seconds !== undefined);
  return known.length ? known.reduce((total, record) => total + record.seconds!, 0) : undefined;
}
export function cumulative(records: DayRecord[]) {
  let total = 0;
  return records.map(record => {
    if (record.seconds === undefined) return { day: record.day, seconds: undefined };
    total += record.seconds;
    return { day: record.day, seconds: total };
  });
}
export function sampleCumulative(records: DayRecord[]) {
  const rows = cumulative(records), step = Math.max(1, Math.ceil((rows.length - 1) / 31));
  return rows.filter((row, n) => n === 0 || n === rows.length - 1 || n % step === 0 || row.seconds === undefined || rows[n - 1]?.seconds === undefined || rows[n + 1]?.seconds === undefined);
}
export function selectedDays(records: DayRecord[], period: 'week' | 'month', anchor: string) {
  return records.filter(record => period === 'month' ? record.day.slice(0, 7) === anchor.slice(0, 7) : weekStart(record.day) === weekStart(anchor));
}
export function periodRows(records: DayRecord[], period: 'week' | 'month', anchor: string) {
  const selected = selectedDays(records, period, anchor);
  if (period === 'week') return selected.map(record => ({ key: record.day, label: `${Number(record.day.slice(5, 7))}/${Number(record.day.slice(8))}`, seconds: record.seconds, partial: record.seconds === undefined }));
  const groups = new Map<string, DayRecord[]>();
  for (const record of selected) { const key = weekStart(record.day); groups.set(key, [...(groups.get(key) ?? []), record]); }
  return [...groups].map(([key, values]) => ({ key, label: `${Number(values[0].day.slice(5, 7))}/${Number(values[0].day.slice(8))}〜`, seconds: sumKnown(values), partial: values.some(value => value.seconds === undefined) }));
}
export function shiftAnchor(anchor: string, period: 'week' | 'month', direction: number) {
  if (period === 'week') return moveDay(weekStart(anchor), direction * 7);
  const date = day(anchor.slice(0, 7) + '-01'); date.setUTCMonth(date.getUTCMonth() + direction); return date.toISOString().slice(0, 10);
}
export const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
