import { fireEvent, render, screen } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { HomeScreen } from '../src/components/home/home-screen';
import { type HomePeriod, HomeView } from '../src/components/home/home-view';
import { ScreenTimeProvider } from '../src/state/screen-time';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null } }));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() }, useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }));
jest.mock('../modules/itoma-native', () => ({ screenTime: { run: jest.fn(async () => ({ status: 'error', code: 'unavailable', impacts: [], snapshot: require('../modules/itoma-native/src/screen-time').unavailableSnapshot('native-missing') })) } }));
jest.mock('../src/qa/native-smoke', () => ({ completeNativeHomeSmoke: jest.fn() }));
jest.mock('../src/global.css', () => ({}));

const originalOS = Platform.OS;
afterEach(() => { Platform.OS = originalOS; Constants.expoConfig = null; jest.clearAllMocks(); });
const startsAt = new Date(2026, 10, 8, 21).getTime();
const fixture: HomePeriod = {
  ruleName: '夜の時間', startsAt, endsAt: startsAt + 120 * 60_000,
  observation: 'confirmed', stateText: 'アプリを制限中',
  targets: [{ key: 'fixture-1', label: 'テスト用アプリ', detail: 'この時間帯の対象' }],
};

test('an unavailable product build has no fabricated rule, time, goal, apps or unlock action', async () => {
  await render(<ScreenTimeProvider><HomeScreen /></ScreenTimeProvider>);
  expect(screen.getByRole('header', { name: '自分の時間を、ここから。' })).toBeTruthy();
  expect(screen.queryByTestId('period-ring')).toBeNull();
  expect(screen.queryByText('この時間に、大切にしたいこと')).toBeNull();
  expect(screen.queryByText('YouTube')).toBeNull();
  expect(screen.queryByRole('button', { name: '一時解除する' })).toBeNull();
  expect(screen.getByRole('button', { name: 'ルールをつくる' })).toBeDisabled();
});

test('an unavailable product build preserves a direct manual PoC recovery route', async () => {
  Platform.OS = 'ios';
  Constants.expoConfig = { name: 'itoma', slug: 'itoma', ios: { infoPlist: { ITOMAScreenTimePoC: true } } };
  await render(<ScreenTimeProvider><HomeScreen /></ScreenTimeProvider>);
  expect(screen.getByText(/アプリを閉じても自動では停止しません/)).toBeTruthy();
  expect(router.replace).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: '検証画面を開く' }));
  expect(router.replace).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith('/native-poc');
});

test.each([undefined, false, 'true'])('normal iOS builds do not expose manual operations: %s', async (flag) => {
  Platform.OS = 'ios';
  Constants.expoConfig = { name: 'itoma', slug: 'itoma', ios: { infoPlist: { ITOMAScreenTimePoC: flag } } };
  await render(<ScreenTimeProvider><HomeScreen /></ScreenTimeProvider>);
  expect(screen.queryByRole('button', { name: '検証画面を開く' })).toBeNull();
});

test('web cannot expose the device recovery route through an iOS config flag', async () => {
  Platform.OS = 'web';
  Constants.expoConfig = { name: 'itoma', slug: 'itoma', ios: { infoPlist: { ITOMAScreenTimePoC: true } } };
  await render(<ScreenTimeProvider><HomeScreen /></ScreenTimeProvider>);
  expect(screen.queryByRole('button', { name: '検証画面を開く' })).toBeNull();
});

test('a current period shows the rule time, optional purpose and one common unlock action', async () => {
  const onUnlock = jest.fn();
  await render(<HomeView period={{ ...fixture, purpose: 'テスト用の本人入力' }} now={startsAt + 30 * 60_000} onUnlock={onUnlock} />);
  expect(screen.getByText('1時間30分')).toBeTruthy();
  expect(screen.getByText('23:00に終了')).toBeTruthy();
  expect(screen.getByText('テスト用の本人入力')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: '一時解除する' })).toHaveLength(1);
  await fireEvent.press(screen.getByRole('button', { name: '一時解除する' }));
  expect(onUnlock).toHaveBeenCalledTimes(1);
});

test('an unverified period does not turn desired restriction state into observed success', async () => {
  await render(<HomeView period={{ ...fixture, observation: 'unverified', purpose: '  ' }} now={startsAt + 1} />);
  expect(screen.getByText(/制限の状態を確認できません/)).toBeTruthy();
  expect(screen.getByText('設定上の時間')).toBeTruthy();
  expect(screen.queryByText('アプリを制限中')).toBeNull();
  expect(screen.queryByText('この時間に、大切にしたいこと')).toBeNull();
  expect(screen.queryByRole('button', { name: '一時解除する' })).toBeNull();
});

test('expiry cannot claim OS restoration or offer an unlock for an ended rule', async () => {
  await render(<HomeView period={fixture} now={fixture.endsAt} onUnlock={jest.fn()} />);
  expect(screen.getByText(/この時間帯は終了しました/)).toBeTruthy();
  expect(screen.queryByTestId('period-ring')).toBeNull();
  expect(screen.queryByRole('button', { name: '一時解除する' })).toBeNull();
  expect(screen.queryByText('アプリを制限中')).toBeNull();
});
