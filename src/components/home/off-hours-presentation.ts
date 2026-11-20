import type { ScreenTimePeriod, ScreenTimeRule, ScreenTimeSnapshot } from '../../../modules/itoma-native';
import { currentRulePeriods, hasFreshRestrictionState } from './rule-status';

export type NextStart = { date: string; time: string };
type OffHours = { kind: 'hidden' | 'unavailable' | 'checking' | 'none' }
  | { kind: 'next'; period: ScreenTimePeriod; rule: ScreenTimeRule; ruleIndex: number; count: number; start: NextStart; end: string };
const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
const clock = (date: Date) => date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
const nextDay = (date: Date) => { const next = new Date(date); next.setDate(next.getDate() + 1); return next; };
const dated = (date: Date, reference: Date) => date.toLocaleDateString('ja-JP', {
  ...(date.getFullYear() !== reference.getFullYear() ? { year: 'numeric' as const } : {}), month: 'long', day: 'numeric', weekday: 'short',
});
/** Format resolved instants in the device zone. This never evaluates a saved weekly rule. */
export function nextStartText(seconds: number, now: number): NextStart {
  const date = new Date(seconds * 1000), today = new Date(now);
  return { date: dayKey(date) === dayKey(today) ? '今日' : dayKey(date) === dayKey(nextDay(today)) ? '明日' : dated(date, today), time: clock(date) };
}
export function nextEndText(period: ScreenTimePeriod) {
  const start = new Date(period.startsAt * 1000), end = new Date(period.endsAt * 1000);
  return `${dayKey(end) === dayKey(start) ? '' : dayKey(end) === dayKey(nextDay(start)) ? '翌日 ' : `${dated(end, start)} `}${clock(end)}に終了`;
}
/** Nil from native's finite (8 day) search is not proof that enabled rules have no future occurrence. */
export function offHoursPresentation(s: ScreenTimeSnapshot | undefined, now: number, ready = true): OffHours {
  if (!s?.rules.length || s.activation !== 'enabled' || currentRulePeriods(s, now).length) return { kind: 'hidden' };
  if (!ready || !hasFreshRestrictionState(s, now)) return { kind: 'unavailable' };
  // A passed interval needs a new native snapshot, even if a malformed/old port leaves a future validUntil.
  if (s.evaluatedAt === undefined || s.periods.length || s.period || s.targets.some(t => t.restricted || t.ruleID)) return { kind: 'checking' };
  const period = s.nextPeriod;
  if (!period) return { kind: s.rules.some(rule => rule.enabled) ? 'checking' : 'none' };
  const ruleIndex = s.rules.findIndex(rule => rule.id === period.ruleID), rule = s.rules[ruleIndex];
  const selection = s.selections.find(value => value.ref === rule?.selectionRef);
  if (!rule?.enabled || !selection || selection.count < 1 || period.startsAt * 1000 <= now || period.endsAt <= period.startsAt
    || !Number.isFinite(new Date(period.startsAt * 1000).getTime()) || !Number.isFinite(new Date(period.endsAt * 1000).getTime())) return { kind: 'checking' };
  return { kind: 'next', period, rule, ruleIndex, count: selection.count, start: nextStartText(period.startsAt, now), end: nextEndText(period) };
}
/** Used only to request a new native read after a civil date/zone/offset change. */
export const homeTimeContext = (now: number) => `${dayKey(new Date(now))}:${Intl.DateTimeFormat().resolvedOptions().timeZone}:${new Date(now).getTimezoneOffset()}`;
