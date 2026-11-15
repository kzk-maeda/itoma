import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { Alert, AppState, type AppStateStatus, Text, Pressable } from 'react-native';
import { HistoryProvider, useHistoryRecords } from '../src/state/history';
import { ScreenTimeProvider, useScreenTime } from '../src/state/screen-time';
import { RecordStorageScreen, RecordDeletionScreen } from '../src/components/flow/settings-records';
import { HistoryScreen, HistoryReasonScreen } from '../src/components/flow/history';
import { unavailableSnapshot } from '../modules/itoma-native/src/screen-time';
import type { HistoryAction, HistoryRequest, HistoryResponse, HistoryPage, ScreenTimeAction, ScreenTimeResponse } from '../modules/itoma-native';

const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', nextID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const body = '【架空の理由】\n確認したい情報がひとつあります。';
let mockRoutes = ['/history'], mockNavigate: (route: string) => void = () => {};
jest.mock('expo-router', () => ({ router: { navigate: (route: string) => { const index = mockRoutes.indexOf(route); mockRoutes = index < 0 ? [...mockRoutes, route] : mockRoutes.slice(0, index + 1); mockNavigate(route); }, push: (route: string) => { mockRoutes.push(route); mockNavigate(route); }, canGoBack: () => mockRoutes.length > 1,
  back: () => { mockRoutes.pop(); mockNavigate(mockRoutes.at(-1) ?? '/history'); }, replace: (route: string) => mockNavigate(route) },
  useIsFocused: () => true, useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('../modules/itoma-native', () => ({ screenTime: { run: jest.fn() }, historyRecords: { run: jest.fn() } }));
jest.mock('../src/qa/native-smoke', () => ({ completeNativeHistorySmoke: jest.fn() }));
jest.mock('../src/state/reflection', () => ({ useReflection: () => ({ busy: false, mutate: jest.fn() }) }));
jest.mock('../src/global.css', () => ({}));
const sample = (): HistoryPage => ({ revision: '1', asOf: 1794265200, timeZone: 'Asia/Tokyo',
  rows: [{ key: id, at: 1794265100, action: 'requestTemporaryGrant', status: 'uncertain', commandID: id, grantStatus: 'uncertain', expiresAt: 1794265400 }],
  next: { key: id, at: 1794265100 }, logicalBytes: '120', warningBytes: '100', maximumBytes: '1000', warningReached: true, limitReached: false,
  databaseBytes: '4096', walBytes: '100', sharedMemoryBytes: '500', incomplete: true, transfer: 'pending' });
function backend() {
  let deleted = false, revision = 1;
  const page = (request: HistoryRequest = {}): HistoryPage => ({ ...sample(), revision: String(revision),
    ...(request.direction === 'older' ? { rows: [{ key: nextID, at: 1794200000, action: 'cancelled', status: 'cancelled' }], previous: { key: nextID, at: 1794200000 }, next: undefined } : {}),
    ...(request.kind === 'reason' ? { rows: [{ key: id, at: 1794265100, action: 'reason', status: 'prepared', commandID: id, reasonDeleted: deleted }] } : {}) });
  const run = jest.fn(async (action: HistoryAction, request: HistoryRequest = {}): Promise<HistoryResponse> => {
    if (action === 'reason') return { status: 'ok', storage: 'ready', reason: { revision: String(revision), state: deleted ? 'deleted' : 'prepared-only', body: deleted ? undefined : body } };
    if (action === 'deleteReasons' || action === 'deleteHistory') { deleted = true; revision += 1; }
    return { status: 'ok', storage: 'ready', page: page(request) };
  });
  return { run, page, externalDelete: () => { deleted = true; revision += 1; } };
}
function Pages() {
  const [route, setRoute] = useState('/history');
  useEffect(() => { mockNavigate = setRoute; return () => { mockNavigate = () => {}; }; }, []);
  return route === '/history-reason' ? <HistoryReasonScreen /> : route === '/settings-storage' ? <RecordStorageScreen /> : route === '/settings-delete' ? <RecordDeletionScreen /> : <HistoryScreen />;
}
function Probe() {
  const h = useHistoryRecords(), s = useScreenTime();
  return <><Text>{h.reason?.body ?? 'no body'}</Text><Text>{h.page?.rows[0]?.reasonDeleted ? 'deleted row' : 'no tombstone'}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="read private" onPress={() => h.readReason(id)} />
    <Pressable accessibilityRole="button" accessibilityLabel="delete through settings" onPress={() => { void s.run('deleteReasons'); }} />
    <Pressable accessibilityRole="button" accessibilityLabel="read list" onPress={h.refresh} />
    <Pressable accessibilityRole="button" accessibilityLabel="delete private" onPress={() => h.mutate('deleteReasons')} /></>;
}
function wrap(b: ReturnType<typeof backend>, child: React.ReactNode = <Pages />) {
  const native = { run: jest.fn(async (action: ScreenTimeAction): Promise<ScreenTimeResponse> => {
    if (action === 'deleteReasons') b.externalDelete();
    return { status: 'ok', impacts: [], snapshot: unavailableSnapshot('simulator') };
  }) };
  return <ScreenTimeProvider client={native}><HistoryProvider client={b}>{child}</HistoryProvider></ScreenTimeProvider>;
}
const press = async (name: string) => {
  if (name === '記録の保存状況を確認する' && !screen.queryByRole('button', { name })) await fireEvent.press(screen.getByRole('button', { name: '記録について・保存状況' }));
  await fireEvent.press(screen.getByRole('button', { name }));
};
beforeEach(() => { mockRoutes = ['/history']; });
afterEach(() => jest.restoreAllMocks());

test('private reason is fetched only after selection, shown in full, and never enters navigation', async () => {
  const b = backend(); await render(wrap(b));
  expect(screen.getByText('反映は未確認')).toBeTruthy();
  expect(b.run.mock.calls.some(([action]) => action === 'reason')).toBe(false);
  await fireEvent.press(screen.getByTestId(`history-choice-${id}`));
  expect(screen.getByText(body)).toBeTruthy();
  expect(screen.getByText('理由の保存だけを確認しました。一時解除の受付記録はありません。')).toBeTruthy();
  expect(mockRoutes).toEqual(['/history', '/history-reason']);
  await press('記録の一覧へ戻る');
  expect(screen.queryByText(body)).toBeNull();
});
test('continuation retains prior cards, calendar day and pinned revision', async () => {
  const b = backend(); await render(wrap(b));
  await press('今日');
  const requestedDay = b.run.mock.calls.at(-1)![1]!.day;
  await press('過去の記録を読み込む');
  expect(screen.getByTestId(`history-choice-${nextID}`)).toBeTruthy();
  expect(screen.getByTestId(`history-choice-${id}`)).toBeTruthy();
  expect(b.run).toHaveBeenLastCalledWith('page', expect.objectContaining({ day: requestedDay, afterKey: id, direction: 'older', revision: '1', timeZone: 'Asia/Tokyo' }));
  expect(screen.getByText('日付で絞り込み中')).toBeTruthy();
});
test('deletion needs explicit confirmation, keeps policy operations separate, and shows tombstones', async () => {
  const b = backend(), alert = jest.spyOn(Alert, 'alert'); await render(wrap(b));
  await press('保存した理由'); await press('記録の保存状況を確認する'); await press('記録を削除する'); await press('理由本文のみの削除を確認');
  expect(b.run.mock.calls.some(([action]) => action === 'deleteReasons')).toBe(false);
  await act(async () => { alert.mock.calls.at(-1)?.[2]?.[1].onPress?.(); });
  expect(screen.getByText('理由本文の削除を確認しました。')).toBeTruthy();
  await press('‹ 戻る'); await press('‹ 戻る');
  expect(screen.getByText(/理由は削除済み/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'この記録の理由を読む' })).toBeNull();
  expect(b.run.mock.calls.every(([action]) => ['page', 'deleteReasons'].includes(action))).toBe(true);
});
test('capacity and incomplete imports are distinct from file usage and OS success', async () => {
  const b = backend(); await render(wrap(b));
  await press('記録の保存状況を確認する');
  expect(screen.getByText('保存内容：< 0.01 MB / 上限 < 0.01 MB')).toBeTruthy();
  expect(screen.getByText('関連ファイル合計（観測値）：< 0.01 MB')).toBeTruthy();
  expect(screen.getByText('記録の一部が欠けている可能性があります')).toBeTruthy();
  expect(screen.getByRole('button', { name: '新しい記録を取り込む' })).toBeEnabled();
  expect(screen.queryByText(/OS.*成功/)).toBeNull();
});
test('unavailable storage never appears as an empty successful history', async () => {
  const b = backend(); b.run.mockResolvedValue({ status: 'error', storage: 'unknown', code: 'storage-failed' });
  await render(wrap(b));
  expect(screen.getByText(/記録を読み取れませんでした/)).toBeTruthy();
  expect(screen.queryByText('まだ保存された記録がありません')).toBeNull();
});
test('an older reason response cannot resurrect text after settings deletion', async () => {
  const b = backend(); let resolve!: (r: HistoryResponse) => void;
  b.run.mockImplementation(async (action) => action === 'reason' ? new Promise((r) => { resolve = r; }) : { status: 'ok', storage: 'ready', page: b.page() });
  await render(wrap(b, <Probe />));
  await press('read private'); await press('delete through settings');
  await act(async () => { resolve({ status: 'ok', storage: 'ready', reason: { revision: '1', state: 'prepared-only', body } }); });
  expect(screen.queryByText(body)).toBeNull();
  expect(screen.getByText('no body')).toBeTruthy();
});
test('late pre-deletion list responses cannot replace the post-deletion page', async () => {
  const b = backend(); let resolve!: (r: HistoryResponse) => void;
  b.run.mockImplementation(async (action) => action === 'page' ? new Promise((r) => { resolve = r; })
    : { status: 'ok', storage: 'ready', page: { ...b.page({ kind: 'reason' }), rows: [{ key: id, at: 1, action: 'reason', status: 'prepared', commandID: id, reasonDeleted: true }] } });
  await render(wrap(b, <Probe />)); await press('read list'); await press('delete private');
  expect(screen.getByText('deleted row')).toBeTruthy();
  await act(async () => { resolve({ status: 'ok', storage: 'ready', page: b.page() }); });
  expect(screen.getByText('deleted row')).toBeTruthy();
});


test('storage and deletion navigation reuse earlier routes instead of growing a loop of screens', async () => {
  const b = backend(); await render(wrap(b));
  await press('記録の保存状況を確認する');
  for (let n = 0; n < 12; n++) {
    await press('記録を削除する');
    expect(mockRoutes).toEqual(['/history', '/settings-storage', '/settings-delete']);
    await press('保存状況を確認する');
    expect(mockRoutes).toEqual(['/history', '/settings-storage']);
  }
  await press('‹ 戻る'); expect(screen.getByRole('header', { name: 'あなたの選択の記録' })).toBeTruthy();
});

test('a deletion response failure remains unknown instead of claiming completion', async () => {
  const b = backend(), original = b.run.getMockImplementation()!, alert = jest.spyOn(Alert, 'alert');
  b.run.mockImplementation((action, request) => action === 'deleteReasons'
    ? Promise.resolve({ status: 'error', code: 'storage-failed', storage: 'unknown' }) : original(action, request));
  await render(wrap(b));
  await press('記録の保存状況を確認する'); await press('記録を削除する'); await press('理由本文のみの削除を確認');
  await act(async () => { alert.mock.calls.at(-1)?.[2]?.[1].onPress?.(); });
  expect(screen.getByText('削除結果を確認できません。保存状況を確認してから、必要なら再試行できます。')).toBeTruthy();
  expect(screen.queryByText('理由本文の削除を確認しました。')).toBeNull();
});

test('one grouped unlock keeps one card and reason entry as its saved status changes', async () => {
  const b = backend();
  let status: 'pending' | 'succeeded' = 'pending';
  b.run.mockImplementation(async (action) => action === 'reason'
    ? { status: 'ok', storage: 'ready', reason: { revision: '2', state: 'shared-accepted', body } }
    : { status: 'ok', storage: 'ready', page: { ...b.page(), grouping: 'command', next: undefined, rows: [{
      key: id, commandID: id, at: 1794265100, updatedAt: status === 'pending' ? 1794265100 : 1794265102,
      action: 'requestTemporaryGrant', status, grantStatus: status === 'pending' ? 'pending' : 'active',
    }] } });
  await render(wrap(b));
  expect(screen.getAllByTestId(`history-choice-${id}`)).toHaveLength(1);
  expect(screen.getByText('受付済み')).toBeTruthy();
  status = 'succeeded';
  await press('最新の記録を確認する');
  expect(screen.getAllByTestId(`history-choice-${id}`)).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: /一時解除を選びました.*詳細を見る/ })).toHaveLength(1);
  expect(screen.queryByText('受付済み')).toBeNull();
  expect(screen.getByText('解除の反映を記録')).toBeTruthy();
  await fireEvent.press(screen.getByTestId(`history-choice-${id}`));
  expect(screen.getByText(body)).toBeTruthy();
});

