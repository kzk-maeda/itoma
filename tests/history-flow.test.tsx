import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { Alert, Text, Pressable } from 'react-native';
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
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
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
const press = async (name: string) => { await fireEvent.press(screen.getByRole('button', { name })); };
beforeEach(() => { mockRoutes = ['/history']; });
afterEach(() => jest.restoreAllMocks());

test('private reason is fetched only after selection, shown in full, and never enters navigation', async () => {
  const b = backend(); await render(wrap(b));
  expect(screen.getByText('記録時の状態：反映を確認できません')).toBeTruthy();
  expect(b.run.mock.calls.some(([action]) => action === 'reason')).toBe(false);
  await press('この記録の理由を読む');
  expect(screen.getByText(body)).toBeTruthy();
  expect(screen.getByText('理由の保存だけを確認しました。一時解除の受付記録はありません。')).toBeTruthy();
  expect(mockRoutes).toEqual(['/history', '/history-reason']);
  await press('記録の一覧へ戻る');
  expect(screen.queryByText(body)).toBeNull();
});
test('pagination replaces one page, retains date selection and sends the pinned revision', async () => {
  const b = backend(); await render(wrap(b));
  await fireEvent.changeText(screen.getByLabelText('日付で絞り込む（YYYY-MM-DD・空欄はすべて）'), '2026-11-09');
  await press('この日付の記録を見る'); await press('前の40件へ');
  expect(screen.getByText('確定前の取消')).toBeTruthy();
  expect(screen.queryByText('一時解除の要求')).toBeNull();
  expect(b.run).toHaveBeenLastCalledWith('page', expect.objectContaining({ day: '2026-11-09', afterKey: id, direction: 'older', revision: '1', timeZone: 'Asia/Tokyo' }));
  await press('新しい40件へ');
  expect(screen.getByLabelText('日付で絞り込む（YYYY-MM-DD・空欄はすべて）')).toHaveDisplayValue('2026-11-09');
});
test('deletion needs explicit confirmation, keeps policy operations separate, and shows tombstones', async () => {
  const b = backend(), alert = jest.spyOn(Alert, 'alert'); await render(wrap(b));
  await press('保存した理由'); await press('記録の保存状況を確認する'); await press('記録を削除する'); await press('理由本文のみの削除を確認');
  expect(b.run.mock.calls.some(([action]) => action === 'deleteReasons')).toBe(false);
  await act(async () => { alert.mock.calls.at(-1)?.[2]?.[1].onPress?.(); });
  expect(screen.getByText('理由本文の削除を確認しました。')).toBeTruthy();
  await press('‹ 戻る'); await press('‹ 戻る');
  expect(screen.getByText('理由本文は削除済みです')).toBeTruthy();
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
  expect(screen.getByText(/保存した記録を読み取れません/)).toBeTruthy();
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
