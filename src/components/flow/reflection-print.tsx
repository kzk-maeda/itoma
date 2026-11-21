import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { dateLabel, moveDay } from '@/lib/history-date';
import { cumulativeAmount, dayDistance, inspectDay, monday, printLevels } from '@/lib/reflection-landscape';
import { Fonts, GraphiteColors } from '@/constants/theme';
import {
  ReflectionReadError, reflectionDuration, type ReflectionSnapshot, type ReflectionSource,
} from '../../../modules/itoma-native/src/reflection-model';
import { Body, Heading, LinkRow, useFlowTheme } from './ui';

const plotWidth = 400, baseline = 151, plotHeight = 159, margin = 5;
const xAt = (fraction: number) => margin + (plotWidth - 2 * margin) * fraction;
const yAt = (seconds: number, total: number) => baseline - seconds / Math.max(total, 1) * 127;
const paper = GraphiteColors.dark;
const printedDate = (date: string) => date.replaceAll('-', '.');

function printGeometry(points: NonNullable<ReflectionSnapshot['landscape']>['points'], total: ReflectionSnapshot['total']) {
  const { from, until, knownSeconds } = total;
  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] | undefined;
  for (const [i, point] of points.entries()) {
    if (point.cumulativeSeconds === undefined) { run = undefined; continue; }
    if (!point.connected || !run) {
      run = i === 0 && point.connected ? [{ x: margin, y: baseline }] : [];
      runs.push(run);
    }
    run.push({ x: xAt((point.at - from) / (until - from)), y: yAt(point.cumulativeSeconds, knownSeconds ?? 0) });
  }
  const ridges: string[] = [], areas: string[] = [], dots: { x: number; y: number }[] = [];
  const impressions = Array.from({ length: 18 }, () => '');
  for (const run of runs) {
    const first = run[0], last = run[run.length - 1];
    if (run.length === 1) { dots.push(first); continue; }
    const path = (scale = 1) => {
      const y = (value: number) => baseline + (value - baseline) * scale;
      let d = `M${first.x} ${y(first.y)}`;
      for (let i = 1; i < run.length; i++) {
        const a = run[i - 1], b = run[i], mid = (a.x + b.x) / 2;
        d += ` C${mid} ${y(a.y)} ${mid} ${y(b.y)} ${b.x} ${y(b.y)}`;
      }
      return d;
    };
    const ridge = path();
    ridges.push(ridge);
    areas.push(`${ridge} L${last.x} ${baseline} L${first.x} ${baseline}Z`);
    impressions.forEach((_, i) => { impressions[i] += path((i + 1) / (impressions.length + 1)); });
  }
  return { ridge: ridges.join(''), area: areas.join(''), dots, impressions };
}

