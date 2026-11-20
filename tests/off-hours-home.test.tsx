import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { useEffect } from 'react';
import { ScreenTimeProvider, useScreenTime } from '../src/state/screen-time';
import { ProductHome } from '../src/components/flow/home';
import { offHoursNow, offHoursSnapshot } from './fixtures/off-hours';
import { ids, scopedBackend } from './fixtures/scoped-rules';
import type { ScreenTimeResponse } from '../modules/itoma-native';

jest.mock('../src/global.css', () => ({}));
jest.mock('../modules/itoma-native', () => ({ screenTime: { run: jest.fn() } }));
jest.mock('../src/qa/native-smoke', () => ({ completeNativeHomeSmoke: jest.fn() }));
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({ router: { navigate: (...args: unknown[]) => mockNavigate(...args) }, useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }));
jest.mock('../src/components/flow/applications', () => ({ Applications: ({ selectionRef, targetRef, count }: { selectionRef: string; targetRef?: string; count?: number }) => {
  const React = require('react'), { Text } = require('react-native');
  return React.createElement(Text, { testID: 'saved-next-selection' }, `${selectionRef}|${targetRef ?? 'all'}|${count}`);
} }));
let state: ReturnType<typeof useScreenTime>;
function Capture() { const value = useScreenTime(); useEffect(() => { state = value; }, [value]); return null; }
async function mount(b = scopedBackend()) { b.replace(offHoursSnapshot()); await render(<ScreenTimeProvider client={b.client}><Capture /><ProductHome /></ScreenTimeProvider>); return b; }
beforeEach(() => { jest.useFakeTimers({ doNotFake: ['queueMicrotask'] }); jest.setSystemTime(offHoursNow); mockNavigate.mockClear(); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
test('the next start is shown once, native saved selection is used, and off-hours exposes no unlock entry', async () => {
  await mount();
  expect(screen.getByTestId('off-hours-circle')).toBeTruthy(); expect(screen.getByText('今日 21:00')).toBeTruthy();
  expect(screen.getByText('23:00に終了')).toBeTruthy(); expect(screen.getByTestId('saved-next-selection')).toHaveTextContent(`${ids.selection}|all|4`);
  expect(screen.getByText('夜の余白を、自分のために使う')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '一時解除する' })).toBeNull(); expect(screen.queryByText(/次の切替/)).toBeNull();
});
test('confirmed no-next retains a circle and a real schedule-list destination without repeating the headline', async () => {
  const b = await mount(); b.replace({ nextPeriod: undefined, rules: b.current().rules.map(r => ({ ...r, enabled: false })) }); await act(async () => state.refresh());
  expect(screen.getAllByText('次の予定なし')).toHaveLength(1); expect(screen.getByText('制限時間外')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'ルールを確認する' })); expect(mockNavigate).toHaveBeenCalledWith('/settings-schedules');
});
test.each(['paused', 'unknown', 'busy', 'first-run', 'error'] as const)('%s does not become off-hours', async condition => {
  const b = await mount(), original = b.client.run.getMockImplementation()!;
  if (condition === 'busy') {
    b.client.run.mockImplementation((a, r) => a === 'stop' ? new Promise<ScreenTimeResponse>(() => {}) : original(a, r));
    await act(async () => { void state.run('stop'); });
  } else if (condition === 'error') {
    b.client.run.mockImplementation(async () => ({ status: 'error', code: 'storage-failed', impacts: [] })); await act(async () => state.refresh());
  } else { b.replace(condition === 'paused' ? { activation: 'paused' } : condition === 'unknown' ? { observation: 'unknown' } : { rules: [], selections: [], nextPeriod: undefined }); await act(async () => state.refresh()); }
  expect(screen.queryByTestId('off-hours-circle')).toBeNull(); expect(screen.queryByText('次の予定なし')).toBeNull();
});
test('the start boundary rereads native, hides the past start and does not infer successful restriction from the timer', async () => {
  const b = await mount(), original = b.client.run.getMockImplementation()!; let finish!: (r: ScreenTimeResponse) => void;
  const period = b.current().nextPeriod!;
  b.replace({ validUntil: period.startsAt }); await act(async () => state.refresh());
  b.client.run.mockImplementation((a, r) => a === 'snapshot' ? new Promise(resolve => { finish = resolve; }) : original(a, r));
  await act(async () => { jest.setSystemTime(period.startsAt * 1000 - 1000); await jest.advanceTimersByTimeAsync(1000); });
  expect(screen.queryByText('今日 21:00')).toBeNull(); expect(screen.queryByRole('button', { name: '一時解除する' })).toBeNull();
  b.replace({ sequence: '2', evaluatedAt: Date.now() / 1000, validUntil: Date.now() / 1000 + 120, periods: [period], nextPeriod: undefined,
    targets: [{ ref: ids.instagram, selectionRef: ids.selection, ruleID: ids.night, restricted: true, unlockable: true }] });
  await act(async () => finish({ status: 'ok', impacts: [], snapshot: b.current() }));
  expect(screen.queryByTestId('off-hours-circle')).toBeNull(); expect(screen.getByRole('button', { name: '一時解除する' })).toBeTruthy();
});
test('a zone/offset change drains a pooled old read and waits for a new native read before presenting its next card', async () => {
  const b = await mount(), original = b.client.run.getMockImplementation()!, old = b.current(); let finish!: (r: ScreenTimeResponse) => void;
  b.client.run.mockImplementation((a, r) => a === 'snapshot' ? new Promise(resolve => { finish = resolve; }) : original(a, r));
  await act(async () => { void state.refresh(); });
  jest.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(90);
  await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
  expect(screen.queryByTestId('off-hours-circle')).toBeNull(); expect(screen.getByText('次の予定を確認しています')).toBeTruthy();
  await act(async () => finish({ status: 'ok', impacts: [], snapshot: old }));
  expect(screen.queryByTestId('off-hours-circle')).toBeNull(); // The pooled response cannot confirm the new zone.
  b.replace({ sequence: '2', nextPeriod: { ruleID: ids.reading, startsAt: Date.parse('2026-11-21T07:00:00Z') / 1000, endsAt: Date.parse('2026-11-21T08:00:00Z') / 1000 } });
  await act(async () => finish({ status: 'ok', impacts: [], snapshot: b.current() }));
  expect(screen.getByText('明日 07:00')).toBeTruthy(); expect(screen.getByRole('header', { name: '読書' })).toBeTruthy();
});
test('a failed time-context read stays unconfirmed and recovers after a normal poll, using only one screen clock', async () => {
  const interval = jest.spyOn(global, 'setInterval'), b = await mount(), original = b.client.run.getMockImplementation()!;
  let fail = true;
  jest.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(90);
  b.client.run.mockImplementation((a, r) => a === 'snapshot' && fail ? Promise.resolve({ status: 'error', code: 'unavailable', impacts: [] }) : original(a, r));
  await act(async () => { await jest.advanceTimersByTimeAsync(1000); }); expect(screen.queryByTestId('off-hours-circle')).toBeNull();
  fail = false; await act(async () => { await jest.advanceTimersByTimeAsync(14_000); });
  expect(screen.getByTestId('off-hours-circle')).toBeTruthy(); expect(interval.mock.calls.filter(args => args[1] === 1000)).toHaveLength(1);
});
test('a newer native policy keeps its next interval/card together when an older read arrives afterwards', async () => {
  const b = await mount(), original = b.client.run.getMockImplementation()!, old = b.current(); let finish!: (r: ScreenTimeResponse) => void;
  b.client.run.mockImplementation((a, r) => a === 'snapshot' ? new Promise(resolve => { finish = resolve; }) : original(a, r));
  await act(async () => { void state.refresh(); });
  b.replace({ sequence: '2', revision: '2', nextPeriod: { ruleID: ids.reading, startsAt: Date.parse('2026-11-21T07:00:00Z') / 1000, endsAt: Date.parse('2026-11-21T08:00:00Z') / 1000 } });
  await act(async () => state.run('reconcile'));
  expect(screen.getByText('明日 07:00')).toBeTruthy(); expect(screen.getByRole('header', { name: '読書' })).toBeTruthy();
  await act(async () => finish({ status: 'ok', impacts: [], snapshot: old }));
  expect(screen.getByText('明日 07:00')).toBeTruthy(); expect(screen.getByText('08:00に終了')).toBeTruthy(); expect(screen.queryByText('夜の時間')).toBeNull();
});

test('large native fontScale keeps the circle and moves its date outside the fixed outline', async () => {
  const window = Dimensions.get('window'), display = Dimensions.get('screen');
  try {
    await act(async () => Dimensions.set({ window: { ...window, width: 320, fontScale: 2 }, screen: display }));
    await mount();
    expect(within(screen.getByTestId('off-hours-ring')).queryByText('今日 21:00')).toBeNull();
    expect(screen.getByText('今日 21:00')).toBeTruthy(); expect(screen.getByText('制限時間外')).toBeTruthy();
  } finally { await act(async () => Dimensions.set({ window, screen: display })); }
});
