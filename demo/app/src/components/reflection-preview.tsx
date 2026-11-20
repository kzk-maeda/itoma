import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Body, useFlowTheme } from '@/components/flow/ui';
import { PeriodSelector, PeriodTransition } from '@/components/flow/period-transition';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { reflectionDuration } from '../../../../modules/itoma-native/src/reflection-model';
import { useDemo } from '../state/demo';
import { periodRows, selectedDays, shiftAnchor, shortDate, sumKnown, weekStart } from '../scenarios/records';
import { CumulativeChart } from './cumulative-chart';
import { Frame } from './frame';
export function ReflectionPreview() {
  const { dataset, period, setPeriod, anchor, setAnchor } = useDemo(), theme = useFlowTheme(), reduced = useReducedMotion();
  const [direction, setDirection] = useState<-1 | 1>(1), [refreshed, setRefreshed] = useState(false);
  const total = sumKnown(dataset.days), rows = periodRows(dataset.days, period, anchor), selected = sumKnown(selectedDays(dataset.days, period, anchor));
  const hasGap = dataset.days.some(record => record.seconds === undefined), max = Math.max(1, ...rows.map(row => row.seconds ?? 0));
  const previous = shiftAnchor(anchor, period, -1), next = shiftAnchor(anchor, period, 1);
  const canPrevious = selectedDays(dataset.days, period, previous).length > 0, canNext = selectedDays(dataset.days, period, next).length > 0;
  const navigate = (to: string, dir: -1 | 1) => { setDirection(dir); setAnchor(to); };
  return <Frame title="振り返り" tab="reflection">
    <View style={{ alignItems: 'flex-end' }}><Pressable accessibilityRole="button" accessibilityLabel="集計を更新" onPress={() => setRefreshed(true)} style={{ minHeight: 44, flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 8 }}>
      <Text accessible={false} style={{ color: theme.muted, fontSize: 22 }}>↻</Text><Text style={[styles.caption, { color: theme.muted }]}>集計を更新</Text>
    </Pressable>{refreshed && <Text style={[styles.caption, { color: theme.muted }]}>架空の記録を再表示しました</Text>}</View>
    <View testID="total-card" style={[styles.totalCard, { backgroundColor: theme.background }]}>
      <Text style={[styles.caption, { color: theme.muted }]}>制限の適用を記録した時間</Text>
      <Text testID="reflection-total" style={[styles.total, { color: theme.text }]}>{reflectionDuration(total)}</Text>
      <Text style={[styles.caption, { color: theme.muted }]}>記録全体の累計 · 一時解除を除く</Text>
      {hasGap && <Text style={[styles.caption, { color: theme.text }]}>記録の一部がありません</Text>}
      <CumulativeChart records={dataset.days} />
    </View>
    <View style={{ gap: 6 }}><Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>期間ごとに見る</Text><Text style={[styles.caption, { color: theme.muted }]}>選んだ期間に記録した時間の内訳です。</Text></View>
    <PeriodSelector selected={period} onSelect={value => { setDirection(value === 'month' ? 1 : -1); setPeriod(value); }} disabled={dataset.days.length === 0} reduced={reduced} theme={theme} />
    <PeriodTransition transitionKey={`${dataset.id}:${period}:${anchor}`} direction={direction} reduced={reduced} busy={false}>
      <View style={styles.periodNavigation}>
        <Pressable accessibilityRole="button" accessibilityLabel="前の期間" accessibilityState={{ disabled: !canPrevious }} disabled={!canPrevious} onPress={() => navigate(previous, -1)} style={[styles.round, { borderColor: theme.muted, opacity: canPrevious ? 1 : 0.4 }]}><Text style={{ color: theme.text, fontSize: 24 }}>‹</Text></Pressable>
        <Text testID="period-title" accessibilityRole="header" style={[styles.periodTitle, { color: theme.text }]}>{period === 'week' ? `${shortDate(weekStart(anchor))}からの週` : `${Number(anchor.slice(5, 7))}月`}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="次の期間" accessibilityState={{ disabled: !canNext }} disabled={!canNext} onPress={() => navigate(next, 1)} style={[styles.round, { borderColor: theme.muted, opacity: canNext ? 1 : 0.4 }]}><Text style={{ color: theme.text, fontSize: 24 }}>›</Text></Pressable>
      </View>
      <View style={styles.periodSummary}><Text style={[styles.caption, { color: theme.muted }]}>{period === 'week' ? 'この週' : 'この月'}の記録</Text><Text testID="period-total" style={{ fontSize: 25, lineHeight: 36, color: theme.text }}>{reflectionDuration(selected)}</Text></View>
      <View>{rows.map(row => <View key={row.key} style={[styles.record, { borderColor: theme.line }]}>
        <View style={styles.recordLabels}><Text style={[styles.caption, { color: theme.text }]}>{row.label}</Text><Text style={[styles.caption, { color: theme.muted }]}>{row.seconds === undefined ? '未記録' : reflectionDuration(row.seconds)}{row.partial && row.seconds !== undefined ? ' · 一部不明' : ''}</Text></View>
        <View accessible={false} style={[styles.track, { backgroundColor: theme.background }]}>{row.seconds !== undefined && <View style={{ height: 8, borderRadius: 4, width: `${row.seconds / max * 100}%`, backgroundColor: theme.accent }} />}</View>
      </View>)}</View>
      {!rows.length && <Body muted>この期間の時間の記録はありません。</Body>}
    </PeriodTransition>
  </Frame>;
}
const styles = StyleSheet.create({
  caption: { fontSize: 13, lineHeight: 21 }, heading: { fontSize: 16, lineHeight: 26, fontWeight: '600' },
  totalCard: { padding: 18, borderRadius: 18, gap: 12 }, total: { fontSize: 36, lineHeight: 52, fontWeight: '400', fontVariant: ['tabular-nums'] },
  periodNavigation: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }, round: { minWidth: 44, minHeight: 44, borderWidth: 1, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, periodTitle: { flex: 1, fontSize: 16, lineHeight: 26, fontWeight: '600', textAlign: 'center' },
  periodSummary: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  record: { minHeight: 54, paddingVertical: 12, borderBottomWidth: 1, gap: 8 }, recordLabels: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }, track: { height: 8, borderRadius: 4, overflow: 'hidden' },
});