function LandscapePlot({ snapshot, day, select, seconds, disabled }: {
  snapshot: ReflectionSnapshot; day: string; select: (day: string) => void; seconds?: number; disabled: boolean;
}) {
  const { startDay, latestDay } = snapshot.landscape!;
  const span = dayDistance(startDay, latestDay);
  const points = snapshot.landscape!.points, range = snapshot.total;
  const geometry = useMemo(() => printGeometry(points, range), [points, range]);
  const id = 'reflection-print-' + useId().replace(/[^\w-]/g, ''), [width, setWidth] = useState(0);
  const active = useRef({ width, span, startDay, select, disabled });
  useEffect(() => { active.current = { width, span, startDay, select, disabled }; }, [width, span, startDay, select, disabled]);
  const [gesture, setGesture] = useState<ReturnType<typeof PanResponder.create>>();
  useEffect(() => {
    let left = 0;
    const scrub = (pageX: number) => {
      const { width, span, startDay, select, disabled } = active.current;
      if (!width || disabled) return;
      const fraction = Math.max(0, Math.min(1, ((pageX - left) / width * plotWidth - margin) / (plotWidth - 2 * margin)));
      select(moveDay(startDay, Math.round(fraction * span)));
    };
    const responder = PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => !active.current.disabled && active.current.span > 0
        && Math.abs(g.dx) > 8 && Math.abs(g.dx) > 1.4 * Math.abs(g.dy),
      onPanResponderGrant: e => {
        // The accessible decoration ignores pointer events, so locationX is on the plot host.
        left = e.nativeEvent.pageX - e.nativeEvent.locationX;
        scrub(e.nativeEvent.pageX);
      },
      onPanResponderMove: (_, g) => scrub(g.moveX),
      onPanResponderTerminationRequest: () => true,
    });
    let mounted = true;
    queueMicrotask(() => { if (mounted) setGesture(responder); });
    return () => { mounted = false; };
  }, []);
  const latest = day === latestDay, x = xAt(span ? dayDistance(startDay, day) / span : 1);
  const total = snapshot.total.knownSeconds ?? 0, level = printLevels.find(value => value.seconds <= total);
  const levelY = level ? yAt(level.seconds, total) : undefined;
  return <>
    <View testID="reflection-plot" {...gesture?.panHandlers} onLayout={event => setWidth(event.nativeEvent.layout.width)}
      style={Platform.OS === 'web' ? { touchAction: 'pan-y' } : undefined}>
      <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
        <Svg width="100%" height={144} viewBox={`0 0 ${plotWidth} ${plotHeight}`} preserveAspectRatio="none">
          <Defs><ClipPath id={id}><Rect x={0} y={0} width={x} height={plotHeight} /></ClipPath></Defs>
          {level && levelY !== undefined && <>
            <Path d={`M${margin} ${levelY}H${plotWidth - margin}`} stroke={paper.muted} opacity={0.65} strokeDasharray="1 5" />
            <SvgText x={margin} y={levelY - 6} fontSize={14} fill={paper.muted}>{level.label}</SvgText>
          </>}
          <Path d={`M${margin} ${baseline + 2}H${plotWidth - margin}`} stroke={paper.muted} opacity={0.5} />
          <G opacity={0.33}>
            {geometry.area && <Path d={geometry.area} fill={paper.text} fillOpacity={0.12} />}
            {geometry.impressions.map((d, i) => d && <Path key={i} d={d} fill="none" stroke={paper.text} strokeWidth={0.7} />)}
            {geometry.ridge && <Path d={geometry.ridge} fill="none" stroke={paper.text} strokeWidth={1.6} />}
            {geometry.dots.map(p => <Circle key={p.x} cx={p.x} cy={p.y} r={2} fill={paper.text} />)}
          </G>
          <G clipPath={`url(#${id})`}>
            {geometry.impressions.map((d, i) => d && <Path key={i} d={d} fill="none" stroke={paper.text} strokeOpacity={0.56} strokeWidth={0.8} />)}
            {geometry.ridge && <Path d={geometry.ridge} fill="none" stroke={paper.text} strokeWidth={1.6} />}
            {geometry.dots.map(p => <Circle key={p.x} cx={p.x} cy={p.y} r={2} fill={paper.text} />)}
          </G>
          {!latest && <Path d={`M${x} 12V${baseline + 4}`} stroke={paper.text} opacity={0.65} strokeDasharray="2 4" />}
          {seconds !== undefined && <Circle cx={x} cy={yAt(seconds, total)} r={3.6} stroke={paper.surface} strokeWidth={1.8} fill={paper.text} />}
        </Svg>
      </View>
    </View>
    <View style={styles.axis}>
      <Text style={styles.printQuiet}>{printedDate(startDay)}</Text>
      {!!span && <Text style={styles.printQuiet}>{printedDate(latestDay)}</Text>}
    </View>
  </>;
}

