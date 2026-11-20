import { router, type Href } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Body, Button, useFlowTheme } from '@/components/flow/ui';
import { reflectionDuration } from '../../../../modules/itoma-native/src/reflection-model';
import { useDemo } from '../state/demo';
import { selectedDays, shortDate, sumKnown } from '../scenarios/records';
import { AS_OF, calendarCells } from '../scenarios/visual-options';
import { Frame } from './frame';
import { Caption, PeriodControls, SectionTitle, TotalCard, styles } from './visual-shared';
export function CalendarPreview() {
  const { dataset, period, anchor, selectedDay, selectDay } = useDemo(), theme = useFlowTheme(), cells = calendarCells(period, anchor), record = dataset.days.find(value => value.day === selectedDay);
  const max = Math.max(1, ...dataset.days.map(value => value.seconds ?? 0)), total = sumKnown(selectedDays(dataset.days, period, anchor));
  return <Frame title="振り返り" tab="reflection"><TotalCard /><SectionTitle>記録をカレンダーで見る</SectionTitle><PeriodControls onNavigate={value => selectDay(selectedDays(dataset.days, period, value).at(-1)?.day ?? value)} />
    <View style={styles.navigation}><Caption>{period === 'week' ? 'この週' : 'この月'}の記録</Caption><Text testID="calendar-period-total" style={{ fontSize: 24, lineHeight: 34, color: theme.text }}>{reflectionDuration(total)}</Text></View>
    <View style={{ marginHorizontal: -20 }}>
      <View style={{ flexDirection: 'row' }}>{['月', '火', '水', '木', '金', '土', '日'].map(value => <Text key={value} style={{ width: '14.2857%', color: theme.muted, fontSize: 12, lineHeight: 24, textAlign: 'center' }}>{value}</Text>)}</View>
      <View testID="record-calendar" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{cells.map((date, n) => {
        if (!date) return <View key={`empty-${n}`} style={{ width: '14.2857%' }} />;
        const value = dataset.days.find(day => day.day === date), future = date > AS_OF, selected = selectedDay === date, status = future ? '未到来' : value?.seconds === undefined ? '未記録' : reflectionDuration(value.seconds);
        return <Pressable key={date} testID={`calendar-${date}`} accessibilityRole="button" accessibilityLabel={`${shortDate(date)}、${status}`} accessibilityState={{ selected, disabled: future }} disabled={future} onPress={() => selectDay(date)} style={{ width: '14.2857%', minHeight: 78, padding: 2 }}>
          <View style={{ flex: 1, padding: 3, gap: 5, alignItems: 'center', justifyContent: 'center', borderWidth: selected ? 2 : 1, borderStyle: !future && value?.seconds === undefined ? 'dashed' : 'solid', borderColor: selected ? theme.accent : theme.line, borderRadius: 9, opacity: future ? 0.45 : 1, overflow: 'hidden' }}>
            {!!value?.seconds && <View accessible={false} style={{ position: 'absolute', inset: 0, backgroundColor: theme.accent, opacity: 0.06 + value.seconds / max * 0.18 }} />}
            <Text style={{ fontSize: 14, lineHeight: 22, fontWeight: selected ? '700' : '400', textDecorationLine: selected ? 'underline' : 'none', color: theme.text }}>{Number(date.slice(8))}</Text>
            <Text style={{ fontSize: 11, lineHeight: 18, color: theme.muted, textAlign: 'center' }}>{future ? '未到来' : value?.seconds === undefined ? '—' : `${Math.floor(value.seconds / 60)}分`}</Text>
          </View>
        </Pressable>;
      })}</View>
    </View><Caption>数字はその日の分数。濃いほど長い記録です。0分は記録済み、— は未記録です。</Caption>
    <View testID="calendar-detail" style={[styles.card, { backgroundColor: theme.background }]}><SectionTitle>{shortDate(selectedDay)}の記録</SectionTitle>
      <Text testID="calendar-day-total" style={{ fontSize: 28, lineHeight: 40, color: theme.text }}>{record?.seconds === undefined ? '未記録' : reflectionDuration(record.seconds)}</Text>
      <Body muted>{record?.seconds === undefined ? 'この日の時間を0分としていません。' : '一時解除の時間を除いた記録です。'}</Body>
      <Button secondary label="時間帯を見る" onPress={() => router.dismissTo('/day' as Href)} />
    </View>
  </Frame>;
}