test('cancelled record opens details without fetching a private reason or inventing a target', async () => {
  const b = backend();
  b.run.mockResolvedValue({ status: 'ok', storage: 'ready', page: { ...sample(), next: undefined, incomplete: false, transfer: 'current', rows: [{ key: id, at: 1794265100, action: 'cancelled', status: 'cancelled' }] } });
  await render(wrap(b));
  await fireEvent.press(screen.getByTestId(`history-choice-${id}`));
  expect(screen.getByRole('header', { name: '選択の詳細' })).toBeTruthy();
  expect(screen.getByText('確定前に取り消した本文は保存していません。')).toBeTruthy();
  expect(screen.getByText(/当時のアプリ名・ルール名・希望時間は、この記録に含まれていません/)).toBeTruthy();
  expect(b.run.mock.calls.some(([action]) => action === 'reason')).toBe(false);
});

function FeedProbe() {
  const h = useHistoryRecords(), s = useScreenTime();
  useEffect(h.ensureLoaded, [h.ensureLoaded]);
  return <>
    {h.rows.map(row => <Text key={row.key}>{row.key}</Text>)}
    <Text>{h.loadingOlder ? 'loading older' : 'idle older'}</Text><Text>{h.olderError ?? h.error ?? 'no error'}</Text><Text>{h.next ? 'more' : 'end'}</Text>
    <Text>{h.selectedRow?.key ?? 'no selection'}</Text><Text>{h.reason?.body ?? 'no reason'}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="older twice" onPress={() => { void h.loadOlder(); void h.loadOlder(); }} />
    <Pressable accessibilityRole="button" accessibilityLabel="retry older" onPress={() => { void h.loadOlder(true); }} />
    <Pressable accessibilityRole="button" accessibilityLabel="other day" onPress={() => h.choose('event', '2026-11-01')} />
    <Pressable accessibilityRole="button" accessibilityLabel="open older" onPress={() => h.openRecord(h.rows.at(-1)!)} />
    <Pressable accessibilityRole="button" accessibilityLabel="open older twice" onPress={() => { h.openRecord(h.rows.at(-1)!); h.openRecord(h.rows.at(-1)!); }} />
    <Pressable accessibilityRole="button" accessibilityLabel="delete external" onPress={() => { void s.run('deleteReasons'); }} />
    <Pressable accessibilityRole="button" accessibilityLabel="start over" onPress={h.restart} />
    <Pressable accessibilityRole="button" accessibilityLabel="pause continuation" onPress={h.pauseOlder} />
    <Pressable accessibilityRole="button" accessibilityLabel="open copied row" onPress={() => h.openRecord({ ...h.rows[0] })} />
  </>;
}
function pagedBackend() {
  const b = backend();
  const head = { ...sample(), incomplete: false, transfer: 'current' as const };
  const tail = { ...head, next: undefined, rows: [{ key: nextID, at: 1794200000, action: 'requestTemporaryGrant' as const, status: 'succeeded' as const, commandID: nextID }] };
  b.run.mockImplementation(async (action, request) => action === 'reason'
    ? { status: 'ok', storage: 'ready', reason: { revision: '1', state: 'shared-accepted', body } }
    : { status: 'ok', storage: 'ready', page: request?.afterKey ? tail : head });
  return { b, head, tail };
}
test('continuation requests one cursor at a time, retains earlier metadata, and reads only the opened older reason', async () => {
  const { b, head, tail } = pagedBackend();
  let resolve!: (value: HistoryResponse) => void;
  const original = b.run.getMockImplementation()!;
  b.run.mockImplementation((action, request) => request?.afterKey ? new Promise(r => { resolve = r; }) : original(action, request));
  await render(wrap(b, <FeedProbe />));
  await press('older twice');
  expect(b.run.mock.calls.filter(([, request]) => request?.afterKey)).toHaveLength(1);
  expect(b.run.mock.calls.at(-1)?.[1]).toMatchObject({ afterAt: head.next!.at, afterKey: head.next!.key, direction: 'older', revision: head.revision, timeZone: head.timeZone });
  expect(screen.getByText('loading older')).toBeTruthy();
  await act(async () => resolve({ status: 'ok', storage: 'ready', page: tail }));
  expect(screen.getByText(id)).toBeTruthy(); expect(screen.getByText(nextID)).toBeTruthy();
  expect(screen.getByText('end')).toBeTruthy();
  expect(b.run.mock.calls.some(([action]) => action === 'reason')).toBe(false);
  await press('open older');
  expect(screen.getByText(body)).toBeTruthy();
  expect(b.run.mock.calls.at(-1)?.[1]?.commandID).toBe(nextID);
});
test('continuation failure retains records, does not automatically retry, and explicit retry reaches the end', async () => {
  const { b, tail } = pagedBackend(), original = b.run.getMockImplementation()!;
  b.run.mockImplementation((action, request) => request?.afterKey ? Promise.resolve({ status: 'error', storage: 'ready', code: 'storage-failed' }) : original(action, request));
  await render(wrap(b, <FeedProbe />)); await press('older twice');
  expect(screen.getByText(id)).toBeTruthy(); expect(screen.getByText('storage-failed')).toBeTruthy();
  const reads = b.run.mock.calls.length; await press('older twice'); expect(b.run.mock.calls.length).toBe(reads);
  b.run.mockImplementation((action, request) => request?.afterKey ? Promise.resolve({ status: 'ok', storage: 'ready', page: tail }) : original(action, request));
  await press('retry older'); expect(screen.getByText(nextID)).toBeTruthy();
  const completed = b.run.mock.calls.length; await press('older twice'); expect(b.run.mock.calls.length).toBe(completed);
});
test.each(['other day', 'delete external', 'start over'])('a late continuation cannot restore previous records after %s', async action => {
  const { b, head, tail } = pagedBackend(); let resolve!: (value: HistoryResponse) => void;
  const cleared = { ...head, rows: [], next: undefined, revision: '2' };
  b.run.mockImplementation(async (_action, request) => request?.afterKey ? new Promise(r => { resolve = r; }) : { status: 'ok', storage: 'ready', page: head });
  await render(wrap(b, <FeedProbe />)); await press('older twice');
  b.run.mockResolvedValue({ status: 'ok', storage: 'ready', page: cleared });
  await press(action);
  await act(async () => resolve({ status: 'ok', storage: 'ready', page: tail }));
  expect(screen.queryByText(id)).toBeNull(); expect(screen.queryByText(nextID)).toBeNull();
  expect(screen.getByText('end')).toBeTruthy();
});
test.each(['changed', 'changed page', 'repeated cursor'])('continuation stops safely for %s instead of looping or mixing versions', async mode => {
  const { b, head, tail } = pagedBackend(), original = b.run.getMockImplementation()!;
  b.run.mockImplementation((action, request) => request?.afterKey ? Promise.resolve(mode === 'changed'
    ? { status: 'error', storage: 'ready', code: 'changed' }
    : { status: 'ok', storage: 'ready', page: mode === 'changed page' ? { ...tail, revision: '2' } : { ...tail, next: head.next } }) : original(action, request));
  await render(wrap(b, <FeedProbe />)); await press('older twice');
  expect(screen.getByText(mode !== 'repeated cursor' ? 'changed' : 'unavailable')).toBeTruthy();
  if (mode !== 'repeated cursor') expect(screen.queryByText(id)).toBeNull();
  else expect(screen.getByText(id)).toBeTruthy();
  expect(screen.queryByText(nextID)).toBeNull();
  const reads = b.run.mock.calls.length; await press('older twice'); expect(b.run.mock.calls.length).toBe(reads);
});


