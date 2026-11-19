import { createDirectProbeClient } from '../modules/itoma-native/src/direct-probe';
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const prepared = { phase: 'prepared', id, startsAt: 1000, endsAt: 2200, selectedCount: 1, storeCount: 0, observation: 'none', origin: 'none' };
const port = (result: unknown) => ({ apiVersion: 1, directShieldProbeVersion: 1, directShieldProbe: jest.fn(async () => JSON.stringify(result)) });
test('requires an opted-in matching native build and rejects invalid arm identity before calling native', async () => {
  const p = port({ status: 'ok', authorization: 'approved', snapshot: prepared });
  expect(createDirectProbeClient('web', () => p).available()).toBe(false);
  expect(createDirectProbeClient('ios', () => ({ ...p, directShieldProbeVersion: 0 })).available()).toBe(false);
  const client = createDirectProbeClient('ios', () => p);
  expect((await client.run('arm', 'invalid')).code).toBe('invalid'); expect(p.directShieldProbe).not.toHaveBeenCalled();
  expect((await client.run('arm', id)).snapshot?.phase).toBe('prepared');
  expect(p.directShieldProbe).toHaveBeenCalledWith('arm', id);
});
test('preserves unknown authorization and cancelled preparation without inventing OS success', async () => {
  const client = createDirectProbeClient('ios', () => port({ status: 'cancelled', authorization: 'unknown' }));
  expect(await client.run('pick')).toEqual({ status: 'cancelled', authorization: 'unknown' });
  const unknown = createDirectProbeClient('ios', () => port({ status: 'ok', authorization: 'unknown', snapshot: { ...prepared, phase: 'armed' } }));
  expect((await unknown.run('snapshot')).authorization).toBe('unknown');
  expect((await unknown.run('snapshot')).snapshot?.observation).toBe('none');
});
test('rejects malformed native timestamps, duration, target counts and raw error descriptions', async () => {
  for (const patch of [{ endsAt: 2201 }, { id: 'bad' }, { selectedCount: 2 }, { storeCount: -1 }, { startsAt: '1000' }, { observation: 'blocked' }]) {
    const client = createDirectProbeClient('ios', () => port({ status: 'ok', authorization: 'approved', snapshot: { ...prepared, ...patch } }));
    expect((await client.run('snapshot')).code).toBe('unavailable');
  }
  const p = port({ status: 'error', authorization: 'unknown', code: 'PRIVATE_ERROR_DESCRIPTION' });
  expect((await createDirectProbeClient('ios', () => p).run('stop')).code).toBe('unavailable');
});
