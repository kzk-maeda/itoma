import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Body, Heading, LinkRow, Notice, useFlowTheme } from '@/components/flow/ui';
import { HomeLayout } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { PeriodSelector, PeriodTransition } from './period-transition';
import { parseReflectionSnapshot, parseReflectionPrototypeSnapshot, reflectionDuration, ReflectionReadError, type ReflectionBucket, type ReflectionPeriod, type ReflectionSource, type ReflectionRequest, type ReflectionSnapshot } from '../../../modules/itoma-native/src/reflection-model';

const shortDay = (day: string) => day ? `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日` : '';
const coverageText = (b: ReflectionBucket) => b.coverage === 'deleted' ? '記録は削除されています' : b.coverage === 'notRecorded' ? 'この範囲の時間はまだ記録されていません'
  : b.knownSeconds === undefined ? '操作の観測だけでは、制限を続けた時間を確定できません' : b.coverage === 'partial' ? '分かっている記録だけの時間です' : '一時解除を除いた記録です';

function Trend({ buckets }: { buckets: ReflectionBucket[] }) {
  const theme = useFlowTheme(), max = Math.max(1, ...buckets.map(b => b.knownSeconds ?? 0));
  const path = buckets.map((b, n) => {
    if (b.knownSeconds === undefined || b.coverage !== 'recorded') return '';
    const point = `${buckets.length === 1 ? 160 : n * 320 / (buckets.length - 1)},${44 - b.knownSeconds / max * 38}`;
    const previous = buckets[n - 1];
    return `${previous?.knownSeconds !== undefined && previous.coverage === 'recorded' ? 'L' : 'M'}${point}`;
  }).join(' ');
  const description = buckets.map(b => `${shortDay(b.day)}、${reflectionDuration(b.knownSeconds)}${b.coverage !== 'recorded' ? '、一部不明または未記録' : ''}`).join('。');
  return <View accessible accessibilityRole="image" accessibilityLabel={`これまでの推移。${description}。不明な区間は線をつないでいません。`}>
    <Svg width="100%" height={52} viewBox="0 0 320 52" accessible={false}>
      <Path d="M0 51H320" stroke={theme.line} strokeWidth={1} />
      {path ? <Path d={path} fill="none" stroke={theme.accent} strokeWidth={2} /> : null}
    </Svg>
  </View>;
}