test('a paused continuation cannot append while a detail screen is open', async () => {
  const { b, tail } = pagedBackend(), original = b.run.getMockImplementation()!;
  let resolve!: (value: HistoryResponse) => void;
  b.run.mockImplementation((action, request) => request?.afterKey ? new Promise(r => { resolve = r; }) : original(action, request));
  await render(wrap(b, <FeedProbe />)); await press('older twice'); await press('pause continuation');
  await act(async () => resolve({ status: 'ok', storage: 'ready', page: tail }));
  expect(screen.queryByText(nextID)).toBeNull();
  expect(screen.getByText('idle older')).toBeTruthy();
});

test.each(['wrong zone', 'forward cursor', 'empty advancing page'])('continuation rejects %s without showing a false end or starting an automatic retry loop', async mode => {
  const { b, head, tail } = pagedBackend(), original = b.run.getMockImplementation()!;
  const page = mode === 'wrong zone' ? { ...tail, timeZone: 'UTC' }
    : mode === 'forward cursor' ? { ...tail, next: { key: nextID, at: head.next!.at + 1 } }
      : { ...tail, rows: [], next: { key: nextID, at: head.next!.at - 1 } };
  b.run.mockImplementation((action, request) => request?.afterKey ? Promise.resolve({ status: 'ok', storage: 'ready', page }) : original(action, request));
  await render(wrap(b, <FeedProbe />)); await press('older twice');
  expect(screen.getByText(mode === 'wrong zone' ? 'changed' : 'unavailable')).toBeTruthy();
  if (mode !== 'wrong zone') expect(screen.getByText('more')).toBeTruthy();
  const reads = b.run.mock.calls.length; await press('older twice'); expect(b.run.mock.calls.length).toBe(reads);
});

