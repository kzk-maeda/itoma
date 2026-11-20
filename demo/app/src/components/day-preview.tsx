import { useId, useState } from 'react';
import { router, type Href } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import Svg, { Defs, Pattern, Path, Rect } from 'react-native-svg';
import { Body, Button, useFlowTheme } from '@/components/flow/ui';
import { reflectionDuration } from '../../../../modules/itoma-native/src/reflection-model';
import { useDemo } from '../state/demo';
import { moveDay, shortDate } from '../scenarios/records';
import { AS_OF, clockTime, dayBands, type Band } from '../scenarios/visual-options';
import { Frame } from './frame';
import { Caption, SectionTitle, TotalCard, styles } from './visual-shared';
const names = { none: '制限設定なし', restricted: '制限の記録', unlock: '一時解除', unknown: '未記録' };
function BandFill({ kind }: { kind: Band['kind'] }) {
  const theme = useFlowTheme(), id = 'band' + useId().replace(/:/g, '');
  if (kind === 'unknown') return <Svg width="100%" height="100%" aria-hidden><Defs><Pattern id={id} width={8} height={8} patternUnits="userSpaceOnUse"><Path d="M-2 2L2 -2M0 8L8 0M6 10L10 6" stroke={theme.muted} strokeWidth={1} /></Pattern></Defs><Rect width="100%" height="100%" fill={theme.soft} /><Rect width="100%" height="100%" fill={`url(#${id})`} /></Svg>;
  return <View style={{ flex: 1, backgroundColor: kind === 'restricted' ? theme.accent : kind === 'unlock' ? theme.surface : theme.soft, borderWidth: kind === 'unlock' ? 1 : 0, borderColor: theme.muted, borderStyle: 'dashed' }} />;
}
export function DayPreview() {
  const { dataset, selectedDay, selectDay } = useDemo(), theme = useFlowTheme(), [focus, setFocus] = useState(true);
  const record = dataset.days.find(value => value.day === selectedDay), bands = dayBands(record), events = bands.filter(value => value.kind !== 'none');
  const restricted = bands.filter(value => value.kind === 'restricted'), from = focus && restricted.length ? restricted[0].from : 0, until = focus && restricted.length ? restricted.at(-1)!.until : 1440;
  const previous = moveDay(selectedDay, -1), next = moveDay(selectedDay, 1), first = dataset.days[0]?.day ?? AS_OF;
  return <Frame title="振り返り" tab="reflection"><TotalCard /><SectionTitle>1日の時間帯</SectionTitle>
    <View style={styles.navigation}>
      <Pressable accessibilityRole="button" accessibilityLabel="前の日" accessibilityState={{ disabled: previous < first }} disabled={previous < first} onPress={() => selectDay(previous)} style={[styles.arrow, { borderColor: theme.muted }]}><Text style={{ fontSize: 24, color: theme.text }}>‹</Text></Pressable>
      <Text testID="timeline-date" style={[styles.periodTitle, { color: theme.text }]}>{shortDate(selectedDay)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="次の日" accessibilityState={{ disabled: next > AS_OF }} disabled={next > AS_OF} onPress={() => selectDay(next)} style={[styles.arrow, { borderColor: theme.muted }]}><Text style={{ fontSize: 24, color: theme.text }}>›</Text></Pressable>
    </View>
    <View style={styles.navigation}><Caption>この日の記録 · 一時解除を除く</Caption><Text testID="timeline-total" style={{ fontSize: 28, lineHeight: 40, color: theme.text }}>{reflectionDuration(record?.seconds)}</Text></View>
    <View style={{ flexDirection: 'row', gap: 8 }}>{[{ label: '1日全体', value: false }, { label: '記録した時間帯', value: true }].map(option => <Pressable key={option.label} accessibilityRole="button" aria-pressed={focus === option.value} onPress={() => setFocus(option.value)} style={{ flex: 1, minHeight: 44, padding: 10, borderWidth: 1, borderColor: focus === option.value ? theme.accent : theme.line, borderRadius: 10, backgroundColor: focus === option.value ? theme.soft : 'transparent', justifyContent: 'center' }}><Text style={{ fontSize: 13, lineHeight: 21, color: theme.text, textAlign: 'center' }}>{option.label}</Text></Pressable>)}</View>
    <View testID="day-timeline" accessible accessibilityRole="image" accessibilityLabel={`${shortDate(selectedDay)}の時間帯。${events.length ? events.map(value => `${clockTime(value.from)}から${clockTime(value.until)}、${names[value.kind]}`).join('。') : '制限の記録は0分です。'}`}>
      <View accessible={false} aria-hidden style={{ height: 40, flexDirection: 'row', borderRadius: 8, overflow: 'hidden' }}>{bands.map((value, n) => {
        const start = Math.max(from, value.from), end = Math.min(until, value.until);
        return end <= start ? null : <View key={n} style={{ width: `${(end - start) / (until - from) * 100}%` }}><BandFill kind={value.kind} /></View>;
      })}</View>
      <View style={styles.navigation}><Caption>{clockTime(from)}</Caption><Caption>{clockTime((from + until) / 2)}</Caption><Caption>{clockTime(until)}</Caption></View>
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{(['restricted', 'unlock', 'unknown'] as const).map(kind => <View key={kind} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><View accessible={false} style={{ width: 18, height: 16, overflow: 'hidden', borderRadius: 2 }}><BandFill kind={kind} /></View><Caption>{names[kind]}</Caption></View>)}</View>
    <View>{events.length ? events.map((value, n) => <View key={n} style={[styles.detailRow, { borderColor: theme.line }]}><Text style={{ color: theme.text, fontSize: 14, lineHeight: 23 }}>{clockTime(value.from)}〜{clockTime(value.until)}</Text><Caption>{names[value.kind]}{value.kind !== 'unknown' ? ` · ${reflectionDuration((value.until - value.from) * 60)}` : ''}</Caption></View>) : <Body muted>この日の集計対象の制限時間は0分です。</Body>}</View>
    <Button secondary label="カレンダーに戻る" onPress={() => router.dismissTo('/calendar' as Href)} />
  </Frame>;
}
