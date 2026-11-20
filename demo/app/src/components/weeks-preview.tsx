import { Pressable, Text, View } from 'react-native';
import { Body, useFlowTheme } from '@/components/flow/ui';
import { reflectionDuration } from '../../../../modules/itoma-native/src/reflection-model';
import { useDemo } from '../state/demo';
import { shortDate, sumKnown, weekStart } from '../scenarios/records';
import { weekContributions } from '../scenarios/visual-options';
import { Frame } from './frame';
import { Caption, SectionTitle, TotalCard, styles } from './visual-shared';
export function WeeksPreview() {
  const { dataset, anchor, openWeek } = useDemo(), theme = useFlowTheme(), weeks = weekContributions(dataset.days), total = sumKnown(dataset.days), colors = [theme.accent, theme.muted, theme.purposeMotif];
  return <Frame title="振り返り" tab="reflection"><TotalCard>
    {total === undefined ? <Body muted>まだ時間の記録がありません。</Body> : total === 0 ? <Body muted>記録した時間は0分です。</Body> : <View testID="weekly-stack" accessible accessibilityRole="image" accessibilityLabel={`累計${reflectionDuration(total)}の週ごとの内訳。${weeks.map(value => `${shortDate(value.key)}からの週、${reflectionDuration(value.seconds)}`).join('。')}`}>
      <View accessible={false} aria-hidden style={{ height: 48, flexDirection: 'row', borderRadius: 8, overflow: 'hidden' }}>{weeks.map((week, n) => !week.seconds ? null : <View key={week.key} style={{ width: `${week.seconds / total * 100}%`, backgroundColor: colors[n % colors.length], borderRightWidth: 2, borderRightColor: theme.background, alignItems: 'center', justifyContent: 'center' }}>{week.seconds / total > 0.12 && <Text style={{ color: theme.onAccent, fontSize: 13 }}>{n + 1}</Text>}</View>)}</View>
    </View>}
    <Caption>週ごとの記録を、1本の帯につなげています。</Caption>
  </TotalCard><SectionTitle>どの週に積み上がったか</SectionTitle><Caption>週を選ぶと、その週の日ごとの記録を確認できます。</Caption>
    {weeks.length ? weeks.map((week, n) => { const selected = weekStart(anchor) === week.key; return <View key={week.key} style={{ borderWidth: selected ? 2 : 1, borderColor: selected ? theme.accent : theme.line, borderRadius: 16, overflow: 'hidden' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${shortDate(week.key)}からの週を見る`} accessibilityState={{ expanded: selected }} onPress={() => openWeek(week.key)} style={{ minHeight: 68, padding: 16, gap: 8 }}>
        <View style={styles.navigation}><Text style={{ color: theme.text, fontSize: 15, lineHeight: 24 }}>{n + 1}　{shortDate(week.key)}からの週</Text><Text style={{ color: theme.text, fontSize: 17, lineHeight: 26 }}>{reflectionDuration(week.seconds)}</Text></View>
        {(selected || week.partial) && <Caption>{selected ? '表示中' : ''}{week.partial ? ' · 一部未記録' : ''}</Caption>}
      </Pressable>
      {selected && <View testID="selected-week-days" style={{ paddingHorizontal: 16, paddingBottom: 12 }}>{week.days.map(record => <View key={record.day} style={[styles.detailRow, { borderColor: theme.line }]}><Text style={{ color: theme.text, fontSize: 13, lineHeight: 21 }}>{shortDate(record.day)}</Text><Caption>{record.seconds === undefined ? '未記録' : reflectionDuration(record.seconds)}</Caption></View>)}</View>}
    </View>; }) : <Body muted>週ごとの記録はまだありません。</Body>}
  </Frame>;
}