test('native grouping keeps separate source rows with the same command ID and deduplicates only repeated row keys', async () => {
  const { b, head, tail } = pagedBackend(), original = b.run.getMockImplementation()!;
  b.run.mockImplementation((action, request) => request?.afterKey ? Promise.resolve({ status: 'ok', storage: 'ready', page: { ...tail,
    grouping: 'command', rows: [head.rows[0], { ...tail.rows[0], commandID: id }] } }) : original(action, request));
  await render(wrap(b, <FeedProbe />)); await press('older twice');
  expect(screen.getAllByText(id)).toHaveLength(1); expect(screen.getByText(nextID)).toBeTruthy();
  expect(screen.getByText('end')).toBeTruthy();
});

test('only a row object owned by the current generation can fetch a private reason', async () => {
  const { b } = pagedBackend(); await render(wrap(b, <FeedProbe />));
  await press('open copied row');
  expect(screen.getByText('no selection')).toBeTruthy();
  expect(b.run.mock.calls.some(([action]) => action === 'reason')).toBe(false);
  await press('open older'); expect(screen.getByText(body)).toBeTruthy();
});

test('background discards a pending older page and foreground revalidates the first page', async () => {
  const changes: ((state: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((name, listener) => {
    if (name === 'change') changes.push(listener); return { remove: jest.fn() };
  });
  const { b, tail } = pagedBackend(), original = b.run.getMockImplementation()!;
  let resolve!: (value: HistoryResponse) => void;
  b.run.mockImplementation((action, request) => request?.afterKey ? new Promise(r => { resolve = r; }) : original(action, request));
  await render(wrap(b, <FeedProbe />)); await press('older twice');
  await act(async () => changes.forEach(change => change('background')));
  await act(async () => resolve({ status: 'ok', storage: 'ready', page: tail }));
  expect(screen.queryByText(nextID)).toBeNull();
  const reads = b.run.mock.calls.length;
  await act(async () => changes.forEach(change => change('active')));
  expect(b.run.mock.calls.length).toBeGreaterThan(reads);
  expect(b.run.mock.calls.at(-1)?.[1]?.afterKey).toBeUndefined();
});

test('the calendar replaces date input and keeps a civil-day filter through kind changes and clear', async () => {
  const b = backend(); await render(wrap(b)); await press('今日'); await press('前の日');
  const day = b.run.mock.calls.at(-1)![1]!.day!;
  await press('日付を選ぶ');
  expect(screen.getByRole('button', { name: '日付を選ばず閉じる' })).toBeTruthy();
  expect(screen.getAllByRole('button').filter(x => String(x.props.accessibilityLabel ?? '').match(/^\d+年\d+月\d+日$/)).length).toBeGreaterThan(27);
  await press('日付を選ばず閉じる'); await press('保存した理由');
  expect(b.run.mock.calls.at(-1)![1]).toMatchObject({ kind: 'reason', day });
  await press('絞り込みを解除');
  expect(b.run.mock.calls.at(-1)![1]).toMatchObject({ kind: 'reason', day: undefined });
  expect(screen.queryByText('日付で絞り込み中')).toBeNull();
});

test('three real cursor pages retain 40+40+12 metadata rows and stop at the reported end', async () => {
  const b = backend();
  const rows = Array.from({ length: 92 }, (_, n) => ({ key: `00000000-0000-0000-0000-${String(n + 1).padStart(12, '0')}`, at: 1794265200 - n * 60,
    action: 'cancelled' as const, status: 'cancelled' as const }));
  b.run.mockImplementation(async (_action, request = {}) => {
    const start = request.afterKey ? rows.findIndex(row => row.key === request.afterKey) + 1 : 0, chunk = rows.slice(start, start + 40);
    return { status: 'ok', storage: 'ready', page: { ...sample(), rows: chunk, grouping: 'command', next: start + 40 < rows.length ? { key: chunk.at(-1)!.key, at: chunk.at(-1)!.at } : undefined } };
  });
  await render(wrap(b, <FeedProbe />)); await press('older twice'); await press('older twice');
  for (const row of rows) expect(screen.getByText(row.key)).toBeTruthy();
  expect(screen.getByText('end')).toBeTruthy(); expect(b.run.mock.calls).toHaveLength(3);
  await press('older twice'); expect(b.run.mock.calls).toHaveLength(3);
});

test('switching the native client drops old metadata and a late continuation from the old source', async () => {
  const { b, tail } = pagedBackend(), original = b.run.getMockImplementation()!;
  let resolve!: (value: HistoryResponse) => void;
  b.run.mockImplementation((action, request) => request?.afterKey ? new Promise(r => { resolve = r; }) : original(action, request));
  const mounted = await render(wrap(b, <FeedProbe />)); await press('older twice');
  const replacement = backend(), replacementID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  replacement.run.mockResolvedValue({ status: 'ok', storage: 'ready', page: { ...sample(), next: undefined,
    rows: [{ key: replacementID, at: 1794265000, action: 'cancelled', status: 'cancelled' }] } });
  await mounted.rerender(wrap(replacement, <FeedProbe />));
  await act(async () => resolve({ status: 'ok', storage: 'ready', page: tail }));
  expect(screen.queryByText(id)).toBeNull(); expect(screen.queryByText(nextID)).toBeNull();
  expect(screen.getByText(replacementID)).toBeTruthy();
});


test('rapid repeated selection opens one detail and reads the private reason once', async () => {
  const { b } = pagedBackend(); await render(wrap(b, <FeedProbe />));
  await press('open older twice');
  expect(b.run.mock.calls.filter(([action]) => action === 'reason')).toHaveLength(1);
  expect(screen.getByText(body)).toBeTruthy();
});
