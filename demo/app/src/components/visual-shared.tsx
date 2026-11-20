import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Body, useFlowTheme } from '@/components/flow/ui';
import { PeriodSelector } from '@/components/flow/period-transition';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { reflectionDuration } from '../../../../modules/itoma-native/src/reflection-model';
import { useDemo } from '../state/demo';
import { selectedDays, shiftAnchor, shortDate, sumKnown, weekStart } from '../scenarios/records';
export function TotalCard({ children }: { children?: ReactNode }) {
  const { dataset } = useDemo(), theme = useFlowTheme(), total = sumKnown(dataset.days);
  return <View style={[styles.card, { backgroundColor: theme.background }]}>
    <Text style={[styles.caption, { color: theme.muted }]}>記録した制限時間の累計</Text><Text testID="visual-total" style={[styles.total, { color: theme.text }]}>{reflectionDuration(total)}</Text>
    <Text style={[styles.caption, { color: theme.muted }]}>記録全体 · 一時解除を除く</Text>
    {dataset.days.some(value => value.seconds === undefined) && <Body muted>確認できた時間だけを表示しています。</Body>}{children}
  </View>;
}
export function SectionTitle({ children }: { children: ReactNode }) { const theme = useFlowTheme(); return <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>{children}</Text>; }
export function Caption({ children }: { children: ReactNode }) { const theme = useFlowTheme(); return <Text style={[styles.caption, { color: theme.muted }]}>{children}</Text>; }
export function PeriodControls({ onNavigate }: { onNavigate?: (anchor: string) => void }) {
  const { dataset, period, setPeriod, anchor, setAnchor } = useDemo(), theme = useFlowTheme(), reduced = useReducedMotion();
  const prev = shiftAnchor(anchor, period, -1), next = shiftAnchor(anchor, period, 1);
  const change = (value: string) => { setAnchor(value); onNavigate?.(value); };
  return <View style={{ gap: 16 }}><PeriodSelector selected={period} onSelect={setPeriod} disabled={dataset.days.length === 0} reduced={reduced} theme={theme} />
    <View style={styles.navigation}>
      <Pressable accessibilityRole="button" accessibilityLabel="前の期間" accessibilityState={{ disabled: selectedDays(dataset.days, period, prev).length === 0 }} disabled={!selectedDays(dataset.days, period, prev).length} onPress={() => change(prev)} style={[styles.arrow, { borderColor: theme.muted }]}><Text style={{ fontSize: 24, color: theme.text }}>‹</Text></Pressable>
      <Text testID="visual-period-title" style={[styles.periodTitle, { color: theme.text }]}>{period === 'week' ? `${shortDate(weekStart(anchor))}からの週` : `${Number(anchor.slice(0, 4))}年${Number(anchor.slice(5, 7))}月`}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="次の期間" accessibilityState={{ disabled: selectedDays(dataset.days, period, next).length === 0 }} disabled={!selectedDays(dataset.days, period, next).length} onPress={() => change(next)} style={[styles.arrow, { borderColor: theme.muted }]}><Text style={{ fontSize: 24, color: theme.text }}>›</Text></Pressable>
    </View>
  </View>;
}
export function PeriodBreakdown() {
  const { dataset, period, anchor } = useDemo(), theme = useFlowTheme(), records = selectedDays(dataset.days, period, anchor), sum = sumKnown(records);
  return <View style={{ gap: 16 }}><SectionTitle>期間ごとに見る</SectionTitle><PeriodControls />
    <View style={styles.navigation}><Caption>{period === 'week' ? 'この週' : 'この月'}の記録</Caption><Text testID="visual-period-total" style={{ fontSize: 24, lineHeight: 34, color: theme.text }}>{reflectionDuration(sum)}</Text></View>
    {records.length ? records.map(value => <View key={value.day} style={[styles.detailRow, { borderColor: theme.line }]}><Text style={{ color: theme.text, fontSize: 14, lineHeight: 22 }}>{shortDate(value.day)}</Text><Caption>{value.seconds === undefined ? '未記録' : reflectionDuration(value.seconds)}</Caption></View>) : <Body muted>この期間の記録はありません。</Body>}
  </View>;
}
export const styles = StyleSheet.create({
  card: { padding: 18, borderRadius: 18, gap: 14 }, caption: { fontSize: 13, lineHeight: 21 }, total: { fontSize: 36, lineHeight: 52, fontVariant: ['tabular-nums'] }, heading: { fontSize: 17, lineHeight: 27, fontWeight: '600' },
  navigation: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, arrow: { minWidth: 44, minHeight: 44, borderWidth: 1, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, periodTitle: { flex: 1, fontSize: 15, lineHeight: 24, textAlign: 'center', fontWeight: '500' }, detailRow: { minHeight: 44, paddingVertical: 10, borderBottomWidth: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
});