type WeekReader = NonNullable<ReflectionSource['readWeek']>;
type WeekSelection = { anchor: string; day: string };
/** Retains the selected week's payload and coalesces crossings while the native actor is busy. */
function useInspectionWeek(read: WeekReader, snapshot: ReflectionSnapshot, day: string, visible: boolean, onChanged: () => void) {
  const [week, setWeek] = useState(snapshot.inspectionWeek);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0), anchor = monday(day);
  const desired = useRef<WeekSelection | undefined>(undefined), fetching = useRef(false);
  const generation = useRef(0);
  const cached = useRef(week);
  const changed = useRef(onChanged);
  const failed = useRef<string | undefined>(undefined);
  useEffect(() => { changed.current = onChanged; }, [onChanged]);
  useEffect(() => () => { generation.current++; desired.current = undefined; }, []);

  useEffect(() => {
    if (!visible) { desired.current = undefined; return; }
    if (cached.current?.anchor === anchor) { desired.current = undefined; return; }
    if (failed.current === anchor) { desired.current = undefined; return; }
    desired.current = { anchor, day };
    if (fetching.current) return;
    fetching.current = true;
    const session = generation.current;
    void (async () => {
      // Coalesce multiple changes made in the same interaction before calling native.
      await Promise.resolve();
      while (desired.current && generation.current === session) {
        const query = desired.current;
        if (cached.current?.anchor === query.anchor) { desired.current = undefined; break; }
        try {
          const result = await read(query.day, snapshot.token);
          if (generation.current !== session) break;
          if (desired.current?.anchor !== query.anchor) continue;
          if (result.token !== snapshot.token) throw new ReflectionReadError('changed');
          if (result.week.anchor !== query.anchor || !result.week.days.some(row => row.day === query.day)
            || result.week.days.some(row => row.until > snapshot.asOf)) throw new ReflectionReadError('unavailable');
          cached.current = result.week;
          failed.current = undefined;
          setWeek(result.week); setError(undefined); desired.current = undefined;
        } catch (reason) {
          if (generation.current !== session) break;
          if (desired.current?.anchor !== query.anchor) continue;
          if (reason instanceof ReflectionReadError && (reason.code === 'changed' || reason.code === 'not-created')) {
            desired.current = undefined;
            changed.current();
            break;
          }
          desired.current = undefined;
          failed.current = query.anchor;
          setError(query.anchor);
        }
      }
      fetching.current = false;
    })();
  }, [anchor, day, read, retry, snapshot.asOf, snapshot.token, visible]);
  return {
    week: week?.anchor === anchor ? week : undefined,
    error: error === anchor,
    retry: () => { failed.current = undefined; setError(undefined); setRetry(value => value + 1); },
  };
}

function DayButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  const theme = useFlowTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress} style={[styles.control, { borderColor: theme.line }]}>
    <Text style={[styles.caption, { color: disabled ? theme.muted : theme.text }]}>{label}</Text>
  </Pressable>;
}

