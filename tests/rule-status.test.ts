import { currentRulePeriods, currentRuleTargets, savedDaySchedule, targetScope, unlockCandidates } from '../src/components/home/rule-status';
import { unavailableSnapshot, type ScreenTimeSnapshot } from '../modules/itoma-native/src/screen-time';
import { appIDs, createMultiRuleDemo, rules } from '../src/demo/multi-rule/fixture';
const now = new Date(2026, 10, 19, 21, 30).getTime();
const rule = { id: 'r', selectionRef: 's', weekdays: [4], startMinute: 1200, endMinute: 1380, nextDay: false, enabled: true };
const base = (): ScreenTimeSnapshot => ({ ...unavailableSnapshot('device'), storage: 'ready', authorization: 'approved', schedulesReady: true, observation: 'applied',
  validUntil: now / 1000 + 60, rules: [rule], periods: [{ ruleID: rule.id, startsAt: now / 1000 - 60, endsAt: now / 1000 + 60 }],
  targets: [{ ref: 'app', selectionRef: 's', ruleID: 'r', restricted: true, unlockable: true }] });
test('only a fresh, current, restricted and eligible target is selectable; saved or future targets are excluded', () => {
  const s = base();
  s.targets.push({ ...s.targets[0], ref: 'future', ruleID: 'other' }, { ...s.targets[0], ref: 'not-restricted', restricted: false },
    { ...s.targets[0], ref: 'blocked', unlockable: false }, { ...s.targets[0], ref: 'pending', grantCommandID: 'command' }, s.targets[0]);
  expect(unlockCandidates(s, now).map(t => t.ref)).toEqual(['app']);
  expect(currentRuleTargets(s, now).filter(t => t.ref === 'app')).toHaveLength(1);
});
test.each([
  { observation: 'uncertain' }, { observation: 'applying' }, { validUntil: now / 1000 }, { authorization: 'denied' },
  { activation: 'paused' }, { schedulesReady: false }, { availability: 'simulator' },
] as Partial<ScreenTimeSnapshot>[])('uncertain or unavailable state is never an unlock candidate: %j', patch => {
  expect(unlockCandidates({ ...base(), ...patch }, now)).toEqual([]);
});
test('start is inclusive, end is exclusive and disabled rules never become candidates', () => {
  const s = base(), p = s.periods[0];
  expect(currentRulePeriods(s, p.startsAt * 1000)).toHaveLength(1);
  expect(unlockCandidates(s, p.endsAt * 1000)).toEqual([]);
  s.rules = [{ ...rule, enabled: false }]; expect(unlockCandidates(s, now)).toEqual([]);
});
test('scope changes when the same app changes winner or occurrence', () => {
  const s = base(), original = targetScope(s, s.targets[0], now);
  const next = { ...s, periods: [{ ...s.periods[0], startsAt: now / 1000 - 30 }] };
  expect(targetScope(next, next.targets[0], now)).not.toBe(original);
});
test('saved calendar includes yesterday overnight and today future separately, omitting disabled rules', () => {
  const at = new Date(2026, 10, 19, 0, 30).getTime();
  const overnight = { ...rule, weekdays: [3, 4], startMinute: 1320, endMinute: 420, nextDay: true };
  const rows = savedDaySchedule([overnight, { ...rule, id: 'disabled', enabled: false }], at);
  expect(rows).toHaveLength(2); expect(rows.map(row => row.status)).toEqual(['current', 'upcoming']);
  expect(new Date(rows[0].startsAt * 1000).getDate()).toBe(18);
});
test('fictional overlap and switch expose the correct candidate set without unrelated TikTok/YouTube', async () => {
  jest.useFakeTimers(); jest.setSystemTime(now);
  try {
    const demo = createMultiRuleDemo();
    const overlap = (await demo.client.run('snapshot')).snapshot!;
    expect(unlockCandidates(overlap, demo.now()).map(t => t.ref)).toEqual([appIDs.x, appIDs.instagram, appIDs.youtube]);
    expect(overlap.targets.find(t => t.ref === appIDs.x)?.ruleID).toBe(rules[2].id);
    demo.select('switch');
    const switched = (await demo.client.run('snapshot')).snapshot!;
    expect(unlockCandidates(switched, demo.now()).map(t => t.ref)).toEqual([appIDs.x, appIDs.instagram, appIDs.tiktok]);
    expect(switched.targets.find(t => t.ref === appIDs.x)?.ruleID).toBe(rules[3].id);
  } finally { jest.useRealTimers(); }
});
test('fictional grant applies only to the selected app, keeps its deadline and excludes it from selection', async () => {
  jest.useFakeTimers(); jest.setSystemTime(now);
  try {
    const demo = createMultiRuleDemo();
    const review = await demo.client.run('previewUnlock', { targetRef: appIDs.x, reason: '架空の目的', minutes: 5 });
    const result = await demo.client.run('unlock', { ref: review.ref, reason: '架空の目的' });
    expect(result.status).toBe('ok');
    expect(result.snapshot!.targets.find(t => t.ref === appIDs.x)?.grantEndsAt).toBe(review.previewEndsAt);
    expect(unlockCandidates(result.snapshot, demo.now()).map(t => t.ref)).toEqual([appIDs.instagram, appIDs.youtube]);
    demo.select('outside');
    expect(unlockCandidates((await demo.client.run('snapshot')).snapshot, demo.now())).toEqual([]);
  } finally { jest.useRealTimers(); }
});
