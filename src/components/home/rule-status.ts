import type { ScreenTimeSnapshot, ScreenTimeTarget } from '../../../modules/itoma-native';

/** Presentation only. Native target.ruleID is the winner; JS never selects a winning rule. */
export function currentRulePeriods(s: ScreenTimeSnapshot | undefined, now: number) {
  return s?.periods.filter(p => p.startsAt * 1000 <= now && p.endsAt * 1000 > now
    && s.rules.some(rule => rule.id === p.ruleID && rule.enabled)) ?? [];
}
export function hasFreshRestrictionState(s: ScreenTimeSnapshot | undefined, now: number) {
  return !!s && s.availability === 'device' && s.storage === 'ready' && !s.needsSelectionReview && s.authorization === 'approved' && s.activation === 'enabled'
    && s.schedulesReady && s.observation === 'applied' && (s.validUntil ?? 0) * 1000 > now && (s.evaluatedAt === undefined || s.evaluatedAt * 1000 <= now);
}
export function currentRuleTargets(s: ScreenTimeSnapshot | undefined, now: number) {
  const ids = new Set(currentRulePeriods(s, now).map(p => p.ruleID)), seen = new Set<string>();
  return s?.targets.filter(target => {
    if (!target.ruleID || !ids.has(target.ruleID) || seen.has(target.ref)) return false;
    seen.add(target.ref); return true;
  }) ?? [];
}
export function unlockCandidates(s: ScreenTimeSnapshot | undefined, now: number, ruleID: string | undefined) {
  if (!ruleID || !hasFreshRestrictionState(s, now)) return [];
  return currentRuleTargets(s, now).filter(target => target.restricted && target.unlockable && !target.grantCommandID && target.ruleID === ruleID);
}
export function targetPeriod(s: ScreenTimeSnapshot | undefined, target: ScreenTimeTarget | undefined, now: number) {
  return currentRulePeriods(s, now).find(period => period.ruleID === target?.ruleID);
}
export function targetScope(s: ScreenTimeSnapshot | undefined, target: ScreenTimeTarget | undefined, now: number) {
  const period = targetPeriod(s, target, now);
  return target && period ? [target.ref, target.selectionRef, period.ruleID, period.startsAt, period.endsAt].join(':') : '';
}

/** Native boundaries only. Never preview a future weekly schedule in JS. */
export function nextScheduleChanges(s: ScreenTimeSnapshot, now: number) {
  const changes = [
    ...currentRulePeriods(s, now).map(p => ({ at: p.endsAt, ruleID: p.ruleID, kind: 'end' as const })),
    ...(s.nextPeriod && s.nextPeriod.startsAt * 1000 > now
      ? [{ at: s.nextPeriod.startsAt, ruleID: s.nextPeriod.ruleID, kind: 'start' as const }] : []),
  ].sort((a, b) => a.at - b.at);
  return changes.filter(change => change.at === changes[0]?.at);
}