export type ReflectionMemory = { request: ReflectionRequest; positions: Record<ReflectionPeriod, ReflectionRequest> };
/** Shared presentation. Production always selects the product parser and rejects fixture proof. */
export function ReflectionContent({ source, initialAnchor = '', onDay, prototype = false, embedded = false, initialMemory, onMemory, onRead, controls, disabled = false, visible = true }: {
  source: ReflectionSource; initialAnchor?: string; onDay?: (day: string, snapshot: ReflectionSnapshot) => void;
  prototype?: boolean; embedded?: boolean; disabled?: boolean; visible?: boolean; initialMemory?: ReflectionMemory; onMemory?: (value: ReflectionMemory) => void;
  onRead?: (state: 'ready' | 'not-created' | 'error') => void; controls?: ReactNode;
}) {
  const theme = useFlowTheme(), { fontScale } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [direction, setDirection] = useState<-1 | 1>(1);
  const [request, setRequest] = useState<ReflectionRequest>(initialMemory?.request ?? { period: 'week', day: initialAnchor });
  const [positions, setPositions] = useState<ReflectionMemory['positions']>(initialMemory?.positions ?? { week: { period: 'week', day: initialAnchor }, month: { period: 'month', day: initialAnchor } });
  const [owned, setOwned] = useState<{ source: ReflectionSource; prototype: boolean; value: ReflectionSnapshot; request: ReflectionRequest }>();
  const [error, setError] = useState<{ source: ReflectionSource; changed: boolean; empty?: boolean }>();
  const [busy, setBusy] = useState(true), [retry, setRetry] = useState(0);
  const latest = useRef<{ source: ReflectionSource; prototype: boolean; value: ReflectionSnapshot } | undefined>(undefined);
  const snapshot = owned?.source === source && owned.prototype === prototype ? owned.value : undefined;
  const displayedRequest = snapshot ? owned!.request : request;
  useEffect(() => { onMemory?.({ request, positions }); }, [onMemory, request, positions]);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    const pinned = latest.current?.source === source && latest.current.prototype === prototype ? latest.current.value.token : undefined;
    queueMicrotask(() => { if (active) { setBusy(true); setError(undefined); } });
    void Promise.resolve().then(() => source.read({ ...request, expectedToken: pinned })).then(prototype ? parseReflectionPrototypeSnapshot : parseReflectionSnapshot).then(value => {
      if (!active) return;
      if (pinned && value.token !== pinned) {
        latest.current = undefined; setOwned(undefined); setError({ source, changed: true }); return;
      }
      if (value.period !== request.period) throw new Error('mismatched period');
      onRead?.('ready');
      latest.current = { source, prototype, value }; setOwned({ source, prototype, value, request });
      setPositions(p => ({ ...p, [value.period]: { ...request, day: request.day || value.anchor } }));
      if (!request.day) setRequest(current => current.day ? current : { ...current, day: value.anchor });
    }).catch(reason => {
      if (!active) return;
      const changed = reason instanceof ReflectionReadError && reason.code === 'changed';
      const empty = reason instanceof ReflectionReadError && reason.code === 'not-created';
      onRead?.(empty ? 'not-created' : 'error');
      if (changed || empty) { latest.current = undefined; setOwned(undefined); }
      setError({ source, changed, empty });
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [source, request, retry, prototype, onRead, visible]);
  const ask = (next: ReflectionRequest, slide: -1 | 1 = 1) => {
    if (next.period === request.period && next.day === request.day
      && next.clippedTo?.from === request.clippedTo?.from && next.clippedTo?.until === request.clippedTo?.until) return;
    setDirection(slide); setBusy(true); setRequest(next);
  };
  const choose = (period: ReflectionPeriod) => {
    if (period === (snapshot?.period ?? request.period)) return;
    ask(positions[period], period === 'month' ? 1 : -1);
  };
  const visibleError = error?.source === source ? error : undefined;
  const blocked = busy || disabled;
  const describe = (bucket: ReflectionBucket) => !prototype && bucket.coverage === 'partial' && bucket.knownSeconds === undefined
    ? '制限を続けた時間は、まだ確定できません。' : coverageText(bucket);
  const max = Math.max(1, ...(snapshot?.buckets.map(b => b.knownSeconds ?? 0) ?? []));
  const content = <>
    {prototype && <Notice title="検証用プレビュー">合成データまたは点の観測を使う実装検証です。実機の制限時間との接続はまだ行っていません。</Notice>}
    {!embedded && <Heading>これまでの自分の時間</Heading>}
    <View style={[styles.totalCard, { backgroundColor: theme.background }]}>
      <Text style={[styles.caption, { color: theme.muted }]}>これまでに制限を続けた時間</Text>
      <Text testID="reflection-total" style={[styles.total, { color: theme.text }]}>{reflectionDuration(snapshot?.total.knownSeconds)}</Text>
      <Text style={[styles.caption, { color: theme.muted }]}>記録全体の累計 · 一時解除を除く</Text>
      {snapshot && <>
        {(prototype || snapshot.total.coverage !== 'partial') && <Text style={[styles.caption, { color: theme.muted }]}>{describe(snapshot.total)}</Text>}
        {snapshot.total.knownSeconds !== undefined && snapshot.total.knownSeconds > 0 && <Body>自分の時間を、少しずつ積み重ねています。</Body>}
        <Trend buckets={snapshot.trend} />
      </>}
      {!prototype && <Text style={[styles.caption, { color: theme.text }]}>時間の集計は準備中です</Text>}
    </View>
    {!prototype && <>
      {snapshot?.incomplete && <Body muted>記録の一部が欠けている可能性があります。</Body>}
      {snapshot?.sharedIncomplete && <Body muted>新しい状態の記録に欠落の可能性があります。保存済みの記録とは別の時点で確認しています。</Body>}
      {snapshot && snapshot.transfer !== 'current' && <Body muted>{snapshot.transfer === 'pending' ? 'まだ取り込んでいない記録があります。' : '新しい記録の取込状況を確認できません。'}</Body>}
    </>}
    {snapshot?.proofScope === 'syntheticFixture' && <Body muted>表示の時間はすべて架空の検証値です。</Body>}
    {visibleError?.empty && <Notice title="まだ時間の記録がありません">これからの記録を、ここで確認できます。記録のない時間を0分としていません。</Notice>}
    {visibleError && !visibleError.empty && <Notice title={visibleError.changed ? '記録が更新されました' : '記録を読み取れませんでした'}>
      {visibleError.changed ? '累計と期間の記録を、同じ時点で再確認できます。' : '空の記録とは扱っていません。もう一度確認できます。'}
    </Notice>}
    {busy && !snapshot && <Body muted>記録を確認しています。</Body>}
    <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text }]}>期間ごとに見る</Text>
    <PeriodSelector selected={snapshot?.period ?? request.period} onSelect={choose} disabled={blocked} reduced={reduced} theme={theme} />
    {snapshot && <PeriodTransition transitionKey={`${snapshot.period}:${snapshot.anchor}:${displayedRequest.clippedTo?.from ?? ''}:${displayedRequest.clippedTo?.until ?? ''}`} direction={direction} reduced={reduced} busy={busy}>
      <View style={styles.periodNavigation}>
        <Pressable accessibilityRole="button" accessibilityLabel="前の期間" accessibilityState={{ disabled: blocked || !snapshot.previousAnchor }}
          disabled={blocked || !snapshot.previousAnchor} onPress={() => { if (snapshot.previousAnchor) ask({ period: snapshot.period, day: snapshot.previousAnchor }, -1); }}
          style={[styles.round, { borderColor: theme.muted }]}><Text style={{ color: theme.muted, fontSize: 24 }}>‹</Text></Pressable>
        <Text accessibilityRole="header" style={[styles.periodTitle, { color: theme.text }]}>{snapshot.period === 'month' ? `${snapshot.anchor.slice(0, 4)}年${Number(snapshot.anchor.slice(5, 7))}月` : `${shortDay(snapshot.anchor)}からの週`}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="次の期間" accessibilityState={{ disabled: blocked || !snapshot.nextAnchor }}
          disabled={blocked || !snapshot.nextAnchor} onPress={() => { if (snapshot.nextAnchor) ask({ period: snapshot.period, day: snapshot.nextAnchor }); }}
          style={[styles.round, { borderColor: theme.muted }]}><Text style={{ color: theme.muted, fontSize: 24 }}>›</Text></Pressable>
      </View>
      <View accessible accessibilityLabel={`${snapshot.period === 'month' ? 'この月' : displayedRequest.clippedTo ? '月内の週' : 'この週'}の記録：${reflectionDuration(snapshot.selected.knownSeconds)}`} style={styles.periodTotal}>
        <Text style={[styles.caption, { color: theme.muted }]}>{snapshot.period === 'month' ? 'この月' : displayedRequest.clippedTo ? '月内の週' : 'この週'}の記録</Text>
        <Text testID="reflection-period-total" style={[styles.periodNumber, { color: theme.text }]}>{reflectionDuration(snapshot.selected.knownSeconds)}</Text>
      </View>
      <Text style={[styles.caption, { color: theme.muted }]}>{describe(snapshot.selected)} · {snapshot.timeZone}</Text>
      <View>{snapshot.buckets.map((bucket) => <Pressable key={bucket.day} accessibilityRole="button"
        accessibilityLabel={`${shortDay(bucket.day)}、${reflectionDuration(bucket.knownSeconds)}、${coverageText(bucket)}`}
        disabled={blocked || (snapshot.period === 'week' && !onDay)}
        onPress={() => snapshot.period === 'month' ? ask({ period: 'week', day: bucket.day, clippedTo: { from: bucket.from, until: bucket.until } }) : onDay?.(bucket.day, snapshot)}
        style={[styles.bucket, { borderColor: theme.line }]}>
        <View style={[styles.barRow, fontScale > 1.2 && styles.expandedBarRow]}>
          <Text style={[styles.barLabel, fontScale > 1.2 && styles.expandedBarText, { color: theme.text }]}>{shortDay(bucket.day)}{snapshot.period === 'month' ? '〜' : ''}</Text>
          <View accessible={false} style={[styles.track, fontScale > 1.2 && styles.expandedTrack, { backgroundColor: theme.background }]}>
            {bucket.knownSeconds !== undefined && <View style={[styles.bar, { backgroundColor: theme.accent, width: `${bucket.knownSeconds / max * 100}%` }]} />}
          </View>
          <Text style={[styles.barValue, fontScale > 1.2 && styles.expandedBarText, { color: theme.muted }]}>{reflectionDuration(bucket.knownSeconds)}{bucket.coverage === 'partial' ? ' · 一部不明' : ''}</Text>
        </View>
      </Pressable>)}</View>
    </PeriodTransition>}
    {!prototype && <View style={styles.metadata}>
      <Text style={[styles.caption, { color: theme.muted }]}>制限を続けた時間はまだ集計できません。保存した操作の記録は確認できます。</Text>
      <Text style={[styles.caption, { color: theme.muted }]}>一時解除中と、制限を確認できない時間は加算しません。</Text>
    </View>}
    <LinkRow label="最新の記録を確認する" disabled={blocked} onPress={() => {
      latest.current = undefined; setOwned(undefined); setBusy(true); setRetry(n => n + 1);
    }} />
    {controls}
  </>;
  return embedded ? <View style={styles.embedded}>{content}</View> : <ScrollView testID="reflection-preview-scroll" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>{content}</ScrollView>;
}
const styles = StyleSheet.create({
  embedded: { gap: 20 },
  content: { width: '100%', maxWidth: HomeLayout.maxWidth, alignSelf: 'center', paddingHorizontal: HomeLayout.gutter, paddingTop: 24, paddingBottom: 44, gap: 20 },
  totalCard: { padding: 18, borderRadius: 18, gap: 8 }, total: { fontSize: 36, lineHeight: 52, fontWeight: '400', fontVariant: ['tabular-nums'], flexShrink: 1 },
  metadata: { gap: 4 }, caption: { fontSize: 13, lineHeight: 21 }, sectionTitle: { fontSize: 15, lineHeight: 24, fontWeight: '600', marginTop: 4 },
  periodNavigation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  round: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  periodTitle: { fontSize: 16, lineHeight: 26, fontWeight: '600', textAlign: 'center', flex: 1 },
  periodTotal: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  periodNumber: { fontSize: 26, lineHeight: 38, fontVariant: ['tabular-nums'], flexShrink: 1 },
  bucket: { minHeight: 52, paddingVertical: 12, borderBottomWidth: 1 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, expandedBarRow: { flexDirection: 'column', alignItems: 'stretch' },
  barLabel: { width: 74, fontSize: 13, lineHeight: 21 }, barValue: { width: 78, fontSize: 13, lineHeight: 21, textAlign: 'right' },
  expandedBarText: { width: '100%' }, expandedTrack: { flex: 0, width: '100%', minHeight: 16 },
  track: { flex: 1, minWidth: 24, height: 16, borderRadius: 3, overflow: 'hidden' }, bar: { height: 16, borderRadius: 3 },
});
