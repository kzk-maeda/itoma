import { reflectionDuration, type ReflectionInspectionWeek, type ReflectionSnapshot } from '../../modules/itoma-native/src/reflection-model';
import { moveDay } from './history-date';

export const hour = 3600;
export const dayLength = 24 * hour;
const monthLength = 30 * dayLength;
const yearLength = 365 * dayLength;
export const printLevels = [
  { seconds: yearLength, label: '約1年分' },
  { seconds: monthLength, label: '約1か月分' },
  { seconds: dayLength, label: '1日分' },
  { seconds: hour, label: '1時間' },
];

export function cumulativeAmount(seconds: number | undefined) {
  if (seconds === undefined || seconds > 0 && seconds < 60) {
    return { number: reflectionDuration(seconds), unit: '', prefix: '', tail: '' };
  }
  const scale = seconds >= yearLength ? yearLength : seconds >= monthLength ? monthLength
    : seconds >= dayLength ? dayLength : seconds >= hour ? hour : 60;
  const number = Math.floor(seconds / scale), remainder = seconds - number * scale;
  const unit = scale === yearLength ? '年分' : scale === monthLength ? 'か月分'
    : scale === dayLength ? '日分' : scale === hour ? '時間' : '分';
  const days = Math.floor(remainder / dayLength);
  const remainingDaySeconds = remainder - days * dayLength;
  const tail = (days ? `${days}日` : '') + (remainingDaySeconds >= 60 ? reflectionDuration(remainingDaySeconds) : '');
  return { prefix: scale >= monthLength ? '約' : '', number: String(number), unit,
    tail: tail && scale >= dayLength ? 'と' + tail : tail };
}

const ordinal = (day: string) => Date.parse(day + 'T00:00:00Z') / 86_400_000;
export const dayDistance = (from: string, until: string) => ordinal(until) - ordinal(from);
export const monday = (day: string) => moveDay(day, -((new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7));

export function inspectDay(snapshot: ReflectionSnapshot, week: ReflectionInspectionWeek | undefined, day: string) {
  if (snapshot.proofScope === 'pointObservations') return { cumulative: undefined, partial: true };
  const index = week?.days.findIndex(row => row.day === day) ?? -1;
  if (!week || index < 0) return undefined;
  const current = week.days[index], prefix = week.days.slice(0, index + 1);
  const before = week.before;
  const cumulative = (before?.knownSeconds ?? 0) + prefix.reduce((sum, row) => sum + (row.knownSeconds ?? 0), 0);
  const partial = snapshot.incomplete || !!(before && before.coverage !== 'recorded')
    || prefix.some(row => row.until > snapshot.total.from && row.coverage !== 'recorded');
  return { cumulative: current.knownSeconds === undefined ? undefined : cumulative, partial };
}
