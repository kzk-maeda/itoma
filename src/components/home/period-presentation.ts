export type PeriodPresentation =
  | { state: 'invalid' | 'upcoming' | 'expired' }
  | { state: 'current'; remaining: string; fraction: number; endLabel: string };

/** Display math only. Reaching zero never proves an OS restriction change. */
export function presentPeriod(startsAt: number, endsAt: number, now: number): PeriodPresentation {
  if (![startsAt, endsAt, now].every((value) => Number.isFinite(value) && Number.isFinite(new Date(value).getTime()))
    || endsAt <= startsAt) return { state: 'invalid' };
  if (now < startsAt) return { state: 'upcoming' };
  if (now >= endsAt) return { state: 'expired' };
  const remainingMs = endsAt - now;
  const minutes = Math.ceil(remainingMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const remaining = remainingMs < 60_000 ? '1分未満'
    : hours ? `${hours}時間${minutes % 60 ? `${minutes % 60}分` : ''}` : `${minutes}分`;
  const end = new Date(endsAt), today = new Date(now), tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const sameDay = (date: Date) => date.getFullYear() === end.getFullYear()
    && date.getMonth() === end.getMonth() && date.getDate() === end.getDate();
  const prefix = sameDay(today) ? '' : sameDay(tomorrow) ? '翌' : `${end.getMonth() + 1}月${end.getDate()}日 `;
  const time = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
  return { state: 'current', remaining, fraction: Math.max(0, Math.min(1, remainingMs / (endsAt - startsAt))), endLabel: `${prefix}${time}に終了` };
}
