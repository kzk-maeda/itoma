import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, useFlowTheme } from './ui';
import { dateLabel } from './history-presentation';
export function HistoryCalendar({ initialDay, onChoose, onClose }: { initialDay: string; onChoose: (day: string) => void; onClose: () => void }) {
  const theme = useFlowTheme(), [month, setMonth] = useState(initialDay.slice(0, 7));
  const [year, number] = month.split('-').map(Number);
  const leading = new Date(Date.UTC(year, number - 1, 1)).getUTCDay(), count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const shift = (delta: number) => { const value = new Date(Date.UTC(year, number - 1 + delta, 1)); setMonth(value.toISOString().slice(0, 7)); };
  return <View style={[styles.calendar, { backgroundColor: theme.background }]}>
    <View style={styles.navigation}>
      <Pressable accessibilityRole="button" accessibilityLabel="前の月" onPress={() => shift(-1)} style={styles.arrow}><Text style={{ color: theme.text, fontSize: 24 }}>‹</Text></Pressable>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 17 }}>{year}年{number}月</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="次の月" onPress={() => shift(1)} style={styles.arrow}><Text style={{ color: theme.text, fontSize: 24 }}>›</Text></Pressable>
    </View>
    <View style={styles.grid}>{['日', '月', '火', '水', '木', '金', '土'].map(day => <Text key={day} style={[styles.weekday, { color: theme.muted }]}>{day}</Text>)}</View>
    <View style={styles.grid}>{Array.from({ length: leading + count }, (_, index) => {
      const day = index - leading + 1, value = `${month}-${String(day).padStart(2, '0')}`;
      return day < 1 ? <View key={index} style={styles.cell} /> : <Pressable key={index} accessibilityRole="button" accessibilityLabel={dateLabel(value)}
        accessibilityState={{ selected: value === initialDay }} aria-pressed={value === initialDay} onPress={() => onChoose(value)} style={styles.cell}>
        <Text style={[styles.day, { color: theme.text, backgroundColor: value === initialDay ? theme.soft : 'transparent' }]}>{day}</Text>
      </Pressable>;
    })}</View>
    <Button label="日付を選ばず閉じる" secondary onPress={onClose} />
  </View>;
}
const styles = StyleSheet.create({ calendar: { borderRadius: 16, marginHorizontal: -20, paddingVertical: 8, gap: 10 }, navigation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, weekday: { width: `${100 / 7}%`, textAlign: 'center', fontSize: 13 },
  day: { fontSize: 15, padding: 5, borderRadius: 6 } });
