import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { ScreenTimeProvider } from '../src/state/screen-time';
import { ProductHome } from '../src/components/flow/home';
import { OnboardingScreen } from '../src/components/flow/onboarding';
import { RuleEditorScreen, RuleConfirmationScreen } from '../src/components/flow/rule';
import { UnlockScreen, UnlockConfirmationScreen } from '../src/components/flow/unlock';
import { GrantScreen } from '../src/components/flow/grant';
import { SettingsScreen } from '../src/components/flow/settings';
import { unavailableSnapshot } from '../modules/itoma-native/src/screen-time';
import type { ScreenTimeAction, ScreenTimeRequest, ScreenTimeResponse, ScreenTimeSnapshot, RuleInput } from '../modules/itoma-native';

const now = Date.parse('2026-11-09T21:30:00Z');
const selection = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const appA = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const appB = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ruleID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const previewID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const commandID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
let mockHistory = ['/'];
let mockNavigate: (path: string) => void = () => {};
let mockGuard: { dirty: boolean; callback: (event: { repeat: () => void }) => void } | undefined;
function mockGo(path: string, replace = false) {
  mockHistory = replace ? [...mockHistory.slice(0, -1), path] : [...mockHistory, path]; mockNavigate(path);
}
function mockBack() {
  const repeat = () => { mockHistory.pop(); mockNavigate(mockHistory.at(-1) ?? '/'); };
  if (mockGuard?.dirty) mockGuard.callback({ repeat }); else repeat();
}
jest.mock('expo-router', () => ({
  router: { push: (path: string) => mockGo(path), replace: (path: string) => mockGo(path, true),
    navigate: (path: string) => mockGo(path), back: () => mockBack(), canGoBack: () => mockHistory.length > 1,
    dismissTo: (path: string) => { const index = mockHistory.lastIndexOf(path); if (index >= 0) { mockHistory = mockHistory.slice(0, index + 1); mockNavigate(path); } else mockGo(path, true); } },
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
  usePreventRemove: (dirty: boolean, callback: (event: { repeat: () => void }) => void) => {
    require('react').useEffect(() => { const current = { dirty, callback }; mockGuard = current; return () => { if (mockGuard === current) mockGuard = undefined; }; }, [dirty, callback]);
    return () => { mockGuard = undefined; };
  },
}));
jest.mock('../modules/itoma-native', () => ({ screenTime: { run: jest.fn() } }));
jest.mock('../src/qa/native-smoke', () => ({ completeNativeHomeSmoke: jest.fn() }));
jest.mock('../src/global.css', () => ({}));
jest.mock('../src/components/flow/applications', () => ({ Applications: ({ targetRef, count, onSelect, selected }: { targetRef?: string; count: number; onSelect?: () => void; selected: boolean }) => {
  const React = require('react'), RN = require('react-native');
  const label = targetRef?.startsWith('bbbb') ? 'テスト用アプリA' : targetRef?.startsWith('cccc') ? 'テスト用アプリB' : `選択アプリ${count}件`;
  return onSelect ? React.createElement(RN.Pressable, { accessibilityRole: 'button', accessibilityLabel: label, accessibilityState: { selected }, onPress: onSelect }, React.createElement(RN.Text, null, label)) : React.createElement(RN.Text, null, label);
} }));

function Pages() {
  const [route, setRoute] = useState('/');
  useEffect(() => { mockNavigate = setRoute; return () => { mockNavigate = () => {}; }; }, []);
  switch (route) {
    case '/onboarding': return <OnboardingScreen />;
    case '/rule': return <RuleEditorScreen />;
    case '/rule-confirm': return <RuleConfirmationScreen />;
    case '/unlock': return <UnlockScreen />;
    case '/unlock-confirm': return <UnlockConfirmationScreen />;
    case '/grant': return <GrantScreen />;
    case '/settings': return <SettingsScreen />;
    default: return <ProductHome />;
  }
}

