import { createScreenTimePoCClient } from '../modules/itoma-native/src/screen-time-poc';

const ref = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const snapshot = {
  availability: 'device-poc', authorization: 'approved', storage: 'ready', operation: 'saved', code: null,
  observation: 'unknown', selections: [{ ref, applicationCount: 2, confirmedThisSession: true }],
};

test('non-iOS, missing module and old bridge do not call Screen Time', async () => {
  const load = jest.fn(() => null);
  expect(await createScreenTimePoCClient('web', load).run('authorize')).toEqual({ status: 'error', code: 'unsupported-platform' });
  expect(load).not.toHaveBeenCalled();
  expect(await createScreenTimePoCClient('ios', load).run('snapshot')).toEqual({ status: 'error', code: 'module-missing' });
  expect(await createScreenTimePoCClient('ios', () => ({ apiVersion: 1 })).run('snapshot')).toEqual({ status: 'error', code: 'incompatible-module' });
});

test('only typed display fields cross the client, and selection references are passed unchanged', async () => {
  const method = jest.fn(async () => JSON.stringify({ ...snapshot, token: 'must-not-cross', selections: [{ ...snapshot.selections[0], rawToken: 'private' }] }));
  const result = await createScreenTimePoCClient('ios', () => ({ apiVersion: 1, screenTimePoC: method })).run('apply', ref);
  expect(method).toHaveBeenCalledWith('apply', ref);
  expect(result).toEqual({ status: 'snapshot', snapshot });
  expect(JSON.stringify(result)).not.toContain('private');
});

test('malformed, duplicate or unsafe result fields are errors rather than inferred success', async () => {
  for (const value of [null, { ...snapshot, authorization: 'allowed' }, { ...snapshot, observation: 'blocked' },
    ...['availability', 'authorization', 'storage', 'operation', 'observation'].map((key) => ({ ...snapshot, [key]: [snapshot[key as keyof typeof snapshot]] })),
    { ...snapshot, code: 'raw native error' }, { ...snapshot, selections: [...snapshot.selections, ...snapshot.selections] },
    ...[NaN, -1, 1.5, '2'].map((applicationCount) => ({ ...snapshot, selections: [{ ...snapshot.selections[0], applicationCount }] })),
    { ...snapshot, selections: [{ ...snapshot.selections[0], ref: 'raw-token' }] }]) {
    const client = createScreenTimePoCClient('ios', () => ({ apiVersion: 1, screenTimePoC: async () => JSON.stringify(value) }));
    expect(await client.run('snapshot')).toEqual({ status: 'error', code: 'invalid-response' });
  }
});

test('denial, cancellation, storage errors and own-store uncertainty remain distinct', async () => {
  for (const changes of [{ authorization: 'denied' }, { operation: 'cancelled' },
    { storage: 'unavailable', operation: 'failed', code: 'storage-failure' }, { observation: 'uncertain' }]) {
    const value = { ...snapshot, ...changes };
    const client = createScreenTimePoCClient('ios', () => ({ apiVersion: 1, screenTimePoC: async () => JSON.stringify(value) }));
    expect(await client.run('snapshot')).toEqual({ status: 'snapshot', snapshot: value });
  }
});

test('native rejection never exposes raw errors or turns a stop into success', async () => {
  const client = createScreenTimePoCClient('ios', () => ({ apiVersion: 1, screenTimePoC: async () => { throw new Error('private/path/token'); } }));
  expect(await client.run('stop')).toEqual({ status: 'error', code: 'native-error' });
});

test('unencoded objects and broken JSON cannot masquerade as a typed snapshot', async () => {
  for (const wire of [snapshot, '{broken', 'null', '[]', '"approved"']) {
    const client = createScreenTimePoCClient('ios', () => ({ apiVersion: 1, screenTimePoC: async () => wire }));
    expect(await client.run('snapshot')).toEqual({ status: 'error', code: 'invalid-response' });
  }
});


test('saved review forwards only the opaque selection reference and filters private identity fields', async () => {
  const method = jest.fn(async () => JSON.stringify({ ...snapshot, appName: 'private-name', token: 'private-token' }));
  const client = createScreenTimePoCClient('ios', () => ({ apiVersion: 1, screenTimePoC: method }));
  const result = await client.run('review-and-apply', ref);
  expect(method).toHaveBeenCalledWith('review-and-apply', ref);
  expect(result).toEqual({ status: 'snapshot', snapshot });
  expect(JSON.stringify(result)).not.toContain('private-');
});
