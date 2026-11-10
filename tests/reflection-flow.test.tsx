import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { useEffect, useState } from 'react';
import { Alert, AppState, Pressable, Text, type AppStateStatus } from 'react-native';
import { router } from 'expo-router';
import { createReflectionClient } from '../modules/itoma-native/src/reflection';
import type { ReflectionRequest, ReflectionSnapshot } from '../modules/itoma-native/src/reflection-model';
import type { HistoryAction, HistoryRequest, HistoryResponse, ScreenTimeAction, ScreenTimeResponse } from '../modules/itoma-native';
import { ReflectionScreen } from '../src/components/flow/reflection';
import { ProductHome } from '../src/components/flow/home';
import { SettingsScreen } from '../src/components/flow/settings';
import { HistoryScreen, HistoryReasonScreen } from '../src/components/flow/history';
import { ScreenTimeProvider } from '../src/state/screen-time';
import { HistoryProvider, useHistoryRecords } from '../src/state/history';
import { ReflectionProvider } from '../src/state/reflection';

jest.mock('../src/global.css', () => ({}));
jest.mock('../src/qa/native-smoke', () => ({ completeNativeHomeSmoke: jest.fn(), completeNativeHistorySmoke: jest.fn(), completeNativeReflectionSmoke: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { navigate: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn(), dismissTo: jest.fn() },
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
const fixtures = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/reflection-records.json'), 'utf8')) as Record<string, { request: ReflectionRequest; response: ReflectionSnapshot }[]>;
const commandID = '00000000-0000-0000-0000-000000000001';
const controlClient = { run: jest.fn(async (_action: ScreenTimeAction): Promise<ScreenTimeResponse> => ({ status: 'ok', impacts: [] })) };
const wrap = (snapshot: ReflectionSnapshot) => JSON.stringify({ status: 'ok', storage: 'ready', transfer: 'current', sharedIncomplete: false, snapshot });

function backend() {
  let scenario = 'observed', deleted = false;
  const native = jest.fn(async (action: string, payload: string) => {
    const request = JSON.parse(payload) as Partial<ReflectionRequest>;
    if (action === 'deleteAll') { scenario = 'deleted'; deleted = true; return wrap(fixtures.deleted[0].response); }
    const samples = fixtures[scenario], period = request.period ?? 'week';
    const found = samples.find(sample => sample.request.period === period
      && (!request.day || sample.request.day === request.day)
      && JSON.stringify(sample.request.clippedTo) === JSON.stringify(request.clippedTo));
    if (!found) throw new Error('query not exported by Swift');
    if (request.expectedToken && request.expectedToken !== found.response.token) {
      return JSON.stringify({ status: 'error', code: 'changed', storage: 'unknown', transfer: 'current' });
    }
    return wrap(found.response);
  });
  const client = createReflectionClient('ios', () => ({ apiVersion: 1, reflectionVersion: 1, reflection: native }));
  const historyClient = { run: jest.fn(async (action: HistoryAction, _request: HistoryRequest = {}): Promise<HistoryResponse> => {
    if (action === 'reason') return { status: 'ok', storage: 'ready', reason: { revision: deleted ? '1' : '0',
      state: deleted ? 'deleted' : 'shared-accepted', body: deleted ? undefined : 'fixture-private-body' } };
    return { status: 'ok', storage: 'ready', page: { revision: deleted ? '1' : '0',
      asOf: fixtures.observed[0].response.asOf + 1, timeZone: 'UTC', rows: deleted ? [] : [{
        key: commandID, commandID, at: fixtures.observed[0].response.asOf - 60,
        action: 'requestTemporaryGrant', status: 'succeeded', grantStatus: 'active',
      }], logicalBytes: '100', warningBytes: '1000', maximumBytes: '2000', warningReached: false, limitReached: false,
      incomplete: false, transfer: 'current' } };
  }) };
  return { client, historyClient, native };
}
function HeldReason() {
  const history = useHistoryRecords();
  return <><Text testID="held-private-reason">{history.reason?.body ?? 'no-private-body'}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="read a private detail" onPress={() => history.readReason(commandID)} /></>;
}
function Pages() {
  const [stack, setStack] = useState(['/reflection']);
  useEffect(() => {
    const navigate = (name: string) => setStack(previous => previous.includes(name) ? previous.slice(0, previous.indexOf(name) + 1) : [...previous, name]);
    jest.mocked(router.navigate).mockImplementation(navigate as never);
    jest.mocked(router.push).mockImplementation(navigate as never);
    jest.mocked(router.dismissTo).mockImplementation(navigate as never);
    jest.mocked(router.back).mockImplementation(() => setStack(previous => previous.slice(0, -1)));
  }, []);
  const current = stack.at(-1);
  return <>{current === '/' ? <ProductHome /> : current === '/settings' ? <SettingsScreen /> : current === '/history' ? <HistoryScreen /> : current === '/history-reason' ? <HistoryReasonScreen /> : <ReflectionScreen />}</>;
}
async function mount(b: ReturnType<typeof backend>) {
  return render(<ScreenTimeProvider client={controlClient}><HistoryProvider client={b.historyClient}>
    <ReflectionProvider client={b.client}><HeldReason /><Pages /></ReflectionProvider>
  </HistoryProvider></ScreenTimeProvider>);
}
const press = async (label: string) => fireEvent.press(screen.getByRole('button', { name: label }));
const observed = () => screen.findByText(/保存した状態の記録：1件/);
function deletionButton(alert: jest.SpyInstance) {
  const choices = alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  return choices.find(choice => choice.text === '全記録と累計を削除する')!;
}

beforeEach(() => jest.clearAllMocks());

test('normal route uses product DTOs, preserves fixed total/token and remembers month/clip through day history', async () => {
  const b = backend(); await mount(b); await observed();
  expect(screen.queryByText('検証用プレビュー')).toBeNull();
  expect(screen.getByTestId('reflection-total').props.children).toBe('—');
  await press('月次'); await screen.findByText('2026年11月');
  await press('次の期間'); await screen.findByText('2026年12月');
  const monthRow = screen.getAllByRole('button').find(node => String(node.props.accessibilityLabel).startsWith('12月1日、'))!;
  await fireEvent.press(monthRow);
  await screen.findByText('11月30日からの週');
  const day = screen.getAllByRole('button').find(node => String(node.props.accessibilityLabel).startsWith('12月2日、'))!;
  await fireEvent.press(day);
  await screen.findByText('あなたの選択の記録');
  expect(screen.getByDisplayValue('2026-12-02')).toBeTruthy();
  expect(screen.getByText(/振り返りとは別の時点/)).toBeTruthy();
  expect(b.historyClient.run).toHaveBeenCalledWith('page', expect.objectContaining({ day: '2026-12-02' }));
  expect(jest.mocked(router.navigate).mock.calls.every(call => call[0] === '/history')).toBe(true);
  await press('‹ 戻る'); await screen.findByText('11月30日からの週');
  await press('月次'); await screen.findByText('2026年12月');
  await press('週次'); await screen.findByLabelText('月内の週の記録：—');
  expect(JSON.parse(b.native.mock.calls.at(-1)![1]).clippedTo).toBeDefined();
  await press('月次'); await screen.findByText('2026年12月');
  expect(screen.getByTestId('reflection-total').props.children).toBe('—');
  expect(b.native.mock.calls.filter(call => call[0] === 'read').some(call => JSON.parse(call[1]).expectedToken)).toBe(true);
});

test('home/reflection tabs retain the selected month across remounts without issuing control mutations', async () => {
  const b = backend(); await mount(b); await observed();
  await press('月次'); await screen.findByText('2026年11月');
  await press('次の期間'); await screen.findByText('2026年12月');
  expect(screen.getByRole('tab', { name: '振り返り' })).toBeSelected();
  const initialReads = b.native.mock.calls.length;
  await fireEvent.press(screen.getByRole('tab', { name: '振り返り' }));
  expect(b.native.mock.calls).toHaveLength(initialReads);
  for (let n = 0; n < 10; n += 1) {
    await fireEvent.press(screen.getByRole('tab', { name: 'ホーム' }));
    expect(screen.getByRole('header', { name: 'いとま' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'ホーム' })).toBeSelected();
    await fireEvent.press(screen.getByRole('tab', { name: '振り返り' }));
    await screen.findByText('2026年12月');
    expect(screen.getByRole('button', { name: '月次' })).toBeSelected();
    expect(screen.getByTestId('reflection-total').props.children).toBe('—');
  }
  expect(controlClient.run.mock.calls.every(call => call[0] === 'snapshot')).toBe(true);
  expect(b.native.mock.calls.every(call => call[0] === 'read')).toBe(true);
});

test('all-record deletion is separately confirmed, serializes repeated approval and clears held private reason', async () => {
  const b = backend(), alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await mount(b); await observed();
  await press('read a private detail'); await screen.findByText('fixture-private-body');
  await press('全記録と累計を削除する');
  expect(alert).toHaveBeenCalledWith('全記録と累計を削除しますか', expect.stringContaining('ルールと現在の一時解除は変わりません'), expect.any(Array));
  expect(b.native.mock.calls.filter(call => call[0] === 'deleteAll')).toHaveLength(0);
  const approve = deletionButton(alert).onPress!;
  await act(async () => { approve(); approve(); });
  await waitFor(() => expect(screen.getAllByText('記録は削除されています').length).toBeGreaterThan(0));
  expect(b.native.mock.calls.filter(call => call[0] === 'deleteAll')).toHaveLength(1);
  expect(screen.queryByText('fixture-private-body')).toBeNull();
  expect(screen.getByTestId('held-private-reason').props.children).toBe('no-private-body');
  expect(screen.getByTestId('reflection-total').props.children).toBe('—');
  alert.mockRestore();
});

test('a delayed pre-deletion read cannot restore the old dataset or observation count', async () => {
  const b = backend(), alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  let finish!: (value: string) => void;
  b.native.mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
  await mount(b);
  await waitFor(() => expect(b.native).toHaveBeenCalled());
  await press('全記録と累計を削除する');
  await act(async () => deletionButton(alert).onPress!());
  await waitFor(() => expect(screen.getAllByText('記録は削除されています').length).toBeGreaterThan(0));
  await act(async () => finish(wrap(fixtures.observed[0].response)));
  expect(screen.queryByText(/保存した状態の記録：1件/)).toBeNull();
  expect(screen.getByTestId('reflection-total').props.children).toBe('—');
  alert.mockRestore();
});

test('navigation and foreground refresh retain one lifetime subscription per provider', async () => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  const originalSubscribe = jest.isMockFunction(AppState.addEventListener) ? jest.mocked(AppState.addEventListener).getMockImplementation() : undefined;
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, listener) => {
    listeners.add(listener);
    return { remove: () => { listeners.delete(listener); } };
  });
  const b = backend(), mounted = await mount(b); await observed();
  const initial = listeners.size;
  for (let n = 0; n < 10; n += 1) {
    await press('選択の記録を見る'); await screen.findByText('あなたの選択の記録');
    await press('‹ 戻る'); await observed();
  }
  await act(async () => { listeners.forEach(listener => listener('background')); });
  await act(async () => { listeners.forEach(listener => listener('active')); });
  await observed();
  expect(listeners.size).toBe(initial); expect(initial).toBe(3);
  await mounted.unmount(); expect(listeners.size).toBe(0);
  subscription.mockRestore();
  if (originalSubscribe) jest.mocked(AppState.addEventListener).mockImplementation(originalSubscribe);
});

