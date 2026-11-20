import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { ScreenTimeProvider, useScreenTime } from '../src/state/screen-time';
import { WorkFlowBoundary } from '../src/state/work-flow';
import { ProductHome } from '../src/components/flow/home';
import { UnlockScreen, UnlockConfirmationScreen } from '../src/components/flow/unlock';
import { GrantScreen } from '../src/components/flow/grant';
import { SettingsScreen } from '../src/components/flow/settings';
import { BrowseTestShell } from './fixtures/browse-shell';
import { at2130, at2205, ids, scopedBackend, scopedSnapshot } from './fixtures/scoped-rules';
import type { ScreenTimeResponse } from '../modules/itoma-native';

let mockPath = '/', mockRoute: (path: string) => void = () => {};
const mockGuards = new Map<string, (event: { repeat: () => void }) => void>();
const mockDismiss = jest.fn();
function mockGo(path: string) { mockPath = path; mockRoute(path); }
function mockRemove(path: string) {
  const repeat = () => { mockDismiss(path); mockGo(path); };
  const guard = [...mockGuards.values()].at(-1);
  if (guard) guard({ repeat }); else repeat();
}
jest.mock('expo-router', () => ({
  router: { navigate: (path: string) => mockGo(path), push: (path: string) => mockGo(path), dismissTo: (path: string) => mockRemove(path), back: () => mockGo(mockPath === '/unlock-confirm' ? '/unlock' : '/'), canGoBack: () => true },
  useSegments: () => ['(work)', mockPath.slice(1)],
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
  usePreventRemove: (dirty: boolean, callback: (event: { repeat: () => void }) => void) => {
    const id = require('react').useId();
    require('react').useEffect(() => { if (dirty) mockGuards.set(id, callback); else mockGuards.delete(id); return () => { mockGuards.delete(id); }; }, [id, dirty, callback]);
  },
}));
jest.mock('../modules/itoma-native', () => ({ screenTime: { run: jest.fn() } }));
jest.mock('../src/qa/native-smoke', () => ({ completeNativeHomeSmoke: jest.fn() }));
jest.mock('../src/global.css', () => ({}));
jest.mock('../src/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('../src/components/flow/applications', () => ({ Applications: ({ targetRef, onSelect, selected }: { targetRef?: string; onSelect?: () => void; selected: boolean }) => {
  const React = require('react'), RN = require('react-native'), { names } = require('./fixtures/scoped-rules');
  return onSelect ? React.createElement(RN.Pressable, { accessibilityRole: 'button', accessibilityLabel: names[targetRef!], accessibilityState: { selected }, onPress: onSelect }, React.createElement(RN.Text, null, names[targetRef!])) : React.createElement(RN.Text, null, names[targetRef!]);
} }));
let state: ReturnType<typeof useScreenTime>;
function Capture() { const value = useScreenTime(); useEffect(() => { state = value; }, [value]); return null; }
function Pages() {
  const [path, setPath] = useState(mockPath);
  useEffect(() => { mockRoute = setPath; return () => { mockRoute = () => {}; }; }, []);
  if (path === '/unlock' || path === '/unlock-confirm') return <WorkFlowBoundary>{path === '/unlock' ? <UnlockScreen /> : <UnlockConfirmationScreen />}</WorkFlowBoundary>;
  return <BrowseTestShell route={path} navigate={mockGo}>{path === '/grant' ? <GrantScreen /> : path === '/settings' ? <SettingsScreen /> : <ProductHome />}</BrowseTestShell>;
}
const press = async (name: string) => fireEvent.press(screen.getByRole('button', { name }));
async function mount(b = scopedBackend()) { await render(<ScreenTimeProvider client={b.client}><Capture /><Pages /></ScreenTimeProvider>); return b; }
async function startReading() { await press('次のルール'); await press('一時解除する'); }
async function fill() { await press('X'); await fireEvent.changeText(screen.getByLabelText('いま使う理由'), '合成の入力\n連絡を確認'); await fireEvent.changeText(screen.getByLabelText('解除時間（1〜30分）'), '7'); }
beforeEach(() => { mockPath = '/'; mockGuards.clear(); mockDismiss.mockClear(); jest.useFakeTimers({ doNotFake: ['queueMicrotask'] }); jest.setSystemTime(at2130); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test('native targets appear on one current card only; totals/day list/future apps are absent and card browsing issues no command', async () => {
  const b = await mount();
  expect(screen.getByText('Instagram')).toBeTruthy();
  for (const text of ['X', 'YouTube', 'TikTok', '今日のスケジュール']) expect(screen.queryByText(text)).toBeNull();
  expect(screen.queryByText(/つのアプリを制限中/)).toBeNull();
  await press('次のルール'); expect(screen.getByText('X')).toBeTruthy(); expect(screen.getByText('YouTube')).toBeTruthy(); expect(screen.queryByText('Instagram')).toBeNull();
  expect(screen.getAllByRole('button', { name: '一時解除する' })).toHaveLength(1);
  expect(b.client.run.mock.calls.every(([action]) => action === 'snapshot')).toBe(true);
});
test('cold link cannot expand its scope and returns home without creating a preview', async () => {
  mockPath = '/unlock'; const b = await mount();
  expect(screen.getByText('ホームでルールを選んでください')).toBeTruthy(); expect(screen.queryByRole('button', { name: 'X' })).toBeNull();
  await press('ホームでルールを選び直す'); expect(mockPath).toBe('/');
  expect(b.client.run.mock.calls.every(([action]) => action === 'snapshot')).toBe(true);
});
test('a card with no native winning targets has no unlock entry, and pending grant status remains reachable', async () => {
  const b = scopedBackend(); b.replace({ targets: [{ ...b.current().targets[0], grantCommandID: ids.command, grantStatus: 'pending' }] });
  await mount(b); await press('次のルール');
  expect(screen.getByText('現在、このルールが適用されているアプリはありません。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '一時解除する' })).toBeNull();
  expect(screen.getByRole('button', { name: '一時解除の状況を見る' })).toBeTruthy();
});
test('ending the chosen rule preserves reason/minutes without widening scope; explicit home choice changes it and granting X leaves TikTok', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {}), b = await mount();
  await startReading(); await fill();
  b.replace(scopedSnapshot(true));
  await act(async () => { jest.setSystemTime(at2205 - 1000); await jest.advanceTimersByTimeAsync(1000); await state.refresh(); });
  expect(screen.queryByRole('button', { name: 'X' })).toBeNull(); expect(screen.queryByRole('button', { name: 'TikTok' })).toBeNull();
  expect(screen.getByLabelText('いま使う理由')).toHaveDisplayValue('合成の入力\n連絡を確認'); expect(screen.getByLabelText('解除時間（1〜30分）')).toHaveDisplayValue('7');
  expect(state.unlockDraft.targetRef).toBeUndefined(); expect(state.unlockDraft.ruleID).toBe(ids.reading);
  await press('ホームでルールを選び直す'); expect(mockPath).toBe('/'); expect(alert).not.toHaveBeenCalled();
  await press('次のルール'); await press('一時解除する'); expect(state.unlockDraft.ruleID).toBe(ids.bed);
  expect(screen.getByLabelText('いま使う理由')).toHaveDisplayValue('合成の入力\n連絡を確認');
  expect(screen.queryByRole('button', { name: 'Instagram' })).toBeNull(); await press('X'); await press('解除内容を確認する'); await press('理由を保存して一時解除する');
  expect(mockPath).toBe('/grant'); expect(alert).not.toHaveBeenCalled(); expect(b.client.run.mock.calls.filter(([a]) => a === 'unlock')).toHaveLength(1);
  await press('ホームへ戻る'); await press('一時解除する');
  expect(screen.getByRole('button', { name: 'TikTok' })).toBeTruthy(); expect(screen.queryByRole('button', { name: 'X' })).toBeNull();
  expect(b.current().targets.find(t => t.ref === ids.instagram)?.restricted).toBe(true);
});
test('preview cancellation failure blocks choosing another rule, retaining text and review ownership until acknowledged retry', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {}), b = await mount();
  const original = b.client.run.getMockImplementation()!; let fail = true;
  b.client.run.mockImplementation((action, request) => action === 'cancelUnlock' && fail ? Promise.resolve({ status: 'error', code: 'storage-failed', impacts: [] }) : original(action, request));
  await startReading(); await fill(); await press('解除内容を確認する'); await press('入力に戻る');
  await fireEvent.changeText(screen.getByLabelText('いま使う理由'), '確認後の合成入力');
  expect(state.unlockReview).toBeUndefined(); expect(state.unlockPreviewRef).toBe(ids.preview);
  await press('ホームでルールを選び直す'); expect(mockPath).toBe('/unlock'); expect(state.unlockPreviewRef).toBe(ids.preview);
  expect(screen.getByLabelText('いま使う理由')).toHaveDisplayValue('確認後の合成入力');
  fail = false; await press('ホームでルールを選び直す'); expect(mockPath).toBe('/'); expect(alert).not.toHaveBeenCalled();
  await press('一時解除する'); expect(screen.getByLabelText('いま使う理由')).toHaveDisplayValue('確認後の合成入力');
});
test('continue restrictions asks once, retains input on keep/failure, then leaves through the root guard without a second dialog', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {}), b = await mount(), original = b.client.run.getMockImplementation()!;
  let fail = true;
  b.client.run.mockImplementation((action, request) => action === 'cancelUnlock' && fail ? Promise.resolve({ status: 'error', code: 'storage-failed', impacts: [] }) : original(action, request));
  await startReading(); await fill(); await press('解除内容を確認する'); await press('制限を続ける');
  await act(async () => alert.mock.calls.at(-1)?.[2]?.[0].onPress?.()); expect(mockPath).toBe('/unlock-confirm');
  await press('制限を続ける'); await act(async () => alert.mock.calls.at(-1)?.[2]?.[1].onPress?.()); expect(mockPath).toBe('/unlock-confirm'); expect(state.unlockDraft.reason).toContain('合成');
  fail = false; await press('制限を続ける'); await act(async () => alert.mock.calls.at(-1)?.[2]?.[1].onPress?.());
  expect(mockPath).toBe('/'); expect(alert).toHaveBeenCalledTimes(3); expect(state.unlockDraft.reason).toBe(''); expect(mockDismiss).toHaveBeenCalledTimes(1);
  expect(b.client.run.mock.calls.some(([a]) => a === 'unlock')).toBe(false);
});
test('period/selection changes during confirmation block acceptance, and a failed request keeps the root dirty guard', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {}), b = await mount(), original = b.client.run.getMockImplementation()!;
  b.client.run.mockImplementation((action, request) => action === 'unlock' ? Promise.resolve({ status: 'error', code: 'changed', impacts: [], snapshot: b.current() }) : original(action, request));
  await startReading(); await fill(); await press('解除内容を確認する'); await press('理由を保存して一時解除する');
  expect(screen.getByText('解除の完了を確認できません')).toBeTruthy(); expect(state.canExitUnlock()).toBe(false);
  await act(async () => mockRemove('/')); expect(alert).toHaveBeenCalledTimes(1); expect(mockPath).toBe('/unlock-confirm');
  await press('入力に戻る'); await press('解除内容を確認する');
  b.replace({ targets: b.current().targets.map(t => ({ ...t, selectionRef: 'changed' })) }); await act(async () => state.refresh());
  expect(screen.getByRole('button', { name: '理由を保存して一時解除する' })).toBeDisabled();
  await press('理由を保存して一時解除する'); expect(b.client.run.mock.calls.filter(([a]) => a === 'unlock')).toHaveLength(1);
});
test.each(['edited', 'hidden', 'new-session'] as const)('a late preview after %s does not open confirmation or overwrite the next input', async mode => {
  const b = await mount(), original = b.client.run.getMockImplementation()!; let resolve!: () => void;
  b.client.run.mockImplementation(async (action, request) => { if (action === 'previewUnlock') await new Promise<void>(r => { resolve = r; }); return original(action, request); });
  await startReading(); await fill(); await press('解除内容を確認する');
  if (mode === 'hidden') await act(async () => mockGo('/settings'));
  else if (mode === 'new-session') await act(async () => { mockGo('/settings'); state.resetUnlock(); state.setUnlockDraft({ reason: '新しい合成入力', minutes: '3', ruleID: ids.night }); });
  else await fireEvent.changeText(screen.getByLabelText('いま使う理由'), '後から編集した合成入力');
  await act(async () => resolve());
  expect(mockPath).toBe(mode === 'edited' ? '/unlock' : '/settings'); expect(state.unlockReview).toBeUndefined();
  expect(state.unlockDraft.reason).toContain(mode === 'new-session' ? '新しい' : mode === 'edited' ? '後から' : '合成');
  expect(b.client.run.mock.calls.filter(([a]) => a === 'cancelUnlock')).toHaveLength(mode === 'new-session' ? 0 : 1);
});
test('an accepted response without its refreshed snapshot leaves once', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {}), b = await mount(), original = b.client.run.getMockImplementation()!;
  b.client.run.mockImplementation(async (action, request): Promise<ScreenTimeResponse> => { const result = await original(action, request); return action === 'unlock' ? { ...result, snapshot: undefined } : result; });
  await startReading(); await fill(); await press('解除内容を確認する'); await press('理由を保存して一時解除する');
  expect(mockPath).toBe('/grant'); expect(mockDismiss).toHaveBeenCalledTimes(1); expect(alert).not.toHaveBeenCalled();
});

