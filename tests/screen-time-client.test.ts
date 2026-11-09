import { createScreenTimeClient, parseScreenTimeResponse, unavailableSnapshot } from '../modules/itoma-native/src/screen-time';
const ref = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const snapshot = { ...unavailableSnapshot('device'), storage: 'ready', authorization: 'approved',
  targets: [{ ref, selectionRef: ref, restricted: false, unlockable: false, grantEndsAt: 1800000123 }],
  unexpectedToken: 'must-not-cross' };

test('unsupported and stale builds do not execute commands or invent a device observation', async () => {
  const screenTime = jest.fn();
  for (const [platform, port] of [['web', { apiVersion: 1, screenTimeVersion: 1, screenTime }], ['ios', { apiVersion: 1, screenTime }]] as const) {
    const result = await createScreenTimeClient(platform, () => port).run('unlock', { reason: 'fixture' });
    expect(result.status).toBe('error'); expect(result.snapshot?.observation).toBe('unknown');
  }
  expect(screenTime).not.toHaveBeenCalled();
});
test('confirmed input uses the native command boundary and fixed expiry survives subsequent snapshots', async () => {
  const native = jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok', snapshot }));
  const client = createScreenTimeClient('ios', () => ({ apiVersion: 1, screenTimeVersion: 1, screenTime: native }));
  const result = await client.run('unlock', { ref, reason: 'synthetic confirmed reason' });
  expect(native).toHaveBeenCalledWith('unlock', JSON.stringify({ ref, reason: 'synthetic confirmed reason' }));
  expect(result.snapshot).not.toHaveProperty('unexpectedToken');
  expect((await client.run('snapshot')).snapshot?.targets[0].grantEndsAt).toBe(1800000123);
});
test('unknown results, malformed native values and thrown errors stay unknown without exposing details', async () => {
  for (const body of [JSON.stringify({ status: 'blocked-success' }), JSON.stringify({ status: 'ok', snapshot: { ...snapshot, validUntil: 'tomorrow' } }),
    JSON.stringify({ status: 'error', code: 'raw-token-or-private-text' }), '{']) {
    const result = await createScreenTimeClient('ios', () => ({ apiVersion: 1, screenTimeVersion: 1, screenTime: async () => body })).run('snapshot');
    expect(result).toEqual({ status: 'error', code: 'unavailable', impacts: [] });
  }
  const failed = await createScreenTimeClient('ios', () => { throw new Error('private native failure'); }).run('snapshot');
  expect(JSON.stringify(failed)).not.toContain('private');
  expect(() => parseScreenTimeResponse(JSON.stringify({ status: 'ok', snapshot: { ...snapshot, rules: [{ id: 'bad' }] } }))).toThrow();
});