function backend(configured = true, failGrant = false) {
  let snapshot: ScreenTimeSnapshot = { ...unavailableSnapshot('device'), storage: configured ? 'ready' : 'not-created',
    authorization: configured ? 'approved' : 'unknown', schedulesReady: true, observation: 'applied', validUntil: now / 1000 + 1800,
    rules: configured ? [{ id: ruleID, selectionRef: selection, weekdays: [1, 2, 3, 4, 5], startMinute: 1260, endMinute: 1380, nextDay: false, enabled: true }] : [],
    selections: configured ? [{ ref: selection, count: 2 }] : [],
    targets: configured ? [{ ref: appA, selectionRef: selection, ruleID, restricted: true, unlockable: true }, { ref: appB, selectionRef: selection, ruleID, restricted: true, unlockable: true }] : [],
    periods: configured ? [{ ruleID, startsAt: now / 1000 - 1800, endsAt: now / 1000 + 5400 }] : [],
  };
  let proposed: RuleInput | undefined, target = appA;
  const expiry = now / 1000 + 300;
  const run = jest.fn(async (action: ScreenTimeAction, request: ScreenTimeRequest = {}): Promise<ScreenTimeResponse> => {
    const response = (extra: Partial<ScreenTimeResponse> = {}): ScreenTimeResponse => ({ status: 'ok', impacts: [], snapshot: { ...snapshot }, ...extra });
    switch (action) {
      case 'authorize': snapshot = { ...snapshot, authorization: 'approved' }; break;
      case 'initialize': snapshot = { ...snapshot, storage: 'ready' }; break;
      case 'pickApplications': snapshot = { ...snapshot, selections: [{ ref: selection, count: 2 }] }; return response({ ref: selection });
      case 'previewRule': proposed = request.rule; return response({ status: 'confirmation-required', ref: previewID });
      case 'commitRule':
        snapshot = { ...snapshot, revision: '1', sequence: '1', rules: [{ ...proposed!, id: ruleID }],
          targets: [{ ref: appA, selectionRef: selection, ruleID, restricted: true, unlockable: true }, { ref: appB, selectionRef: selection, ruleID, restricted: true, unlockable: true }],
          periods: [{ ruleID, startsAt: now / 1000 - 1800, endsAt: now / 1000 + 5400 }] }; break;
      case 'previewUnlock': target = request.targetRef!; return response({ status: 'confirmation-required', ref: previewID, minutes: request.minutes, previewEndsAt: expiry, shortened: false });
      case 'unlock': case 'retryGrant':
        snapshot = { ...snapshot, sequence: action === 'unlock' ? '2' : '3',
          targets: snapshot.targets.map((t) => t.ref === target ? { ...t, restricted: action === 'unlock' && failGrant, unlockable: false,
            grantStatus: action === 'unlock' && failGrant ? 'failed' : 'active', grantCommandID: commandID, grantEndsAt: expiry } : t) };
        if (action === 'unlock' && failGrant) return response({ status: 'error', code: 'schedule-failed', ref: commandID, retryable: true });
        return response({ ref: commandID });
      case 'stop': snapshot = { ...snapshot, activation: 'paused', sequence: '4' }; break;
      case 'resume': snapshot = { ...snapshot, activation: 'enabled', sequence: '5' }; break;
    }
    return response();
  });
  return { client: { run }, current: () => snapshot, replace: (value: Partial<ScreenTimeSnapshot>) => { snapshot = { ...snapshot, ...value }; } };
}

