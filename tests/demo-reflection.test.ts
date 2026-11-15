import { createReflectionFixture } from '../src/demo/reflection-fixture';
import { createDemoSession } from '../src/demo/session';
import samples from '../src/demo/fixtures/reflection.json';
import { parseReflectionPrototypeSnapshot, parseReflectionSnapshot } from '../modules/itoma-native/src/reflection-model';

test('all demo aggregates are bounded synthetic DTOs; native parsing still rejects them', () => {
  const totals = new Set<number | undefined>();
  for (const entry of samples.entries) {
    const value = parseReflectionPrototypeSnapshot(JSON.stringify(entry.response));
    expect(value.proofScope).toBe('syntheticFixture');
    expect(value.buckets.length).toBeLessThanOrEqual(value.period === 'week' ? 7 : 6);
    expect(value.trend.length).toBeLessThanOrEqual(64);
    totals.add(value.total.knownSeconds);
    expect(() => parseReflectionSnapshot(JSON.stringify(entry.response))).toThrow();
  }
  expect([...totals]).toEqual([219000]);
});
test('every month bar drills into its exact clipped week and keeps total fixed', () => {
  const source = createReflectionFixture();
  for (const day of ['2026-10-01', '2026-11-01']) {
    const month = source.read({ period: 'month', day }).snapshot!;
    for (const bucket of month.buckets) {
      const week = source.read({ period: 'week', day: bucket.day, clippedTo: { from: bucket.from, until: bucket.until }, expectedToken: month.token }).snapshot!;
      expect(week.selected).toEqual(bucket);
      expect(week.total).toEqual(month.total);
      expect(week.buckets.every(b => b.from >= bucket.from && b.until <= bucket.until)).toBe(true);
    }
  }
  const week = source.read({ period: 'week', day: '2026-11-09' }).snapshot!;
  expect(week.buckets.find(b => b.day === '2026-11-11')).toMatchObject({ knownSeconds: 0, coverage: 'recorded' });
  expect(week.buckets.find(b => b.day === '2026-11-12')?.knownSeconds).toBeUndefined();
  expect(week.total.coverage).toBe('partial');
});
test('reason/history deletion preserves sample totals; deleting all hides every period and import cannot resurrect it', async () => {
  const session = createDemoSession({ reflectionSample: true, historySample: true });
  const first = (await session.clients.reflection.run('read')).snapshot!;
  await session.clients.history.run('deleteReasons'); await session.clients.history.run('deleteHistory');
  expect((await session.clients.reflection.run('read')).snapshot?.total).toEqual(first.total);
  await session.clients.reflection.run('deleteAll'); await session.clients.reflection.run('import');
  for (const period of ['week', 'month'] as const) {
    const current = (await session.clients.reflection.run('read', { period, day: '' })).snapshot!;
    expect(current.total.knownSeconds).toBeUndefined(); expect(current.total.coverage).toBe('deleted');
    expect(current.buckets.every(b => b.knownSeconds === undefined && b.coverage === 'deleted')).toBe(true);
  }
  expect((await session.clients.reflection.run('read', { expectedToken: first.token })).code).toBe('changed');
});
