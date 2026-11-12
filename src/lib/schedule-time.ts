/** Presentation/input conversion only. Native WeeklySchedule remains the final validator. */
export function clockMinute(value: string): number | undefined {
  return /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : undefined;
}
export function timeRange(start: string, end: string) {
  const startMinute = clockMinute(start), endMinute = clockMinute(end);
  if (startMinute === undefined || endMinute === undefined) return undefined;
  const nextDay = endMinute <= startMinute;
  const minutes = endMinute - startMinute + (nextDay ? 1440 : 0);
  return { startMinute, endMinute, nextDay, minutes, label: `${start}〜${nextDay ? '翌' : ''}${end}${minutes === 1440 ? '（24時間）' : ''}` };
}
/** UTC is a carrier for clock components only, avoiding DST gaps in the picker's reference date. */
export function pickerDate(value: string) {
  const minute = clockMinute(value) ?? 0;
  return new Date(Date.UTC(2001, 0, 1, Math.floor(minute / 60), minute % 60));
}
export function pickerTime(date: Date): string | undefined {
  if (!Number.isFinite(date.getTime())) return undefined;
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}