beforeEach(() => { mockHistory = ['/']; mockGuard = undefined; jest.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => jest.restoreAllMocks());
const press = async (name: string) => { await fireEvent.press(screen.getByRole('button', { name })); };

test('onboarding → native selection → weekdays/time review → saved rule on the home, without PoC navigation', async () => {
  const b = backend(false);
  await render(<ScreenTimeProvider client={b.client}><Pages /></ScreenTimeProvider>);
  await press('ルールをつくる');
  await press('スクリーンタイムを許可する');
  await press('対象アプリを選ぶ');
  expect(b.client.run.mock.calls.some(([action]) => action === 'commitRule')).toBe(false);
  await press('内容を確認する');
  expect(screen.getByText(/月・火・水・木・金 21:00〜23:00/)).toBeTruthy();
  await press('編集へ戻る');
  expect(screen.getByLabelText('開始時刻（24時間 HH:MM）')).toHaveDisplayValue('21:00');
  await press('内容を確認する'); await press('この内容で保存する');
  expect(screen.getByRole('header', { name: 'いとま' })).toBeTruthy();
  expect(screen.queryByText('時間帯ルールは準備中です')).toBeNull();
  expect(b.client.run.mock.calls.filter(([action]) => action === 'commitRule')).toHaveLength(1);
  expect(mockHistory).not.toContain('/native-poc');
});

test('one entry → initially unselected app → free text → editable full review → exactly one app grant with fixed expiry', async () => {
  const b = backend();
  await render(<ScreenTimeProvider client={b.client}><Pages /></ScreenTimeProvider>);
  expect(screen.getAllByRole('button', { name: '一時解除する' })).toHaveLength(1);
  await press('一時解除する');
  expect(screen.getByRole('button', { name: '解除内容を確認する' })).toBeDisabled();
  await press('テスト用アプリA');
  await fireEvent.changeText(screen.getByLabelText('いま使う理由'), ' \n ');
  expect(screen.getByRole('button', { name: '解除内容を確認する' })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('いま使う理由'), 'synthetic purpose\nsecond line');
  await press('解除内容を確認する');
  expect(screen.getByText('synthetic purpose\nsecond line')).toBeTruthy();
  expect(screen.getByRole('header', { name: 'この解除に適用するルール' })).toBeTruthy();
  expect(screen.getByText(/月・火・水・木・金 21:00〜23:00/)).toBeTruthy();
  await press('入力に戻る');
  expect(screen.getByLabelText('いま使う理由')).toHaveDisplayValue('synthetic purpose\nsecond line');
  await press('解除内容を確認する'); await press('理由を保存して一時解除する');
  expect(screen.getByRole('header', { name: '一時解除の状況' })).toBeTruthy();
  expect(b.current().targets.find((t) => t.ref === appB)?.restricted).toBe(true);
  const endsAt = b.current().targets.find((t) => t.ref === appA)?.grantEndsAt;
  await press('ホームへ戻る');
  expect(b.current().targets.find((t) => t.ref === appA)?.grantEndsAt).toBe(endsAt);
  const requests = b.client.run.mock.calls.filter(([action]) => action === 'unlock');
  expect(requests).toHaveLength(1); expect(requests[0][1]).toEqual({ ref: previewID, reason: 'synthetic purpose\nsecond line' });
  expect(mockHistory.every((path) => !path.includes('synthetic'))).toBe(true);
});

test('dirty cancellation keeps text on Keep, and confirmed discard does not request a grant', async () => {
  const b = backend(), alert = jest.spyOn(Alert, 'alert');
  await render(<ScreenTimeProvider client={b.client}><Pages /></ScreenTimeProvider>);
  await press('一時解除する'); await fireEvent.changeText(screen.getByLabelText('いま使う理由'), 'synthetic draft');
  await press('‹ 戻る');
  expect(alert).toHaveBeenCalledWith('入力を破棄して戻りますか', expect.any(String), expect.any(Array));
  expect(screen.getByLabelText('いま使う理由')).toHaveDisplayValue('synthetic draft');
  await act(async () => { alert.mock.calls.at(-1)?.[2]?.[1].onPress?.(); });
  expect(screen.getByRole('header', { name: 'いとま' })).toBeTruthy();
  expect(b.client.run.mock.calls.some(([action]) => action === 'unlock')).toBe(false);
});

test('failed accepted grants expose retry of the same command and original absolute upper bound', async () => {
  const b = backend(true, true);
  await render(<ScreenTimeProvider client={b.client}><Pages /></ScreenTimeProvider>);
  await press('一時解除する'); await press('テスト用アプリA');
  await fireEvent.changeText(screen.getByLabelText('いま使う理由'), 'synthetic retry');
  await press('解除内容を確認する'); await press('理由を保存して一時解除する');
  expect(screen.getByText('解除を完了できませんでした')).toBeTruthy();
  const endsAt = b.current().targets[0].grantEndsAt;
  await press('元の期限のまま登録を再試行');
  expect(b.client.run).toHaveBeenCalledWith('retryGrant', { ref: commandID });
  expect(b.current().targets[0].grantEndsAt).toBe(endsAt);
  expect(b.client.run.mock.calls.filter(([action]) => action === 'unlock')).toHaveLength(1);
});

test('continuing restrictions from input and confirmation preserves text until explicit discard and never accepts a grant', async () => {
  const b = backend(), alert = jest.spyOn(Alert, 'alert');
  await render(<ScreenTimeProvider client={b.client}><Pages /></ScreenTimeProvider>);
  await press('一時解除する'); await press('テスト用アプリA');
  await fireEvent.changeText(screen.getByLabelText('いま使う理由'), 'synthetic continued restriction');
  await press('制限を続ける');
  await act(async () => { alert.mock.calls.at(-1)?.[2]?.[0].onPress?.(); });
  expect(screen.getByLabelText('いま使う理由')).toHaveDisplayValue('synthetic continued restriction');
  expect(b.client.run.mock.calls.some(([action]) => action === 'cancelUnlock')).toBe(false);
  await press('解除内容を確認する'); await press('制限を続ける');
  expect(screen.getByText('synthetic continued restriction')).toBeTruthy();
  await act(async () => { alert.mock.calls.at(-1)?.[2]?.[1].onPress?.(); });
  expect(screen.getByRole('header', { name: 'いとま' })).toBeTruthy();
  expect(b.client.run.mock.calls.some(([action]) => action === 'unlock')).toBe(false);
  expect(b.current().targets.every((target) => target.restricted)).toBe(true);
  await press('一時解除する');
  expect(screen.getByLabelText('いま使う理由')).toHaveDisplayValue('');
});

test('stale observations remain unverified and reason deletion requires the separate explicit confirmation', async () => {
  const b = backend(), alert = jest.spyOn(Alert, 'alert');
  b.replace({ validUntil: now / 1000 - 1 });
  await render(<ScreenTimeProvider client={b.client}><Pages /></ScreenTimeProvider>);
  expect(screen.getByText('保存した設定上の時間')).toBeTruthy();
  expect(screen.queryByText('制限設定を反映しました')).toBeNull();
  await press('ルールと設定'); await press('保存した理由の削除を確認');
  expect(b.client.run.mock.calls.some(([action]) => action === 'deleteReasons')).toBe(false);
  await act(async () => { alert.mock.calls.at(-1)?.[2]?.[1].onPress?.(); });
  expect(b.client.run).toHaveBeenCalledWith('deleteReasons', {});
  expect(screen.getByText('保存した理由を削除しました。')).toBeTruthy();
  expect(b.current().rules).toHaveLength(1);
});

test.each(['ルールを追加する', '時間帯 1を編集', '時間帯 1を削除する内容を確認'])('settings cannot overwrite a retained dirty rule draft via %s', async (action) => {
  const b = backend(), alert = jest.spyOn(Alert, 'alert');
  await render(<ScreenTimeProvider client={b.client}><Pages /></ScreenTimeProvider>);
  await press('ルールと設定'); await press('時間帯 1を編集');
  await fireEvent.changeText(screen.getByLabelText('開始時刻（24時間 HH:MM）'), '20:00');
  await press('内容を確認する'); await press('保存したルールを確認する');
  const before = b.client.run.mock.calls.length;
  await press(action);
  expect(alert.mock.calls.at(-1)?.[0]).toBe('編集中の入力があります');
  expect(b.client.run.mock.calls.slice(before).some(([name]) => name === 'previewRule' || name === 'commitRule')).toBe(false);
  await act(async () => { alert.mock.calls.at(-1)?.[2]?.[0].onPress?.(); });
  expect(screen.getByLabelText('開始時刻（24時間 HH:MM）')).toHaveDisplayValue('20:00');
  expect(b.current().rules[0].startMinute).toBe(1260);
});

test('reauthorization keeps existing rules awaiting explicit review/resume and does not create a duplicate rule', async () => {
  const b = backend(); b.replace({ authorization: 'denied', activation: 'awaitingReauthorizationConfirmation', needsSelectionReview: true });
  await render(<ScreenTimeProvider client={b.client}><Pages /></ScreenTimeProvider>);
  expect(screen.queryByRole('button', { name: '一時解除する' })).toBeNull();
  expect(screen.queryByText('制限設定を反映しました')).toBeNull();
  await press('許可を確認する'); await press('スクリーンタイムを許可する');
  expect(screen.getByRole('header', { name: 'ルールと設定' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '保存したルールの再開を確認' })).toBeDisabled();
  expect(b.client.run.mock.calls.some(([name]) => name === 'resume' || name === 'previewRule' || name === 'commitRule')).toBe(false);
});
