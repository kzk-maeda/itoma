import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const hook = registerHooks({ resolve(specifier, context, next) { return next(specifier === './records' ? './records.ts' : specifier, context); } });
const { HOUR, DAY, MONTH, YEAR, growthReadout, durationWords, growthDays, growthScenes, growthMilestones } = await import('../app/src/scenarios/time-growth.ts');
hook.deregister();
const { sumKnown } = await import('../app/src/scenarios/records.ts');
test('unit changes at the exact second without rounding up early', () => {
  for (const [boundary, below, at] of [[DAY, 'hours', 'days'], [MONTH, 'days', 'months'], [YEAR, 'months', 'years']]) {
    assert.equal(growthReadout(boundary - 1).kind, below);
    assert.equal(growthReadout(boundary).kind, at);
    assert.equal(growthReadout(boundary).remainder, 0);
    assert.equal(growthReadout(boundary + 1).remainder, 1);
  }
  assert.equal(growthReadout(360 * DAY).kind, 'months');
  assert.equal(growthReadout(360 * DAY).whole, 12);
});
test('larger units and remainder conserve every second; rings show remainder, not lifetime total', () => {
  for (const value of [0, 253 * 60, DAY - 1, DAY, 30 * HOUR, MONTH + 600, YEAR - 1, YEAR + 600, 438 * DAY, 50 * YEAR + 123]) {
    const result = growthReadout(value);
    assert.equal(result.whole * result.size + result.remainder, value);
    assert(result.ringValue >= 0 && result.ringValue < result.ringSize);
    assert.equal(result.ringValue, result.kind === 'hours' ? value : result.remainder);
  }
  assert.equal(durationWords(73 * DAY + 6 * HOUR + 13 * 60 + 1), '73日6時間13分1秒');
  assert.equal(growthReadout(undefined), undefined);
  assert.equal(growthReadout(0).whole, 0);
  assert.equal(growthReadout(MONTH).approximate, true);
  assert.equal(growthReadout(DAY).approximate, false);
});
test('all demo histories reconcile to the displayed sum; unknown is not zero', () => {
  for (const scene of growthScenes) {
    const records = growthDays(scene);
    assert.equal(sumKnown(records), scene.seconds, scene.id);
    assert(records.every(value => value.seconds === undefined || value.seconds >= 0 && value.seconds <= 4 * HOUR));
    assert(records.every(value => value.day <= '2026-11-20'));
    assert(records.every((value, index) => index === 0 || value.day > records[index - 1].day));
  }
  assert.equal(growthDays(growthScenes.find(value => value.id === 'partial'))[0].seconds, undefined);
  assert.equal(growthDays(growthScenes.find(value => value.id === 'zero'))[0].seconds, 0);
});
test('milestones appear only once actually accumulated, with known-coverage wording', () => {
  assert.deepEqual(growthMilestones([{ day: '2026-11-19', seconds: DAY - 1 }]).map(value => value.label), ['1時間分']);
  assert.deepEqual(growthMilestones([{ day: '2026-11-19' }, { day: '2026-11-20', seconds: DAY }]), [{ label: '1時間分', day: '2026-11-20', partial: true }, { label: '1日分', day: '2026-11-20', partial: true }]);
  const marks = growthMilestones(growthDays(growthScenes.find(value => value.id === 'years')));
  assert.equal(marks.length, 4);
  assert.equal(marks.at(-1).label, '約1年分');
  assert.deepEqual(growthMilestones([]), []);
});
