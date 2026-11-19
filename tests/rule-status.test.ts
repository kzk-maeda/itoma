import { at2130, at2205, ids, scopedSnapshot } from './fixtures/scoped-rules';
import { currentRulePeriods, currentRuleTargets, hasFreshRestrictionState, nextScheduleChanges, targetScope, unlockCandidates } from '../src/components/home/rule-status';

test('native winners give night Instagram and reading X/YouTube at 21:30, then bedtime X/TikTok at 22:05', () => {
  const early = scopedSnapshot(), late = scopedSnapshot(true);
  expect(unlockCandidates(early, at2130, ids.night).map(t => t.ref)).toEqual([ids.instagram]);
  expect(unlockCandidates(early, at2130, ids.reading).map(t => t.ref)).toEqual([ids.x, ids.youtube]);
  expect(unlockCandidates(late, at2205, ids.night).map(t => t.ref)).toEqual([ids.instagram]);
  expect(unlockCandidates(late, at2205, ids.bed).map(t => t.ref)).toEqual([ids.x, ids.tiktok]);
  expect(unlockCandidates(late, at2205, ids.reading)).toEqual([]);
  expect(unlockCandidates(early, at2130, undefined)).toEqual([]);
});
test.each([
  { availability: 'simulator' }, { storage: 'not-created' }, { needsSelectionReview: true }, { authorization: 'denied' }, { activation: 'paused' },
  { schedulesReady: false }, { observation: 'unknown' }, { validUntil: at2130 / 1000 }, { evaluatedAt: at2130 / 1000 + 1 },
] as const)('unconfirmed state %j cannot provide unlock candidates', change => {
  const s = { ...scopedSnapshot(), ...change };
  expect(hasFreshRestrictionState(s, at2130)).toBe(false);
  expect(unlockCandidates(s, at2130, ids.reading)).toEqual([]);
});
test('disabled/expired periods, unowned/duplicate targets and accepted commands never widen candidates', () => {
  const s = scopedSnapshot();
  s.targets.push({ ...s.targets[1] }, { ...s.targets[0], ref: 'orphan', ruleID: ids.bed });
  s.targets[1] = { ...s.targets[1], grantCommandID: ids.command };
  s.targets[2] = { ...s.targets[2], unlockable: false };
  expect(currentRuleTargets(s, at2130).map(t => t.ref)).toEqual([ids.instagram, ids.x, ids.youtube]);
  expect(unlockCandidates(s, at2130, ids.reading)).toEqual([]);
  expect(currentRulePeriods(s, at2130 + 30 * 60_000).map(p => p.ruleID)).toEqual([ids.night]);
  s.rules[0].enabled = false;
  expect(currentRuleTargets(s, at2130).some(t => t.ref === ids.instagram)).toBe(false);
});
test('selection identity and native occurrence changes invalidate the saved scope even when the app ref is unchanged', () => {
  const s = scopedSnapshot(), old = targetScope(s, s.targets[1], at2130);
  expect(old).toBeTruthy();
  expect(targetScope({ ...s, periods: s.periods.map(p => ({ ...p, startsAt: p.startsAt - 1 })) }, s.targets[1], at2130)).not.toBe(old);
  expect(targetScope(s, { ...s.targets[1], selectionRef: 'different' }, at2130)).not.toBe(old);
  expect(targetScope(scopedSnapshot(true), scopedSnapshot(true).targets[1], at2205)).not.toBe(old);
});
test('next changes use only supplied native boundaries, never future saved weekly rules', () => {
  const s = scopedSnapshot();
  expect(nextScheduleChanges(s, at2130)).toEqual([
    { at: Date.parse('2026-11-19T22:00:00Z') / 1000, ruleID: ids.reading, kind: 'end' },
    { at: Date.parse('2026-11-19T22:00:00Z') / 1000, ruleID: ids.bed, kind: 'start' },
  ]);
  expect(nextScheduleChanges({ ...s, periods: [], nextPeriod: undefined }, at2130)).toEqual([]);
});
