import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Body, useFlowTheme } from '@/components/flow/ui';
import { PeriodSelector } from '@/components/flow/period-transition';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { reflectionDuration } from '../../../../modules/itoma-native/src/reflection-model';
import { periodRows, selectedDays, shiftAnchor, shortDate, sumKnown, weekStart } from '../scenarios/records';
import { durationWords, growthMilestones, growthReadout } from '../scenarios/time-growth';
import { useGrowth } from '../state/time-growth';
import { Frame } from './frame';
import { GrowthCircle } from './growth-circle';
import { Caption, SectionTitle, styles } from './visual-shared';
function GrowthPeriod() {
  const { records, period, setPeriod, anchor, setAnchor } = useGrowth(), theme = useFlowTheme(), reduced = useReducedMotion();
  const previous = shiftAnchor(anchor, period, -1), next = shiftAnchor(anchor, period, 1), rows = periodRows(records, period, anchor), max = Math.max(1, ...rows.map(value => value.seconds ?? 0));
  return <View style={{ gap: 18 }}><SectionTitle>期間ごとに見る</SectionTitle><PeriodSelector selected={period} onSelect={setPeriod} disabled={!records.length} reduced={reduced} theme={theme} />
    <View style={styles.navigation}>{[-1, 1].map(direction => { const value = direction === -1 ? previous : next, disabled = !selectedDays(records, period, value).length;
      const button = <Pressable key={direction} accessibilityRole="button" accessibilityLabel={direction === -1 ? '前の期間' : '次の期間'} accessibilityState={{ disabled }} disabled={disabled} onPress={() => setAnchor(value)} style={[styles.arrow, { borderColor: theme.muted, opacity: disabled ? 0.4 : 1 }]}><Text style={{ color: theme.text, fontSize: 24 }}>{direction === -1 ? '‹' : '›'}</Text></Pressable>;
      return direction === -1 ? <View key={direction} style={{ flex: 1, flexDirection: 'row', gap: 12, alignItems: 'center' }}>{button}<Text testID="growth-period-title" style={[styles.periodTitle, { color: theme.text }]}>{period === 'week' ? `${shortDate(weekStart(anchor))}からの週` : `${Number(anchor.slice(0, 4))}年${Number(anchor.slice(5, 7))}月`}</Text></View> : button;
    })}</View>
    <View style={styles.navigation}><Caption>{period === 'week' ? 'この週' : 'この月'}の記録</Caption><Text testID="growth-period-total" style={{ color: theme.text, fontSize: 24, lineHeight: 36 }}>{reflectionDuration(sumKnown(selectedDays(records, period, anchor)))}</Text></View>
    {rows.length ? rows.map(row => <View key={row.key} style={{ gap: 9, paddingVertical: 6 }}><View style={styles.navigation}><Caption>{row.label}</Caption><Text style={{ color: theme.text, fontSize: 14, lineHeight: 22 }}>{row.seconds === undefined ? '未記録' : reflectionDuration(row.seconds)}{row.partial && row.seconds !== undefined ? ' · 一部未記録' : ''}</Text></View><View accessible={false} style={{ height: 5, borderRadius: 3, backgroundColor: theme.soft }}>{row.seconds !== undefined && <View style={{ height: 5, borderRadius: 3, width: `${row.seconds / max * 100}%`, backgroundColor: theme.accent }} />}</View></View>) : <Body muted>この期間の記録はありません。</Body>}
  </View>;
}
export function TimeGrowthPreview() {
  const { records, scene } = useGrowth(), theme = useFlowTheme(), [details, setDetails] = useState(false);
  const total = sumKnown(records), readout = growthReadout(total), milestones = growthMilestones(records), partial = records.some(value => value.seconds === undefined);
  const message = total === undefined ? 'これから、自分の時間を。' : total === 0 ? 'ここから、少しずつ。' : readout!.kind === 'hours' ? '少しずつ、自分の時間へ。' : readout!.kind === 'days' ? `まる${readout!.whole}日分にもなる、自分の時間。` : readout!.kind === 'months' ? 'ひと月分にもなる、自分の時間。' : '一年分にもなる、自分の時間。';
  return <Frame title="振り返り" tab="reflection">
    <View style={{ alignItems: 'center', gap: 7, marginTop: 4 }}><Text style={{ color: theme.muted, fontSize: 13, lineHeight: 21 }}>自分の時間が、ここまで。</Text><Text testID="growth-message" accessibilityRole="header" style={{ color: theme.text, fontSize: 19, lineHeight: 31, textAlign: 'center', fontWeight: '500' }}>{message}</Text></View>
    <GrowthCircle seconds={total} />
    <View style={{ alignItems: 'center', gap: 7 }}><Caption>記録した制限時間の累計 · 一時解除を除く</Caption>{partial && <Text testID="growth-partial" style={{ color: theme.text, fontSize: 14, lineHeight: 23, textAlign: 'center' }}>一部未記録のため、確認できた時間だけです。</Text>}<Text style={{ color: theme.muted, fontSize: 13, lineHeight: 22, textAlign: 'center' }}>{total === undefined ? 'まだ記録がありません。' : total === 0 ? '記録はあります。集計対象の時間は0分です。' : readout!.kind === 'hours' ? '離れた時間が重なって、やがて1日分に。' : '日々の小さな時間が、まとまった長さに。'}</Text></View>
    <View style={{ padding: 18, borderRadius: 18, backgroundColor: theme.purposeSurface, gap: 10 }}><Text style={{ color: theme.text, fontSize: 15, lineHeight: 25 }}>{total === undefined || total === 0 ? '自分で決めた時間を、ここに重ねていけます。' : readout!.kind === 'hours' ? '1時間、また1時間。自分のために使える時間を、少しずつ。' : `いくつもの日常の中で、${readout!.approximate ? '約' : ''}${readout!.whole}${readout!.label}${readout!.remainder ? `と${durationWords(readout!.remainder)}` : ''}の長さになりました。`}</Text><Caption>少しずつ離れた時間を合算して、長さに換算しています。</Caption></View>
    <View style={{ borderBottomWidth: 1, borderColor: theme.line, paddingBottom: 16 }}><Pressable accessibilityRole="button" accessibilityLabel="時間の内訳と換算方法" accessibilityState={{ expanded: details }} onPress={() => setDetails(!details)} style={{ minHeight: 44, justifyContent: 'center' }}><View style={styles.navigation}><Text style={{ color: theme.text, fontSize: 14, lineHeight: 23 }}>時間の内訳・換算方法</Text><Text style={{ color: theme.muted, fontSize: 18 }}>{details ? '−' : '＋'}</Text></View></Pressable>
      {details && <View testID="growth-details" style={{ gap: 12, paddingTop: 8 }}><Text testID="growth-exact-total" style={{ color: theme.text, fontSize: 20, lineHeight: 32 }}>{reflectionDuration(total)}</Text><Caption>1日分＝24時間。月は30日、年は365日を目安に換算するため「約」を付けています。暦の月数・年数ではありません。</Caption><Caption>中央はまとまった時間、円弧はその端数です。「時間分」の間は、24時間の中に積み重ねた長さを示します。</Caption><Caption>記録が示すのは制限の適用を確認した時間です。その時間を何に使ったかは記録していません。</Caption><Caption>このデモでは1日最大4時間の合成記録を使用。確認日は2026/11/20、月/年の換算方式は提案段階です。</Caption></View>}
    </View>
    {!!milestones.length && <View style={{ gap: 14 }}><SectionTitle>時間がまとまった節目</SectionTitle><Caption>{partial ? '確認できた記録で、この長さになった日です。' : '累計が、この長さになった日です。'}</Caption><View testID="growth-milestones" style={{ gap: 0 }}>{milestones.map((value, index) => <View key={value.label} style={{ minHeight: 54, flexDirection: 'row', gap: 16 }}><View accessible={false} style={{ alignItems: 'center', width: 16 }}><View style={{ marginTop: 7, width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: theme.accent, backgroundColor: index === milestones.length - 1 ? theme.accent : theme.surface }} />{index < milestones.length - 1 && <View style={{ width: 1, flex: 1, backgroundColor: theme.line }} />}</View><View style={[styles.navigation, { flex: 1, alignItems: 'flex-start', paddingBottom: 16 }]}><Text style={{ color: theme.text, fontSize: 16, lineHeight: 26 }}>{value.label}</Text><Caption>{value.day.replaceAll('-', '/')}</Caption></View></View>)}</View></View>}
    <GrowthPeriod />
    <Text accessible={false} style={{ fontSize: 11, lineHeight: 18, color: theme.muted }}>架空データ · {scene.label}</Text>
  </Frame>;
}
