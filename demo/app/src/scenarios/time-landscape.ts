import { moveDay, type DayRecord } from './records';
import { DAY, GROWTH_AS_OF, HOUR, MONTH, YEAR, durationWords } from './time-growth';

export const editions = [
  { id: 'hours', label: '4時間13分', seconds: 253 * 60 },
  { id: 'days', label: '1日と6時間', seconds: 30 * HOUR },
  { id: 'months', label: '40日分', seconds: 40 * DAY },
  { id: 'years', label: '438日分', seconds: 438 * DAY },
  { id: 'partial', label: '一部未記録', seconds: 30 * HOUR },
  { id: 'zero', label: '記録あり・0分', seconds: 0 },
  { id: 'empty', label: 'まだ記録なし', seconds: undefined },
] as const;

export type Edition = (typeof editions)[number]['id'];

// Synthetic daily amounts in minutes. A quiet day may have a confirmed zero.
const dailyMinutes = [20, 25, 0, 50, 120, 190, 135, 65, 25, 0, 30, 95, 145, 230, 150, 55, 30, 15, 20, 90, 170, 220];

export function landscapeDays(id: Edition): DayRecord[] {
  const edition = editions.find(item => item.id === id)!;
  if (edition.seconds === undefined) return [];
  if (edition.seconds === 0) return [{ day: GROWTH_AS_OF, seconds: 0 }];
  const amounts = [];
  let remaining: number = edition.seconds;
  while (remaining > 0) {
    const seconds = Math.min(remaining, dailyMinutes[amounts.length % dailyMinutes.length] * 60);
    amounts.push(seconds);
    remaining -= seconds;
  }
  const records: DayRecord[] = amounts.map(seconds => ({ day: '', seconds }));
  if (id === 'partial') records.splice(7, 0, { day: '' });
  return records.map((record, index) => ({ ...record, day: moveDay(GROWTH_AS_OF, index - records.length + 1) }));
}

export function landscapeSeries(records: DayRecord[]) {
  let total = 0;
  let partial = false;
  return records.map(record => {
    if (record.seconds === undefined) partial = true;
    else total += record.seconds;
    return { ...record, total: record.seconds === undefined ? undefined : total, partial };
  });
}

export type LandscapeDay = ReturnType<typeof landscapeSeries>[number];

export function durationType(seconds: number | undefined) {
  if (seconds === undefined) return { prefix: '', number: '—', unit: '', tail: '' };
  const [size, unit, prefix] = seconds >= YEAR ? [YEAR, '年分', '約'] as const
    : seconds >= MONTH ? [MONTH, 'か月分', '約'] as const
    : seconds >= DAY ? [DAY, '日分', ''] as const
    : seconds >= HOUR ? [HOUR, '時間', ''] as const : [60, '分', ''] as const;
  const remainder = seconds % size;
  return { prefix, number: String(Math.floor(seconds / size)), unit, tail: remainder ? durationWords(remainder) : '' };
}
