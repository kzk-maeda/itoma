import type { ScreenTimeRule } from '../../../modules/itoma-native';
export const weekdayNames = ['月', '火', '水', '木', '金', '土', '日'];
export const clockText = (minute: number) => `${Math.floor(minute / 60).toString().padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;
export const ruleText = (rule: ScreenTimeRule) => `${rule.weekdays.map((v) => weekdayNames[v - 1]).join('・')} ${clockText(rule.startMinute)}〜${rule.nextDay ? '翌' : ''}${clockText(rule.endMinute)}${rule.nextDay && rule.startMinute === rule.endMinute ? '（24時間）' : ''}`;
export const localTime = (seconds: number) => new Date(seconds * 1000).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
export function endTime(seconds: number, now: number) {
  const date = new Date(seconds * 1000), today = new Date(now);
  return `${date.toDateString() === today.toDateString() ? '' : `${date.getMonth() + 1}/${date.getDate()} `}${localTime(seconds)}`;
}
export function grantRemaining(seconds: number, now: number) {
  const remaining = Math.max(0, Math.ceil(seconds - now / 1000));
  return remaining === 0 ? '期限が終了しました' : `${Math.floor(remaining / 60)}:${(remaining % 60).toString().padStart(2, '0')}`;
}
