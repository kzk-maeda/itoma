import { createHistoryClient, parseHistoryResponse, type HistoryPage } from '../modules/itoma-native/src/history';
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const page: HistoryPage = { revision: '12', asOf: 100, timeZone: 'Asia/Tokyo', rows: [{ key: id, at: 90, action: 'reason', status: 'prepared', commandID: id, reasonDeleted: false }],
  logicalBytes: '10', warningBytes: '80', maximumBytes: '100', warningReached: false, limitReached: false, databaseBytes: '4096', walBytes: '100', sharedMemoryBytes: '500', incomplete: false, transfer: 'current' };
test('history is versioned independently and unavailable builds never call the native port', async () => {
  const history = jest.fn();
  for (const [platform, version] of [['web', 1], ['ios', 0]] as const) {
    expect(await createHistoryClient(platform, () => ({ apiVersion: 1, historyVersion: version, history })).run('page')).toEqual({ status: 'error', code: 'unavailable', storage: 'unknown' });
  }
  expect(history).not.toHaveBeenCalled();
});
test('private reasons and tokens cannot be smuggled into list rows by native extras', () => {
  const result = parseHistoryResponse(JSON.stringify({ status: 'ok', storage: 'ready', page: { ...page, token: 'not allowed', rows: [{ ...page.rows[0], body: 'private extra', bundleIdentifier: 'not allowed' }] } }));
  expect(result.page).toEqual(page);
  expect(JSON.stringify(result)).not.toContain('private extra');
});
test.each([
  { ...page, rows: Array(41).fill(page.rows[0]) }, { ...page, revision: '1.2' },
  { ...page, rows: [{ ...page.rows[0], status: 'success-guaranteed' }] },
  { ...page, next: { at: '100', key: id } },
])('malformed or unbounded native pages fail closed', (invalid) => {
  expect(() => parseHistoryResponse(JSON.stringify({ status: 'ok', storage: 'ready', page: invalid }))).toThrow();
});
test('deleted or missing reason bodies are suppressed even if a faulty native response includes them', () => {
  for (const state of ['deleted', 'missing']) {
    expect(parseHistoryResponse(JSON.stringify({ status: 'ok', storage: 'ready', reason: { revision: '2', state, body: 'should never display' } })).reason?.body).toBeUndefined();
  }
});
test('only the selected reference and query go to native, with no reason text in the request', async () => {
  const history = jest.fn(async () => JSON.stringify({ status: 'ok', storage: 'ready', page }));
  const result = await createHistoryClient('ios', () => ({ apiVersion: 1, historyVersion: 1, history })).run('page', { kind: 'reason', day: '2026-11-09' });
  expect(history).toHaveBeenCalledWith('page', JSON.stringify({ kind: 'reason', day: '2026-11-09' }));
  expect(result.page?.rows).toHaveLength(1);
});
