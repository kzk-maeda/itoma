import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
// Node's TS stripping needs explicit extensions; Metro resolves this import itself.
const hook = registerHooks({ resolve(specifier, context, next) { return next(specifier === './records' ? './records.ts' : specifier, context); } });
const { timeBlocks, weekContributions, calendarCells, dayBands, clockTime } = await import('../app/src/scenarios/visual-options.ts');
hook.deregister();
const { datasets, sumKnown } = await import('../app/src/scenarios/records.ts');
const multi = datasets.find(value => value.id === 'multiweek').days;
test('block volume preserves exact totals and declares a bounded scale for large totals', () => {
  for (const total of [0, 60, 253 * 60, 5113 * 60, 90000 * 3600]) {
    const { unit, blocks } = timeBlocks(total);
    assert(blocks.length <= 12);
    assert.equal(blocks.reduce((sum, value) => sum + value, 0), total);
    assert(blocks.every(value => value > 0 && value <= unit));
  }
  assert.deepEqual(timeBlocks(253 * 60), { unit: 3600, blocks: [3600, 3600, 3600, 3600, 13 * 60] });
  assert.equal(timeBlocks(5113 * 60).unit, 10 * 3600);
});
test('week segments conserve the cumulative total and retain unknown coverage', () => {
  const weeks = weekContributions(multi);
  assert.deepEqual(weeks.map(value => value.seconds), [25 * 60, 45 * 60, 183 * 60]);
  assert.equal(weeks.reduce((sum, value) => sum + value.seconds, 0), sumKnown(multi));
  assert.equal(weekContributions(datasets.find(value => value.id === 'gap').days)[0].partial, true);
  assert.equal(weekContributions([{ day: '2026-11-16' }])[0].seconds, undefined);
});
test('calendar lays out Monday columns without inventing out-of-month records', () => {
  const november = calendarCells('month', '2026-11-20');
  assert.equal(november.length, 42);
  assert.equal(november[6], '2026-11-01');
  assert.equal(november[35], '2026-11-30');
  assert.equal(november.filter(Boolean).length, 30);
  assert.equal(calendarCells('month', '2028-02-01').filter(Boolean).length, 29);
  assert.deepEqual(calendarCells('week', '2026-11-01'), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
});
test('synthetic timeline excludes unlocks, partitions 24h, and preserves zero versus unknown', () => {
  for (const dataset of datasets) for (const record of dataset.days) {
    const bands = dayBands(record);
    assert.equal(bands[0].from, 0); assert.equal(bands.at(-1).until, 1440);
    for (const [index, band] of bands.entries()) {
      assert(band.until > band.from);
      if (index) assert.equal(bands[index - 1].until, band.from);
    }
    if (record.seconds !== undefined) {
      assert.equal(bands.filter(value => value.kind === 'restricted').reduce((sum, band) => sum + (band.until - band.from) * 60, 0), record.seconds);
      assert.equal(bands.filter(value => value.kind === 'unlock').reduce((sum, band) => sum + band.until - band.from, 0), record.seconds ? 10 : 0);
    }
  }
  assert.equal(dayBands()[0].kind, 'unknown');
  assert.equal(dayBands({ day: '2026-11-20', seconds: 0 })[0].kind, 'none');
  assert.equal(clockTime(59.5), '01:00'); assert.equal(clockTime(1440), '24:00');
});
