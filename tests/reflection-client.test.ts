import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createReflectionClient, parseReflectionResponse } from '../modules/itoma-native/src/reflection';
import { parseReflectionSnapshot } from '../modules/itoma-native/src/reflection-model';

const fixtures = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/reflection-records.json'), 'utf8'));
const observed = () => structuredClone(fixtures.observed[0].response);
const ok = (snapshot = observed()) => JSON.stringify({ status: 'ok', storage: 'ready', transfer: 'current', snapshot });

test('all SQLite-generated point projections use the product metric and never imply even known zero', () => {
  for (const entries of Object.values(fixtures) as { response: unknown }[][]) for (const entry of entries) {
    const value = parseReflectionSnapshot(JSON.stringify(entry.response));
    expect(value.metricVersion).toBe('restricted-excluding-unlocks-v1');
    expect(value.proofScope).toBe('pointObservations');
    expect([value.total, value.selected, ...value.buckets, ...value.trend].every(b => b.knownSeconds === undefined)).toBe(true);
  }
  const value = observed(); value.reason = 'fixture-private-reason'; value.applicationToken = 'fixture-native-token';
  value.total.body = 'fixture-private-reason';
  const result = JSON.stringify(parseReflectionResponse(ok(value)));
  expect(result).not.toContain('fixture-private-reason'); expect(result).not.toContain('fixture-native-token');
});

test('point zero/positive injection is rejected in cumulative, period, buckets and trend', () => {
  for (const seconds of [0, 1]) for (const field of ['total', 'selected', 'buckets', 'trend']) {
    const value = observed();
    const bucket = field === 'buckets' || field === 'trend' ? value[field][0] : value[field];
    bucket.knownSeconds = seconds;
    expect(() => parseReflectionResponse(ok(value))).toThrow();
  }
});

test('prototype scope, metric and token cannot enter a production response', () => {
  for (const patch of [
    { proofScope: 'syntheticFixture' }, { metricVersion: 'restricted-excluding-unlocks-prototype-v1' }, { token: 'prototype-v1:fixture' },
  ]) expect(() => parseReflectionResponse(ok({ ...observed(), ...patch }))).toThrow();
  expect(() => parseReflectionResponse(JSON.stringify({ status: 'ok', storage: 'ready', transfer: 'current' }))).toThrow();
  expect(() => parseReflectionResponse(ok({ ...observed(), observationCount: 0.5 }))).toThrow();
});

test('an older native build, unsupported platform and thrown provider do not become an empty success', async () => {
  const native = jest.fn(async () => ok()), load = jest.fn(() => ({ apiVersion: 1, reflection: native }));
  const old = await createReflectionClient('ios', load).run('read');
  expect(old.status).toBe('error'); expect(old.storage).toBe('unknown'); expect(native).not.toHaveBeenCalled();
  await createReflectionClient('web', load).run('read'); expect(load).toHaveBeenCalledTimes(1);
  expect((await createReflectionClient('ios', () => { throw new Error('fixture-private-error'); }).run('read')).code).toBe('unavailable');
});

test('bridge sends only query fields and strips extra native identities and reason text', async () => {
  const native = jest.fn(async (_action: string, _payload: string) => ok());
  const client = createReflectionClient('ios', () => ({ apiVersion: 1, reflectionVersion: 1, reflection: native }));
  await client.run('read', { period: 'week', day: '', expectedToken: observed().token,
    clippedTo: { from: 1, until: 2, body: 'fixture-private-reason' }, reason: 'fixture-private-reason', applicationToken: 'fixture-native-token' } as never);
  const payload = JSON.parse(native.mock.calls[0][1]);
  expect(payload.day).toBeUndefined();
  expect(payload.clippedTo).toEqual({ from: 1, until: 2 });
  expect(JSON.stringify(payload)).not.toMatch(/fixture-private-reason|fixture-native-token/);
});

test('not-created, deleted and capacity failure stay distinct through the real client', async () => {
  const native = jest.fn(async () => JSON.stringify({ status: 'ok', storage: 'not-created', transfer: 'unavailable' }));
  const client = createReflectionClient('ios', () => ({ apiVersion: 1, reflectionVersion: 1, reflection: native }));
  expect((await client.run('read')).storage).toBe('not-created');
  native.mockResolvedValueOnce(ok(fixtures.deleted[0].response));
  expect((await client.run('read')).snapshot?.total.coverage).toBe('deleted');
  native.mockResolvedValueOnce(JSON.stringify({ status: 'error', code: 'capacity-full', storage: 'unknown', transfer: 'pending' }));
  expect((await client.run('import')).code).toBe('capacity-full');
  native.mockResolvedValueOnce('{broken');
  expect((await client.run('read')).status).toBe('error');
});
