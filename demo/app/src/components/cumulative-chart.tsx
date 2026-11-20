import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { useFlowTheme } from '@/components/flow/ui';
import { reflectionDuration } from '../../../../modules/itoma-native/src/reflection-model';
import { sampleCumulative, shortDate, sumKnown, type DayRecord } from '../scenarios/records';
export function CumulativeChart({ records }: { records: DayRecord[] }) {
  const theme = useFlowTheme(), points = sampleCumulative(records), total = sumKnown(records);
  if (total === undefined) return <View testID="cumulative-empty" style={{ paddingVertical: 20, gap: 8 }}>
    <Text style={{ fontSize: 16, lineHeight: 26, color: theme.text }}>まだ時間の記録がありません</Text><Text style={{ fontSize: 13, lineHeight: 21, color: theme.muted }}>記録ができると、ここに積み上がりを表示します。</Text>
  </View>;
  const hours = total / 3600, rawStep = Math.max(hours, 1) / 3, power = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].find(value => value * power >= rawStep)! * power;
  const maximum = Math.max(step, Math.ceil(Math.max(hours, 1) / step) * step);
  const ticks = Array.from({ length: Math.round(maximum / step) + 1 }, (_, n) => maximum - n * step);
  const from = Date.parse(records[0].day), until = Date.parse(records[records.length - 1].day);
  const x = (date: string) => until === from ? 128 : 5 + (Date.parse(date) - from) / (until - from) * 246;
  const y = (seconds: number) => 148 - seconds / 3600 / maximum * 136;
  const segments: typeof points[] = []; let active: typeof points = [];
  for (const point of points) { if (point.seconds === undefined) { if (active.length) segments.push(active); active = []; } else active.push(point); }
  if (active.length) segments.push(active);
  const middle = records[Math.floor((records.length - 1) / 2)].day;
  const description = points.map(record => `${shortDate(record.day)}、${record.seconds === undefined ? '未記録' : `累計${reflectionDuration(record.seconds)}`}`).join('。');
  const gap = records.some(record => record.seconds === undefined);
  return <View testID="cumulative-chart" style={{ gap: 12 }}>
    <View style={styles.legend}><Text style={[styles.caption, { color: theme.text }]}>累計の推移</Text><Text style={[styles.caption, { color: theme.muted }]}>単位：時間</Text></View>
    <View accessible accessibilityRole="image" accessibilityLabel={`記録開始からの累計の推移。${shortDate(records[0].day)}から${shortDate(records[records.length - 1].day)}まで、確認できた記録の累計は${reflectionDuration(total)}。${gap ? '未記録の区間は線をつながず、累計にも推定値を加えていません。' : ''}日付ごとの累計。${description}`}>
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.chartRow}>
          <View style={styles.axis}>{ticks.map(value => <Text key={value} style={[styles.tick, { color: theme.muted }]}>{Number(value.toFixed(1))}</Text>)}</View>
          <View style={{ flex: 1, minWidth: 0 }}><Svg width="100%" height={160} viewBox="0 0 256 160" preserveAspectRatio="none" aria-hidden>
            {ticks.map(value => <Line key={value} x1={5} x2={251} y1={y(value * 3600)} y2={y(value * 3600)} stroke={theme.line} strokeWidth={1} />)}
            {segments.map((segment, n) => {
              const line = segment.map((point, i) => `${i ? 'L' : 'M'}${x(point.day)},${y(point.seconds!)}`).join(' ');
              const area = `${line} L${x(segment[segment.length - 1].day)},148 L${x(segment[0].day)},148 Z`;
              return <ViewlessPaths key={n} line={line} area={area} soft={theme.soft} accent={theme.accent} />;
            })}
            {points.map((point, n) => point.seconds === undefined ? null : <Circle key={point.day} cx={x(point.day)} cy={y(point.seconds)} r={n === points.length - 1 ? 3.5 : 2} fill={theme.accent} />)}
          </Svg>
          <View style={styles.dateAxis}>{[records[0].day, middle, records[records.length - 1].day].map((date, n) => <Text key={n} style={[styles.date, { color: theme.muted, textAlign: n === 0 ? 'left' : n === 2 ? 'right' : 'center' }]}>{shortDate(date)}</Text>)}</View>
          </View>
        </View>
      </View>
    </View>
    <Text style={[styles.caption, { color: theme.muted }]}>{gap ? '確認できた時間だけの累計です。未記録の期間は線を切っています。' : total === 0 ? '記録はありますが、集計対象の制限時間は0分です。' : '日ごとの記録を足し合わせています。'}</Text>
  </View>;
}
function ViewlessPaths({ line, area, soft, accent }: { line: string; area: string; soft: string; accent: string }) {
  return <><Path d={area} fill={soft} opacity={0.55} /><Path d={line} fill="none" stroke={accent} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" /></>;
}
const styles = StyleSheet.create({
  caption: { fontSize: 12, lineHeight: 20 }, legend: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 },
  chartRow: { flexDirection: 'row', gap: 6 }, axis: { minWidth: 34, flexShrink: 0, height: 160, justifyContent: 'space-between' }, tick: { fontSize: 12, lineHeight: 24, textAlign: 'right' },
  dateAxis: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 }, date: { fontSize: 12, lineHeight: 20, flexShrink: 1 },
});
