import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ScreenTimePoCScreen } from '../src/components/screen-time-poc-screen';
import { screenTimePoC } from '../modules/itoma-native';

jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }));
jest.mock('../src/global.css', () => ({}));
jest.mock('../modules/itoma-native', () => ({ screenTimePoC: { run: jest.fn() } }));
const run = screenTimePoC.run as jest.Mock;
const ref = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const snapshot = { availability: 'device-poc', authorization: 'approved', storage: 'ready',
  selections: [{ ref, applicationCount: 2, confirmedThisSession: true }], operation: 'idle', code: null, observation: 'unknown' };
beforeEach(() => { run.mockReset(); jest.restoreAllMocks(); });

test('Simulator cannot authorize, choose or create storage and never claims restrictions', async () => {
  run.mockResolvedValue({ status: 'snapshot', snapshot: { ...snapshot, availability: 'simulator-unavailable', authorization: 'unknown', storage: 'not-created', selections: [] } });
  await render(<ScreenTimePoCScreen />);
  expect(screen.getByText('Simulatorでは認可・アプリ選択・実制限を利用できません。')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Screen Timeの認可を要求' }));
  expect(run).toHaveBeenCalledTimes(1);
  expect(run).toHaveBeenCalledWith('snapshot', undefined);
});

test('applying requires explicit confirmation, cancellation does not apply', async () => {
  run.mockResolvedValue({ status: 'snapshot', snapshot });
  const confirm = jest.spyOn(Alert, 'alert');
  await render(<ScreenTimePoCScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'いま選んだ対象の手動制限を確認' }));
  expect(run).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledWith('いま選んだ対象を手動で制限しますか', expect.stringContaining('自動では終了しません'), expect.any(Array));
  await act(async () => { confirm.mock.calls[0][2]?.[1].onPress?.(); });
  expect(run).toHaveBeenLastCalledWith('apply', ref);
});

test('stop stays available when storage fails and an OS readback is not actual unblock proof', async () => {
  run.mockResolvedValueOnce({ status: 'snapshot', snapshot: { ...snapshot, storage: 'unavailable', selections: [] } });
  run.mockResolvedValue({ status: 'snapshot', snapshot: { ...snapshot, storage: 'unavailable', selections: [], operation: 'requested', observation: 'own-store-empty' } });
  await render(<ScreenTimePoCScreen />);
  await fireEvent.press(screen.getByRole('button', { name: '検証用の制限を停止' }));
  expect(run).toHaveBeenLastCalledWith('stop', undefined);
  expect(screen.getByText('この検証用の制限設定を消去しました。他の制限元や実際の解除状態は未確認です。')).toBeTruthy();
});

test('awaiting an authorization result suppresses duplicate submissions', async () => {
  run.mockResolvedValueOnce({ status: 'snapshot', snapshot });
  await render(<ScreenTimePoCScreen />);
  let finish!: (value: unknown) => void;
  run.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const button = screen.getByRole('button', { name: 'Screen Timeの認可を要求' });
  await fireEvent.press(button); await fireEvent.press(button);
  expect(run.mock.calls.filter(([action]) => action === 'authorize')).toHaveLength(1);
  await act(async () => { finish({ status: 'snapshot', snapshot: { ...snapshot, operation: 'cancelled' } }); });
  expect(screen.getByText('選択を取り消しました。保存と制限は変更していません。')).toBeTruthy();
});

test('previous saved selections cannot be applied by count or list position', async () => {
  run.mockResolvedValue({ status: 'snapshot', snapshot: { ...snapshot, selections: [
    { ref, applicationCount: 2, confirmedThisSession: false },
    { ref: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', applicationCount: 2, confirmedThisSession: true },
  ] } });
  await render(<ScreenTimePoCScreen />);
  expect(screen.getAllByRole('button', { name: 'いま選んだ対象の手動制限を確認' })).toHaveLength(1);
  expect(screen.getByText('保存した選択 1：2アプリ（再選択が必要）')).toBeTruthy();
});