test('shared gap is visible even when the private snapshot and outbox-empty sample are otherwise current', async () => {
  const b = backend();
  b.native.mockImplementation(async () => JSON.stringify({ status: 'ok', storage: 'ready', transfer: 'current',
    sharedIncomplete: true, snapshot: fixtures.observed[0].response }));
  await mount(b); await observed();
  expect(screen.getByText(/新しい状態の記録に欠落の可能性/)).toBeTruthy();
  expect(screen.getByTestId('reflection-total').props.children).toBe('—');
});

test('settings/history are reachable through the tab while the selected reflection month survives', async () => {
  const b = backend(); await mount(b); await observed();
  await press('月次'); await screen.findByText('2026年11月');
  await press('次の期間'); await screen.findByText('2026年12月');
  await fireEvent.press(screen.getByRole('tab', { name: 'ホーム' }));
  expect(screen.queryByRole('button', { name: '選択の記録を見る' })).toBeNull();
  await fireEvent.press(screen.getByRole('tab', { name: '設定' }));
  expect(screen.getByRole('header', { name: 'ルールと設定' })).toBeTruthy();
  await press('選択の記録を見る'); await screen.findByText('あなたの選択の記録');
  await press('‹ 戻る');
  expect(screen.getByRole('tab', { name: '設定' })).toBeSelected();
  await fireEvent.press(screen.getByRole('tab', { name: '振り返り' }));
  await screen.findByText('2026年12月');
  expect(b.native.mock.calls.every(call => call[0] === 'read')).toBe(true);
});
