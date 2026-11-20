import test from 'node:test';
import assert from 'node:assert/strict';
import { datasets, cumulative, sumKnown, sampleCumulative, selectedDays, periodRows, weekStart, shiftAnchor } from '../app/src/scenarios/records.ts';
const normal = datasets.find(value => value.id === 'normal').days;
test('cumulative endpoints add to the same 4h13 total as the selected days', () => {
  assert.equal(sumKnown(normal), 253 * 60);
  assert.deepEqual(cumulative(normal).map(value => value.seconds), [3000, 7200, 7980, 12780, 15180]);
  assert.equal(sumKnown(selectedDays(normal, 'week', '2026-11-16')), 15180);
});
test('missing is distinct from zero and breaks a cumulative segment', () => {
  const gap = datasets.find(value => value.id === 'gap').days;
  assert.deepEqual(cumulative(gap).map(value => value.seconds), [3000, 7200, undefined, 12000, 14400]);
  assert.equal(sumKnown(gap), 14400);
  assert.equal(sumKnown([]), undefined);
  assert.equal(sumKnown(datasets.find(value => value.id === 'zero').days), 0);
  assert.equal(periodRows(gap, 'week', '2026-11-16')[2].seconds, undefined);
});
test('week/month navigation cannot change the global total and sampling retains the endpoint', () => {
  const records = datasets.find(value => value.id === 'long').days, before = JSON.stringify(records);
  const total = sumKnown(records), sample = sampleCumulative(records);
  assert.equal(total, 5113 * 60);
  assert(sample.length <= 32);
  assert.equal(sample.at(-1).seconds, total);
  assert.equal(sumKnown(selectedDays(records, 'month', '2026-11-01')), 753 * 60);
  assert.equal(sumKnown(selectedDays(records, 'week', '2026-11-16')), 253 * 60);
  assert.equal(JSON.stringify(records), before);
});
test('calendar labels stay on the correct Monday and cross months', () => {
  assert.equal(weekStart('2026-11-01'), '2026-10-26');
  assert.equal(weekStart('2026-11-16'), '2026-11-16');
  assert.equal(shiftAnchor('2026-11-16', 'week', -1), '2026-11-09');
  assert.equal(shiftAnchor('2026-01-01', 'month', -1), '2025-12-01');
});
