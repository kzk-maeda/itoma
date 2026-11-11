import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { ScreenTimeProvider } from '../src/state/screen-time';
import { RuleDetailsScreen } from '../src/components/flow/rule-details';
import { ProductHome } from '../src/components/flow/home';
import { unavailableSnapshot, type ScreenTimeAction, type ScreenTimeRequest, type ScreenTimeResponse, type ScreenTimeSnapshot } from '../modules/itoma-native/src/screen-time';

let mockGuard: ((event: { repeat: () => void }) => void) | undefined;
const mockBack = jest.fn();
jest.mock('expo-router', () => ({ router: { back: jest.fn(() => mockGuard ? mockGuard({ repeat: mockBack }) : mockBack()), canGoBack: () => true },
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
  usePreventRemove: (dirty: boolean, callback: typeof mockGuard) => { require('react').useEffect(() => { mockGuard = dirty ? callback : undefined; return () => { mockGuard = undefined; }; }, [dirty, callback]); },
}));
jest.mock('../modules/itoma-native', () => ({ screenTime: { run: jest.fn() } }));
jest.mock('../src/global.css', () => ({}));
jest.mock('../src/qa/native-smoke', () => ({ completeNativeHomeSmoke: jest.fn() }));
jest.mock('../src/hooks/use-visible-clock', () => ({ useVisibleClock: () => Date.parse('2026-11-09T21:30:00Z') }));
jest.mock('../src/components/flow/applications', () => ({ Applications: () => null }));
const id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
function backend() {
  let value: ScreenTimeSnapshot = { ...unavailableSnapshot('device'), storage: 'ready', revision: '7', sequence: '10', ruleDetailsStatus: 'ready', ruleDetailsRevision: '0',
    rules: [{ id, selectionRef: id, weekdays: [1], startMinute: 1260, endMinute: 1380, nextDay: false, enabled: true }],
    periods: [{ ruleID: id, startsAt: Date.parse('2026-11-09T21:00:00Z') / 1000, endsAt: Date.parse('2026-11-09T23:00:00Z') / 1000 }] };
  let failure: 'storage-failed' | 'changed' | undefined;
  const run = jest.fn(async (action: ScreenTimeAction, request: ScreenTimeRequest = {}): Promise<ScreenTimeResponse> => {
    if (action === 'saveRuleDetails') {
      if (failure) { const code = failure; failure = undefined; return { status: 'error', code, impacts: [], snapshot: value }; }
      value = { ...value, ruleDetailsRevision: String(Number(value.ruleDetailsRevision) + 1), rules: value.rules.map(rule => ({ ...rule, title: request.details!.title.trim(), goal: request.details!.goal })) };
    }
    return { status: 'ok', impacts: [], snapshot: value };
  });
  return { client: { run }, fail: (kind: typeof failure) => { failure = kind; }, current: () => value,
    change: () => { value = { ...value, ruleDetailsRevision: '1', rules: value.rules.map(rule => ({ ...rule, title: '別の保存内容' })) }; } };
}
const press = async (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const input = async () => { await screen.findByLabelText('ルール名（任意）'); await fireEvent.changeText(screen.getByLabelText('ルール名（任意）'), '夜の余白'); await fireEvent.changeText(screen.getByLabelText('行動目標（任意）'), '合成の行動目標\n自分の時間を大切にする'); };
beforeEach(() => { mockGuard = undefined; mockBack.mockClear(); jest.mocked(router.back).mockClear(); });

test('saving personal text preserves policy/sequence, and a new screen restores it on the home', async () => {
  const b = backend();
  const first = await render(<ScreenTimeProvider client={b.client}><RuleDetailsScreen ruleID={id} /></ScreenTimeProvider>);
  await input(); await press('保存する');
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(b.current().revision).toBe('7'); expect(b.current().sequence).toBe('10');
  expect(b.client.run).toHaveBeenCalledWith('saveRuleDetails', { details: { ruleID: id, title: '夜の余白', goal: '合成の行動目標\n自分の時間を大切にする', expectedRevision: '0', expectedPolicyRevision: '7' } });
  expect(b.client.run.mock.calls.every(([action]) => ['snapshot', 'saveRuleDetails'].includes(action))).toBe(true);
  await first.unmount();
  await render(<ScreenTimeProvider client={b.client}><ProductHome /></ScreenTimeProvider>);
  expect(await screen.findByText('夜の余白')).toBeTruthy(); expect(screen.getByText('合成の行動目標\n自分の時間を大切にする')).toBeTruthy();
});
test('a storage failure keeps the full input for retry; long input cannot be submitted', async () => {
  const b = backend(); b.fail('storage-failed');
  await render(<ScreenTimeProvider client={b.client}><RuleDetailsScreen ruleID={id} /></ScreenTimeProvider>);
  await input(); await press('保存する');
  expect(mockBack).not.toHaveBeenCalled(); expect(screen.getByLabelText('ルール名（任意）')).toHaveDisplayValue('夜の余白');
  await fireEvent.changeText(screen.getByLabelText('ルール名（任意）'), 'あ'.repeat(81));
  expect(screen.getByRole('button', { name: '保存する' })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('ルール名（任意）'), '夜の余白'); await press('保存する');
  expect(mockBack).toHaveBeenCalledTimes(1);
});
test('a conflict keeps the draft and requires viewing current saved values before an explicit overwrite', async () => {
  const b = backend(); await render(<ScreenTimeProvider client={b.client}><RuleDetailsScreen ruleID={id} /></ScreenTimeProvider>);
  await input(); b.change(); b.fail('changed'); await press('保存する');
  expect(screen.getByRole('button', { name: '保存する' })).toBeDisabled();
  await press('最新の保存内容を確認する');
  expect(screen.getByText('別の保存内容')).toBeTruthy(); expect(screen.getByLabelText('ルール名（任意）')).toHaveDisplayValue('夜の余白');
  await press('入力した内容で保存する');
  expect(b.client.run.mock.calls.filter(([action]) => action === 'saveRuleDetails').at(-1)![1]?.details?.expectedRevision).toBe('1');
  expect(mockBack).toHaveBeenCalledTimes(1);
});
test('cancelling dirty input asks before discard and never persists it', async () => {
  const b = backend(), alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<ScreenTimeProvider client={b.client}><RuleDetailsScreen ruleID={id} /></ScreenTimeProvider>);
  await input(); await press('キャンセル');
  expect(mockBack).not.toHaveBeenCalled(); expect(alert).toHaveBeenCalledWith('入力を破棄して戻りますか', expect.any(String), expect.any(Array));
  await act(async () => alert.mock.calls.at(-1)![2]![1].onPress?.());
  expect(mockBack).toHaveBeenCalledTimes(1); expect(b.client.run.mock.calls.every(([action]) => action === 'snapshot')).toBe(true);
  alert.mockRestore();
});
test('an unregistered goal is omitted instead of generating a purpose', async () => {
  const b = backend(); await render(<ScreenTimeProvider client={b.client}><ProductHome /></ScreenTimeProvider>);
  await screen.findByText('時間帯 1'); expect(screen.queryByTestId('rule-goal')).toBeNull();
});

test('an accepted save finishes after departure without navigating another screen backwards', async () => {
  const b = backend();
  const view = await render(<ScreenTimeProvider client={b.client}><RuleDetailsScreen ruleID={id} /></ScreenTimeProvider>);
  await input();
  let finish!: (value: ScreenTimeResponse) => void;
  b.client.run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await press('保存する');
  await view.unmount();
  await act(async () => { finish({ status: 'ok', impacts: [], snapshot: b.current() }); });
  expect(mockBack).not.toHaveBeenCalled();
});
