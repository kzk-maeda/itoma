import { fireEvent, render, screen } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { HomeScreen } from '../src/components/home/home-screen';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null } }));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('../src/global.css', () => ({}));

const originalOS = Platform.OS;
afterEach(() => { Platform.OS = originalOS; Constants.expoConfig = null; jest.clearAllMocks(); });

test('a freshly opened PoC home provides a recovery route without starting an operation', async () => {
  Platform.OS = 'ios';
  Constants.expoConfig = { name: 'itoma', slug: 'itoma', ios: { infoPlist: { ITOMAScreenTimePoC: true } } };
  await render(<HomeScreen />);
  expect(screen.getByText(/アプリを閉じても自動では停止しません/)).toBeTruthy();
  expect(router.replace).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: '検証画面を開く' }));
  expect(router.replace).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith('/native-poc');
});

test.each([undefined, false, 'true'])('a normal iOS build has no PoC entry (flag: %s)', async (flag) => {
  Platform.OS = 'ios';
  Constants.expoConfig = { name: 'itoma', slug: 'itoma', ios: { infoPlist: { ITOMAScreenTimePoC: flag } } };
  await render(<HomeScreen />);
  expect(screen.queryByRole('button', { name: '検証画面を開く' })).toBeNull();
});

test('Web does not expose the entry even if the iOS PoC config is present', async () => {
  Platform.OS = 'web';
  Constants.expoConfig = { name: 'itoma', slug: 'itoma', ios: { infoPlist: { ITOMAScreenTimePoC: true } } };
  await render(<HomeScreen />);
  expect(screen.queryByRole('button', { name: '検証画面を開く' })).toBeNull();
});
