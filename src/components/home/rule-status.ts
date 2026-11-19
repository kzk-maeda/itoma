import type { ScreenTimePeriod, ScreenTimeRule, ScreenTimeSnapshot, ScreenTimeTarget } from '../../../modules/itoma-native';

/** Presentation only. Native target.ruleID is the winner; JS never selects a winning rule. */
export function currentRulePeriods(s: ScreenTimeSnapshot | undefined, now: number) {
  return s?.periods.filter(p => p.startsAt * 1000 <= now && p.endsAt * 1000 > now
    && s.rules.some(rule => rule.id === p.ruleID && rule.enabled)) ?? [];
}
export function hasFreshRestrictionState(s: ScreenTimeSnapshot | undefined, now: number) {
  return !!s && s.availability === 'device' && s.authorization === 'approved' && s.activation === 'enabled'
    && s.schedulesReady && s.observation === 'applied' && (s.validUntil ?? 0) * 1000 > now;
}
export function currentRuleTargets(s: ScreenTimeSnapshot | undefined, now: number) {
  const ids = new Set(currentRulePeriods(s, now).map(p => p.ruleID)), seen = new Set<string>();
  return s?.targets.filter(target => {
    if (!target.ruleID || !ids.has(target.ruleID) || seen.has(target.ref)) return false;
    seen.add(target.ref); return true;
  }) ?? [];
}
export function unlockCandidates(s: ScreenTimeSnapshot | undefined, now: number) {
  if (!hasFreshRestrictionState(s, now)) return [];
  return currentRuleTargets(s, now).filter(target => target.restricted && target.unlockable && !target.grantCommandID);
}
export function targetPeriod(s: ScreenTimeSnapshot | undefined, target: ScreenTimeTarget | undefined, now: number) {
  return currentRulePeriods(s, now).find(period => period.ruleID === target?.ruleID);
}
export function targetScope(s: ScreenTimeSnapshot | undefined, target: ScreenTimeTarget | undefined, now: number) {
  const period = targetPeriod(s, target, now);
  return target && period ? [target.ref, period.ruleID, period.startsAt, period.endsAt].join(':') : '';
}
export type SavedSchedule = { rule: ScreenTimeRule; startsAt: number; endsAt: number; status: 'past' | 'current' | 'upcoming' };
/** Saved local-calendar preview, NOT an evaluator or OS evidence. Includes yesterday's overnight rule.
 * Runtime eligibility above always uses native periods. DST resolution remains native's responsibility. */
export function savedDaySchedule(rules: ScreenTimeRule[], now: number): SavedSchedule[] {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const rows: SavedSchedule[] = [];
  for (const offset of [-1, 0]) {
    const day = new Date(today); day.setDate(day.getDate() + offset);
    for (const rule of rules) {
      if (!rule.enabled || !rule.weekdays.includes(day.getDay() || 7)) continue;
      const start = new Date(day); start.setHours(Math.floor(rule.startMinute / 60), rule.startMinute % 60);
      const end = new Date(day); end.setDate(end.getDate() + (rule.nextDay ? 1 : 0));
      end.setHours(Math.floor(rule.endMinute / 60), rule.endMinute % 60);
      if (end <= today || start >= tomorrow || end <= start) continue;
      rows.push({ rule, startsAt: start.getTime() / 1000, endsAt: end.getTime() / 1000,
        status: end.getTime() <= now ? 'past' : start.getTime() > now ? 'upcoming' : 'current' });
    }
  }
  return rows.sort((a, b) => a.startsAt - b.startsAt || a.rule.id.localeCompare(b.rule.id));
}
export function nextScheduleChanges(periods: ScreenTimePeriod[], schedule: SavedSchedule[], now: number) {
  const changes = [
    ...periods.filter(p => p.endsAt * 1000 > now).map(p => ({ at: p.endsAt, ruleID: p.ruleID, kind: 'end' as const })),
    ...schedule.filter(row => row.status === 'upcoming').map(row => ({ at: row.startsAt, ruleID: row.rule.id, kind: 'start' as const })),
  ].sort((a, b) => a.at - b.at);
  return changes.filter(change => change.at === changes[0]?.at);
}
