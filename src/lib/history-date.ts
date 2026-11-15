export function dayAt(at: number, zone: string) {
  if (!Number.isFinite(new Date(at * 1000).getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at * 1000));
    return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`;
  } catch { return new Date(at * 1000).toISOString().slice(0, 10); }
}
export function moveDay(day: string, count: number) {
  const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + count); return date.toISOString().slice(0, 10);
}
export function dateLabel(day: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '日付を確認できません'; return `${Number(day.slice(0, 4))}年${Number(day.slice(5, 7))}月${Number(day.slice(8))}日`; }
export function timeLabel(at: number, zone: string) {
  const date = new Date(at * 1000);
  if (!Number.isFinite(date.getTime())) return '時刻を確認できません';
  try { return date.toLocaleTimeString('ja-JP', { timeZone: zone, hour: '2-digit', minute: '2-digit' }); } catch { return date.toISOString().slice(11, 16) + ' UTC'; }
}