export function ReflectionPrint({ snapshot, readWeek, visible, disabled, onChanged, onSeedUsed }: {
  snapshot: ReflectionSnapshot; readWeek: WeekReader; visible: boolean; disabled: boolean;
  onChanged: () => void; onSeedUsed: () => void;
}) {
  const { startDay, latestDay } = snapshot.landscape!;
  const theme = useFlowTheme(), [day, setDay] = useState(latestDay), [details, setDetails] = useState(false);
  const { week, error, retry } = useInspectionWeek(readWeek, snapshot, day, visible, onChanged);
  useEffect(() => { if (snapshot.inspectionWeek) onSeedUsed(); }, [snapshot.inspectionWeek, onSeedUsed]);
  const historical = day !== latestDay, inspected = inspectDay(snapshot, week, day);
  const seconds = historical ? inspected?.cumulative : snapshot.total.knownSeconds;
  const amount = cumulativeAmount(seconds);
  const partial = historical ? inspected?.partial : (snapshot.total.coverage === 'partial' || snapshot.incomplete);
  const calculated = snapshot.proofScope === 'ruleScheduleLogs';
  const qualified = snapshot.proofScope !== 'pointObservations';
  const dayText = error ? 'この週を読み取れませんでした' : !inspected ? '確認中' : reflectionDuration(inspected.seconds);
  const caption = calculated ? 'ルールから計算した時間の累計・一時解除を除く'
    : qualified ? '制限の適用を記録した時間の累計・一時解除を除く' : '時間の記録を確認できていません';
  return <>
    <View style={styles.print}>
      <View style={styles.axis}>
        <Text style={styles.printQuiet}>{historical ? 'この日までの累計' : '全期間'}</Text>
        <Text style={styles.printQuiet}>{printedDate(startDay)} — {printedDate(day)}</Text>
      </View>
      <Text accessibilityRole="header" style={styles.printHeading}>重ねた時間</Text>
      <View testID="reflection-amount" style={styles.amount}>
        {historical && !inspected && !error ? <Text style={styles.printHeading}>確認中</Text> :
          <Text testID="reflection-total" accessibilityLabel={amount.prefix + amount.number + amount.unit + amount.tail} style={styles.amountText}>
            <Text style={styles.remainder}>{amount.prefix}</Text>
            <Text style={amount.unit || amount.number === '—' ? styles.number : undefined}>{amount.number}</Text>
            {amount.unit}{!!amount.tail && <Text style={styles.remainder}> {amount.tail}</Text>}
          </Text>}
      </View>
      {partial && seconds !== undefined && <Text style={styles.printQuiet}>一部未記録のため、確認できた分の累計です。</Text>}
      <LandscapePlot snapshot={snapshot} day={day} select={setDay} seconds={seconds} disabled={disabled || !visible} />
      <Text style={styles.printQuiet}>{caption}</Text>
    </View>
    <View style={styles.inspection}>
      <Heading>{dateLabel(day)}の記録</Heading>
      <Body>{dayText}{inspected?.seconds === undefined && dayText === '—' ? '　この日は未記録です' : ''}</Body>
      {inspected?.seconds !== undefined && week?.days.find(row => row.day === day)?.coverage === 'partial' && <Body muted>この日に確認できた分です。</Body>}
      <View style={styles.controls}>
        <DayButton label="前日" disabled={disabled || day <= startDay} onPress={() => setDay(moveDay(day, -1))} />
        <DayButton label="翌日" disabled={disabled || day >= latestDay} onPress={() => setDay(moveDay(day, 1))} />
        {historical && <DayButton label="最新に戻す" disabled={disabled} onPress={() => setDay(latestDay)} />}
        {error && <DayButton label="選択週を読み直す" disabled={disabled} onPress={retry} />}
      </View>
      {startDay !== latestDay && <Body muted>図をなぞると、日付をたどれます。</Body>}
    </View>
    <View style={styles.inspection}>
      <LinkRow label="集計について" onPress={() => setDetails(!details)} />
      {details && <>
        <Text style={[styles.caption, { color: theme.text }]}>{calculated ? '当時のルール設定と一時解除のログから、停止と一時解除を除いた時間を算出しています。'
          : qualified ? '端末で適用を確認した区間から、一時解除を除いた時間です。' : '操作の観測から、時間は確定できません。'}</Text>
        <Body>元の時間は {reflectionDuration(seconds)}。24時間を1日分、30日を約1か月分、365日を約1年分としています。</Body>
      </>}
    </View>
  </>;
}

const styles = StyleSheet.create({
  print: { backgroundColor: paper.surface, borderRadius: 18, padding: 18, gap: 8 },
  printQuiet: { color: paper.muted, fontSize: 13, lineHeight: 21, flexShrink: 1 },
  printHeading: { color: paper.text, fontSize: 18, lineHeight: 28 },
  amount: { minHeight: 62, justifyContent: 'center' },
  amountText: { color: paper.text, fontSize: 21, lineHeight: 76 },
  remainder: { color: paper.muted, fontSize: 16 },
  number: { fontSize: 64, fontFamily: Fonts.serif, fontVariant: ['tabular-nums'] },
  axis: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 10 },
  inspection: { gap: 8 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  control: { minHeight: 44, minWidth: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 10, justifyContent: 'center' },
  caption: { fontSize: 13, lineHeight: 21 },
});