test('a late grant response can update native state without redirecting a hidden flow or clearing a newer draft', async () => {
  const b = await mount(), original = b.client.run.getMockImplementation()!; let resolve!: () => void;
  b.client.run.mockImplementation(async (action, request) => { if (action === 'unlock') await new Promise<void>(r => { resolve = r; }); return original(action, request); });
  await startReading(); await fill(); await press('解除内容を確認する'); await press('理由を保存して一時解除する');
  await act(async () => { mockGo('/settings'); state.resetUnlock(); state.setUnlockDraft({ ruleID: ids.night, reason: '次の合成入力', minutes: '2' }); });
  await act(async () => resolve()); expect(mockPath).toBe('/settings'); expect(state.unlockDraft.reason).toBe('次の合成入力'); expect(mockDismiss).not.toHaveBeenCalled();
});

test('card count and repeated browsing do not create additional display clocks; entering work stops the home clock', async () => {
  const interval = jest.spyOn(global, 'setInterval'), cleared = jest.spyOn(global, 'clearInterval');
  const b = await mount();
  const clocks = () => interval.mock.calls.map((args, i) => args[1] === 1000 ? interval.mock.results[i].value : undefined).filter(value => value !== undefined);
  expect(clocks()).toHaveLength(1);
  for (let i = 0; i < 10; i++) { await press('次のルール'); await press('前のルール'); }
  expect(clocks()).toHaveLength(1);
  const homeClock = clocks()[0]; await startReading(); expect(cleared).toHaveBeenCalledWith(homeClock); expect(clocks()).toHaveLength(2);
  expect(b.client.run.mock.calls.every(([action]) => action === 'snapshot')).toBe(true);
});
test.each(['unknown', 'all-granted'] as const)('%s cards do not create an unlock entry or lose the state/status explanation', async condition => {
  const b = scopedBackend();
  b.replace(condition === 'unknown' ? { observation: 'unknown' } : { targets: b.current().targets.map(t => ({ ...t, restricted: false, unlockable: false, grantCommandID: ids.command, grantStatus: 'active', grantEndsAt: at2130 / 1000 + 300 })) });
  await mount(b); expect(screen.queryByRole('button', { name: '一時解除する' })).toBeNull();
  if (condition === 'unknown') expect(screen.getByText('制限の状態を確認してください')).toBeTruthy();
  else expect(screen.getByRole('button', { name: '一時解除の状況を見る' })).toBeTruthy();
});

test('a discard dialog from an older session cannot cancel a newer preview or erase its draft', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {}), b = await mount();
  await startReading(); await fill(); await press('制限を続ける');
  const confirm = alert.mock.calls.at(-1)?.[2]?.[1].onPress;
  await act(async () => { mockGo('/settings'); state.resetUnlock(); state.setUnlockDraft({ ruleID: ids.night, reason: '別の合成入力', minutes: '3' }); state.setUnlockPreviewRef('new-preview'); });
  await act(async () => confirm?.());
  expect(state.unlockDraft.reason).toBe('別の合成入力'); expect(state.unlockPreviewRef).toBe('new-preview'); expect(mockPath).toBe('/settings');
  expect(b.client.run.mock.calls.some(([action]) => action === 'cancelUnlock')).toBe(false);
});
