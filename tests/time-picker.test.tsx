import { fireEvent, render, screen } from '@testing-library/react-native';
import { ScheduleFields } from '../src/components/flow/schedule-fields';
import { TimeField } from '../src/components/flow/time-field';
import { pickerDate, pickerTime, timeRange } from '../src/lib/schedule-time';
import { ruleInput } from '../src/state/screen-time';
import { ruleText } from '../src/components/flow/presentation';
import { selectTime } from './fixtures/time-picker';

jest.mock('../modules/itoma-native', () => ({ screenTime: { run: jest.fn() } }));
jest.mock('expo-router', () => ({ router: {} }));
jest.mock('../src/global.css', () => ({}));

test('clock ranges infer overnight, same-day and explicit 24 hours without a calendar date', () => {
  for (const [start, end, nextDay, minutes] of [['21:00', '23:00', false, 120], ['23:59', '00:00', true, 1], ['23:00', '02:00', true, 180], ['00:00', '00:00', true, 1440]] as const) {
    expect(timeRange(start, end)).toMatchObject({ nextDay, minutes });
    const draft = { selectionRef: 'synthetic', weekdays: [1], start, end, nextDay: !nextDay, enabled: true, dirty: true };
    expect(ruleInput(draft, '42')).toMatchObject({ nextDay, expectedRevision: '42' });
  }
  expect(timeRange('', '00:00')).toBeUndefined(); expect(timeRange('24:00', '00:00')).toBeUndefined();
  expect(timeRange('00:00', '00:00')?.label).toBe('00:00〜翌00:00（24時間）');
  expect(ruleText({ id: '', selectionRef: '', weekdays: [1], startMinute: 0, endMinute: 0, nextDay: true, enabled: true })).toBe('月 00:00〜翌00:00（24時間）');
  expect(pickerTime(pickerDate('02:30'))).toBe('02:30'); expect(pickerTime(pickerDate('23:59'))).toBe('23:59');
  expect(pickerTime(new Date(NaN))).toBeUndefined();
});
test('opening and cancelling the native wheel does not write a default or an intermediate change', async () => {
  const onChange = jest.fn(); await render(<TimeField label="開始時刻" value="" onChange={onChange} />);
  await fireEvent.press(screen.getByRole('button', { name: '開始時刻' }));
  await fireEvent(screen.getByTestId('native-time-picker'), 'dateChange', pickerDate('23:30'));
  expect(onChange).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'キャンセル' }));
  expect(screen.getByRole('button', { name: '開始時刻' }).props.accessibilityValue.text).toBe('未選択');
  expect(onChange).not.toHaveBeenCalled();
  await selectTime('開始時刻', '23:30'); expect(onChange).toHaveBeenCalledWith('23:30');
});
test('editing a saved time preselects it; confirm emits the inferred day and cancel preserves the previous window', async () => {
  const onChange = jest.fn(); const view = await render(<ScheduleFields start="23:30" end="00:30" onChange={onChange} />);
  expect(screen.getByText('設定する時間：23:30〜翌00:30')).toBeTruthy();
  expect(screen.queryByRole('switch', { name: '翌日に終了する' })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: '翌日に終了する' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: '終了時刻' }));
  expect(screen.getByTestId('native-time-picker').props.selection).toEqual(pickerDate('00:30'));
  await fireEvent.press(screen.getByRole('button', { name: 'キャンセル' })); expect(onChange).not.toHaveBeenCalled();
  await selectTime('終了時刻', '23:45'); expect(onChange).toHaveBeenLastCalledWith({ start: '23:30', end: '23:45', nextDay: false });
  await view.rerender(<ScheduleFields start="23:30" end="23:45" onChange={onChange} />);
  await selectTime('終了時刻', '23:30'); expect(onChange).toHaveBeenLastCalledWith({ start: '23:30', end: '23:30', nextDay: true });
  await view.rerender(<ScheduleFields start="23:30" end="23:30" disabled onChange={onChange} />);
  expect(screen.getByText('設定する時間：23:30〜翌23:30（24時間）')).toBeTruthy();
  expect(screen.getByRole('button', { name: '開始時刻' })).toBeDisabled();
});
