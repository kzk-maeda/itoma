import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const hook = registerHooks({ resolve(specifier, context, next) { return next(['./records', './time-growth'].includes(specifier) ? specifier + '.ts' : specifier, context); } });
const { timeLayers, foldMessage, nextLayerStep, withAddedTime } = await import('../app/src/scenarios/time-layers.ts');
const { HOUR, DAY, MONTH, YEAR, growthScenes, growthDays } = await import('../app/src/scenarios/time-growth.ts');
const { sumKnown } = await import('../app/src/scenarios/records.ts');
hook.deregister();
test('layers and bundles conserve all seconds, including partial layers and drawing bounds', () => {
  for (const seconds of [0, 1, HOUR - 1, HOUR, DAY - 1, DAY, DAY + 1, MONTH - 1, MONTH, YEAR - 1, YEAR, 438 * DAY + 6 * HOUR + 13 * 60]) {
    const model = timeLayers(seconds);
    assert.equal(model.items.reduce((sum, item) => sum + item.seconds, 0), seconds);
    assert.equal(model.groups.reduce((sum, group) => sum + group.count * group.seconds, 0) + model.remainder, seconds);
    assert(model.items.every(item => item.top >= 38 - 1e-8 && item.bottom <= 170 && item.bottom > item.top));
  }
  assert.deepEqual(timeLayers(undefined).items, []);
});
test('a layer really becomes a bundle at the exact day, month, and year boundaries', () => {
  assert.equal(timeLayers(DAY - 1).groups.find(value => value.key === 'hour').count, 23);
  assert.deepEqual(timeLayers(DAY).groups.map(value => [value.key, value.count]), [['day', 1]]);
  assert.deepEqual(timeLayers(MONTH).groups.map(value => [value.key, value.count]), [['month', 1]]);
  assert.deepEqual(timeLayers(YEAR).groups.map(value => [value.key, value.count]), [['year', 1]]);
  assert.deepEqual(timeLayers(360 * DAY).groups.map(value => [value.key, value.count]), [['month', 12]]);
  assert.deepEqual(timeLayers(438 * DAY).groups.map(value => [value.key, value.count]), [['year', 1], ['month', 2], ['day', 13]]);
});
test('only forward carries announce bundling; 365 days is not rounded from twelve months', () => {
  assert.match(foldMessage(DAY - 1, DAY), /24時間/);
  assert.match(foldMessage(MONTH - 1, MONTH), /30日/);
  assert.match(foldMessage(YEAR - 1, YEAR), /365日/);
  assert.equal(foldMessage(HOUR, 2 * HOUR), undefined);
  assert.equal(foldMessage(DAY, DAY - 1), undefined);
  assert.equal(foldMessage(359 * DAY, 360 * DAY)?.includes('1年'), false);
});
test('adding and undoing updates the same synthetic ledger without changing unknown to zero', () => {
  for (const scene of growthScenes) {
    const steps = [HOUR, DAY], added = withAddedTime(scene, steps);
    assert.equal(sumKnown(growthDays(added)), scene.seconds === undefined ? undefined : scene.seconds + HOUR + DAY);
    assert.equal(withAddedTime(scene, []).seconds, scene.seconds);
    assert.equal(withAddedTime(scene, steps.slice(0, -1)).seconds, scene.seconds === undefined ? undefined : scene.seconds + HOUR);
    if (scene.seconds !== undefined) assert.equal(added.after, undefined);
  }
  assert.equal(nextLayerStep(MONTH - 1), HOUR);
  assert.equal(nextLayerStep(MONTH), DAY);
});
