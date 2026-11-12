import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { OnboardingProvider } from '../src/state/onboarding';
import { ScreenTimeProvider } from '../src/state/screen-time';
import { OnboardingScreen } from '../src/components/flow/onboarding';
import { ProductHome } from '../src/components/flow/home';
import { onboardingResult, validOnboardingSchedule } from '../src/components/flow/onboarding-flow';
import { onboardingFixture } from './fixtures/onboarding';
import { unavailableSnapshot } from '../modules/itoma-native/src/screen-time';

jest.mock('../modules/itoma-native', () => ({ screenTime: { run: jest.fn() }, onboardingRecords: { run: jest.fn() } }));
jest.mock('../src/global.css', () => ({}));
jest.mock('../src/components/flow/applications', () => ({ Applications: () => null }));
jest.mock('../src/hooks/use-visible-clock', () => ({ useVisibleClock: () => Date.now() }));
jest.mock('../src/qa/native-smoke', () => ({ completeNativeHomeSmoke: jest.fn() }));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn(), dismissTo: jest.fn(), replace: jest.fn() }, usePreventRemove: jest.fn(),
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const mount = (b: ReturnType<typeof onboardingFixture>, home = false) => render(<ScreenTimeProvider client={b.control}><OnboardingProvider client={b.setup}>{home ? <ProductHome /> : <OnboardingScreen />}</OnboardingProvider></ScreenTimeProvider>);
const start = async () => { await screen.findByText('自分の時間に、余白を。'); await press('自分の時間をつくる'); await screen.findByLabelText('この時間の名前（任意）'); };
const schedule = async () => {
  await press('曜日と時間を決める');
  expect(screen.getByRole('button', { name: '対象アプリへ' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('checkbox', { name: '月曜日' }));
  await fireEvent.changeText(screen.getByLabelText('開始時刻（24時間 HH:MM）'), '23:30');
  await fireEvent.changeText(screen.getByLabelText('終了時刻（24時間 HH:MM）'), '00:30');
  await fireEvent.press(screen.getByRole('checkbox', { name: '翌日に終了する' }));
  await press('対象アプリへ'); await screen.findByText('離れたいアプリを、選ぶ');
};
const apps = async () => { await press('スクリーンタイムを許可する'); await press('対象アプリを選ぶ'); await press('内容を確認する'); await screen.findByText('この内容で、はじめますか'); };
beforeEach(() => { jest.clearAllMocks(); });

test('optional purpose, schedule first, real bridge actions only by taps; final confirmation alone starts a rule', async () => {
  const b = onboardingFixture(); await mount(b); await start(); await schedule();
  expect(b.nativeActions).toEqual(['snapshot']); expect(b.snapshot().rules).toHaveLength(0);
  await apps();
  expect(b.nativeActions).toContain('authorize'); expect(b.nativeActions).toContain('pickApplications');
  expect(b.snapshot().rules).toHaveLength(0); expect(b.setupActions).not.toContain('onboardingCommit');
  expect(screen.getByText('名前：未設定（任意）')).toBeTruthy(); expect(screen.getByText('行動目標：未設定（任意）')).toBeTruthy();
  for (const name of ['名前と目的を変更', '曜日・時間を変更', '許可と対象アプリを変更']) expect(screen.getByRole('button', { name })).toBeEnabled();
  for (const name of ['目的を見直す', '曜日・時間を見直す', '許可と対象アプリを見直す']) expect(screen.queryByRole('button', { name })).toBeNull();
  await press('この内容で、はじめる'); await screen.findByText('次の時間に向けて、準備できました');
  expect(b.snapshot().rules).toHaveLength(1); expect(b.snapshot().rules[0].goal).toBe('');
  expect(b.progress().completed).toBe(true); expect(b.progress().draft).toBeUndefined();
  expect(b.nativeActions.every(a => !['previewRule', 'commitRule', 'retryRule', 'resume'].includes(a))).toBe(true);
  await press('ホームで現在の状態を見る'); expect(router.dismissTo).toHaveBeenCalledWith('/');
});
test('defer and a fresh provider restore purpose/time; home has one resume entry and no duplicate permission button', async () => {
  const b = onboardingFixture(), first = await mount(b); await start();
  await fireEvent.changeText(screen.getByLabelText('この時間の名前（任意）'), '合成の余白');
  await fireEvent.changeText(screen.getByLabelText('大切にしたいこと・行動目標（任意）'), '合成の目標\n自分の時間を過ごす');
  await schedule(); await press('内容を残して、ホームへ'); await first.unmount();
  const h = await mount(b, true); await screen.findByRole('button', { name: '初回設定を続ける' });
  expect(screen.queryByRole('button', { name: '許可を確認する' })).toBeNull(); expect(screen.queryByTestId('period-ring')).toBeNull();
  await h.unmount(); await mount(b); await screen.findByText('離れたいアプリを、選ぶ');
  await press('‹ 戻る'); expect(screen.getByLabelText('開始時刻（24時間 HH:MM）')).toHaveDisplayValue('23:30');
  await press('‹ 戻る'); expect(screen.getByLabelText('大切にしたいこと・行動目標（任意）')).toHaveDisplayValue('合成の目標\n自分の時間を過ごす');
  expect(b.snapshot().rules).toHaveLength(0);
});
test('permission denial and picker cancellation keep inputs and never prepare or commit a rule', async () => {
  const b = onboardingFixture(); b.deny(); await mount(b); await start(); await schedule();
  await press('スクリーンタイムを許可する'); expect(screen.getByText('許可されていません')).toBeTruthy();
  expect(b.progress().draft?.start).toBe('23:30');
  b.deny(false); await press('スクリーンタイムを許可する'); b.cancelPicker(); await press('対象アプリを選ぶ');
  await press('内容を確認する'); expect(screen.getByText('初回設定は、まだ途中です')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'この内容で、はじめる' })).toBeNull();
  expect(b.setupActions).not.toContain('onboardingPrepare'); expect(b.setupActions).not.toContain('onboardingCommit');
});
test('resuming a prepared draft requires selecting apps again and reviewing before submission', async () => {
  const b = onboardingFixture(), first = await mount(b); await start(); await schedule(); await apps();
  await first.unmount(); b.relaunch(); await mount(b); await screen.findByText('この内容で、はじめますか');
  expect(screen.queryByRole('button', { name: 'この内容で、はじめる' })).toBeNull();
  await press('許可と対象アプリを変更'); await press('対象アプリを選び直す'); await press('変更を確認する');
  await press('この内容で、はじめる'); expect(b.snapshot().rules).toHaveLength(1);
});
test('editing purpose returns directly to review with existing answers and does not repeat permission or the picker', async () => {
  const b = onboardingFixture(); await mount(b); await start();
  await fireEvent.changeText(screen.getByLabelText('この時間の名前（任意）'), '合成の時間');
  await schedule(); await apps(); const actions = [...b.nativeActions];
  await press('名前と目的を変更');
  expect(screen.getByLabelText('この時間の名前（任意）')).toHaveDisplayValue('合成の時間');
  expect(screen.getByText('設定内容の変更')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('大切にしたいこと・行動目標（任意）'), '合成の見直した目標');
  await press('変更を確認する'); await screen.findByText('この内容で、はじめますか');
  expect(screen.getByText('合成の見直した目標')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '対象アプリへ' })).toBeNull();
  expect(b.nativeActions.slice(actions.length).every(a => a === 'snapshot')).toBe(true);
  expect(b.progress().draft?.start).toBe('23:30'); expect(b.progress().selectionReady).toBe(true);
  expect(b.setupActions).not.toContain('onboardingCommit');
  await press('この内容で、はじめる'); expect(b.snapshot().rules[0].goal).toBe('合成の見直した目標');
});
test('editing time returns directly to review; going back with an invalid time cannot start a rule', async () => {
  const b = onboardingFixture(); await mount(b); await start(); await schedule(); await apps();
  await press('曜日・時間を変更');
  expect(screen.getByLabelText('開始時刻（24時間 HH:MM）')).toHaveDisplayValue('23:30');
  await fireEvent.changeText(screen.getByLabelText('開始時刻（24時間 HH:MM）'), 'bad');
  expect(screen.getByRole('button', { name: '変更を確認する' })).toBeDisabled();
  await press('‹ 戻る'); await screen.findByText('曜日と時間を確認してください');
  expect(screen.getByRole('button', { name: '最新の内容を確認する' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'この内容で、はじめる' })).toBeNull();
  await press('曜日・時間を変更'); await fireEvent.changeText(screen.getByLabelText('開始時刻（24時間 HH:MM）'), '23:00');
  await press('変更を確認する'); await screen.findByText('月 23:00〜翌00:30');
  expect(b.nativeActions.filter(a => a === 'pickApplications')).toHaveLength(1);
  expect(b.setupActions).not.toContain('onboardingCommit');
  expect(screen.getByRole('button', { name: 'この内容で、はじめる' })).toBeEnabled();
});
test('cancelling a picker from review preserves the confirmed selection, without applying the rule', async () => {
  const b = onboardingFixture(); await mount(b); await start(); await schedule(); await apps(); const selection = b.progress().draft?.selectionRef;
  await press('許可と対象アプリを変更'); b.cancelPicker(); await press('対象アプリを選び直す');
  await press('変更を確認する'); await screen.findByText('この内容で、はじめますか');
  expect(b.progress().draft?.selectionRef).toBe(selection); expect(b.progress().selectionReady).toBe(true);
  expect(screen.getByRole('button', { name: 'この内容で、はじめる' })).toBeEnabled(); expect(b.snapshot().rules).toHaveLength(0);
});
test('review edit destination survives defer and relaunch; saving text never reconfirms apps', async () => {
  const b = onboardingFixture(), first = await mount(b); await start(); await schedule(); await apps();
  await press('名前と目的を変更');
  await fireEvent.changeText(screen.getByLabelText('この時間の名前（任意）'), '合成の変更途中');
  await press('内容を残して、ホームへ'); await first.unmount(); b.relaunch();
  await mount(b); await screen.findByDisplayValue('合成の変更途中');
  expect(b.progress().draft?.returnToReview).toBe(true);
  await fireEvent.changeText(screen.getByLabelText('この時間の名前（任意）'), '合成の変更後');
  await press('変更を確認する'); await screen.findByText('この内容で、はじめますか');
  expect(screen.getByText('合成の変更後')).toBeTruthy(); expect(b.progress().selectionReady).toBe(false);
  expect(screen.queryByRole('button', { name: 'この内容で、はじめる' })).toBeNull();
  await press('許可と対象アプリを変更'); await press('対象アプリを選び直す'); await press('変更を確認する');
  expect(screen.getByRole('button', { name: 'この内容で、はじめる' })).toBeEnabled();
  expect(b.setupActions).not.toContain('onboardingCommit');
});
test('save failure keeps input; explicit discard asks before removal and does not start anything', async () => {
  const b = onboardingFixture(), alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await mount(b); await start(); b.failSave();
  await fireEvent.changeText(screen.getByLabelText('大切にしたいこと・行動目標（任意）'), '合成の未保存入力');
  await press('曜日と時間を決める'); await screen.findByText('初回設定を確認してください');
  expect(b.progress().draft?.step).toBe('purpose');
  await press('下書きを破棄する'); expect(b.progress().draft).toBeDefined();
  await act(async () => alert.mock.calls.at(-1)![2]![1].onPress?.());
  expect(b.progress().draft).toBeUndefined(); expect(b.snapshot().rules).toHaveLength(0); alert.mockRestore();
});
test('a failed application keeps its command and requires an explicit recheck and retry', async () => {
  const b = onboardingFixture(); b.failCommit(); await mount(b); await start(); await schedule(); await apps();
  await press('この内容で、はじめる'); await screen.findByText('前の要求の結果を確認しています');
  expect(b.progress().draft?.submitted).toBe(true); expect(b.snapshot().rules).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'この内容で登録を再試行する' })).toBeNull();
  b.failCommit(false); await press('最新の内容を確認する'); await press('この内容で登録を再試行する');
  expect(b.snapshot().rules).toHaveLength(1); expect(b.setupActions.filter(a => a === 'onboardingCommit')).toHaveLength(2);
});
test('an accepted operation outlives its screen and the home shows processing instead of offering a duplicate start', async () => {
  const b = onboardingFixture(); let release!: () => void;
  const setup = { run: async (...args: Parameters<typeof b.setup.run>) => {
    if (args[0] === 'onboardingCommit') await new Promise<void>(resolve => { release = resolve; });
    return b.setup.run(...args);
  } };
  const root = (home: boolean) => <ScreenTimeProvider client={b.control}><OnboardingProvider client={setup}>{home ? <ProductHome /> : <OnboardingScreen />}</OnboardingProvider></ScreenTimeProvider>;
  const view = await render(root(false)); await start(); await schedule(); await apps(); await press('この内容で、はじめる');
  await view.rerender(root(true));
  expect(screen.getByText('初回設定の結果を確認しています')).toBeTruthy();
  expect(screen.queryByText('初回設定は途中です')).toBeNull();
  expect(screen.getByRole('button', { name: '初回設定の結果を確認する' })).toBeDisabled();
  await act(async () => release()); await screen.findByText('次の時間まで');
  expect(b.snapshot().rules).toHaveLength(1); expect(b.setupActions.filter(a => a === 'onboardingCommit')).toHaveLength(1);
  expect(screen.queryByText('初回設定の結果を確認しています')).toBeNull();
});
test('existing installations adopt initial completion without being sent through the introduction', async () => {
  const b = onboardingFixture(); b.replace({ rules: [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', selectionRef: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', weekdays: [1], startMinute: 0, endMinute: 1, nextDay: false, enabled: true }] });
  await mount(b, true); await screen.findByText('対象のアプリ');
  expect(b.setupActions).toContain('onboardingAdopt'); expect(router.navigate).not.toHaveBeenCalled(); expect(b.nativeActions).not.toContain('authorize');
});
test('the first device launch sees the introduction once, while a later launch and Simulator do not force it', async () => {
  const b = onboardingFixture(), first = await mount(b, true);
  await screen.findByRole('button', { name: '初回設定を始める' });
  expect(router.navigate).toHaveBeenCalledTimes(1); expect(router.navigate).toHaveBeenCalledWith('/onboarding');
  await first.unmount(); jest.mocked(router.navigate).mockClear();
  const second = await mount(b, true); await screen.findByRole('button', { name: '初回設定を始める' });
  expect(router.navigate).not.toHaveBeenCalled(); await second.unmount();
  const simulator = onboardingFixture(); simulator.replace({ availability: 'simulator' });
  await mount(simulator, true); await screen.findByText('iPhoneのITOMAで設定できます');
  expect(simulator.setupActions).not.toContain('onboardingDefer'); expect(router.navigate).not.toHaveBeenCalled();
});
test('input guidance accepts 1 minute and 24 hours; result rejects stale, failed and unauthorized observations', () => {
  expect(validOnboardingSchedule({ weekdays: [7], start: '23:59', end: '00:00', nextDay: true })).toBe(true);
  expect(validOnboardingSchedule({ weekdays: [1], start: '01:00', end: '01:00', nextDay: true })).toBe(true);
  expect(validOnboardingSchedule({ weekdays: [1], start: '01:00', end: '01:01', nextDay: true })).toBe(false);
  const s = { ...unavailableSnapshot('device'), authorization: 'approved' as const, schedulesReady: true, observation: 'applied' as const, validUntil: 100 };
  expect(onboardingResult(s, 100_001).title).toBe('反映を確認できていません');
  expect(onboardingResult({ ...s, authorization: 'denied' }, 0).title).toBe('再開前の確認が必要です');
  expect(onboardingResult({ ...s, observation: 'failed' }, 0).title).toBe('反映を確認できていません');
});
