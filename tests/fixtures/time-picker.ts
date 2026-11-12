import { fireEvent, screen } from '@testing-library/react-native';
import { pickerDate } from '../../src/lib/schedule-time';

export async function selectTime(label: '開始時刻' | '終了時刻', value: string) {
  await fireEvent.press(screen.getByRole('button', { name: label }));
  await fireEvent(screen.getByTestId('native-time-picker'), 'dateChange', pickerDate(value));
  await fireEvent.press(screen.getByRole('button', { name: 'この時刻にする' }));
}
