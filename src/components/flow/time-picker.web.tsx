import { createElement } from 'react';
import { View } from 'react-native';
import type { TimePickerProps } from './time-picker';
import { useFlowTheme } from './ui';

/** Web proof fallback uses bounded selectors; iPhone renders the native wheel. */
export function TimePicker({ label, value, onChange }: TimePickerProps) {
  const theme = useFlowTheme();
  const select = (part: '時' | '分', limit: number, selected: string, update: (v: string) => string) => createElement('select', {
    'aria-label': `${label}の${part}`, value: selected, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange(update(e.target.value)),
    style: { minWidth: 80, minHeight: 52, maxWidth: '100%', fontSize: 20, padding: 12, color: theme.text, backgroundColor: theme.surface, borderColor: theme.muted, borderRadius: 8 },
  }, Array.from({ length: limit }, (_, n) => { const v = String(n).padStart(2, '0'); return createElement('option', { key: v, value: v }, `${v}${part}`); }));
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
    {select('時', 24, value.slice(0, 2), hour => `${hour}:${value.slice(3)}`)}
    {select('分', 60, value.slice(3), minute => `${value.slice(0, 2)}:${minute}`)}
  </View>;
}
