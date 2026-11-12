import { DatePicker, Host } from '@expo/ui/swift-ui';
import { accessibilityLabel, datePickerStyle, environment, labelsHidden, tint } from '@expo/ui/swift-ui/modifiers';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { pickerDate, pickerTime } from '@/lib/schedule-time';
import { useFlowTheme } from './ui';

export type TimePickerProps = { label: string; value: string; onChange: (value: string) => void };
export function TimePicker({ label, value, onChange }: TimePickerProps) {
  const theme = useFlowTheme(), scheme = useColorScheme();
  return <Host style={{ width: '100%' }} matchContents={{ vertical: true }} colorScheme={scheme === 'dark' ? 'dark' : 'light'}>
    <DatePicker title={label} selection={pickerDate(value)} displayedComponents={['hourAndMinute']}
      modifiers={[datePickerStyle('wheel'), labelsHidden(), accessibilityLabel(label), environment('locale', 'ja_JP'), environment('timeZone', 'UTC'), tint(theme.accent)]}
      onDateChange={date => { const time = pickerTime(date); if (time) onChange(time); }} />
  </Host>;
}
