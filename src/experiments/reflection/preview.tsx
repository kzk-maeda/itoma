import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Body, Button, Heading, Notice, Panel, useFlowTheme } from '@/components/flow/ui';
import { HomeLayout } from '@/constants/theme';
import { parseReflectionSnapshot, reflectionDuration, ReflectionPrototypeReadError, type ReflectionBucket, type ReflectionPeriod, type ReflectionPrototypeSource, type ReflectionRequest, type ReflectionSnapshot } from './model';

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
    <Svg width="100%" height={52} viewBox="0 0 320 52" accessible={false}><Path d={path} fill="none" stroke={theme.accent} strokeWidth={2} /></Svg>
  </View>;
}

/** Reusable RN proof component, deliberately unreachable from normal app routes. */
export function ReflectionPrototypePreview({ source, initialAnchor, onDay }: {
  source: ReflectionPrototypeSource; initialAnchor: string; onDay?: (day: string, token: string) => void;
}) {
  const theme = useFlowTheme();
  const [request, setRequest] = useState<ReflectionRequest>({ period: 'week', day: initialAnchor });
  const [positions, setPositions] = useState({ week: initialAnchor, month: initialAnchor });
  const [owned, setOwned] = useState<{ source: ReflectionPrototypeSource; value: ReflectionSnapshot }>();
  const [error, setError] = useState<{ source: ReflectionPrototypeSource; changed: boolean }>();
  const [busy, setBusy] = useState(true), [retry, setRetry] = useState(0);
  const latest = useRef<{ source: ReflectionPrototypeSource; value: ReflectionSnapshot } | undefined>(undefined);
  const snapshot = owned?.source === source ? owned.value : undefined;
  useEffect(() => {
    let active = true;
    const pinned = latest.current?.source === source ? latest.current.value.token : undefined;
    queueMicrotask(() => { if (active) { setBusy(true); setError(undefined); } });
    void Promise.resolve().then(() => source.read({ ...request, expectedToken: pinned })).then(parseReflectionSnapshot).then(value => {
      if (!active) return;
      if (pinned && value.token !== pinned) {
        latest.current = undefined; setOwned(undefined); setError({ source, changed: true }); return;
      }
      if (value.period !== request.period) throw new Error('mismatched period');
      latest.current = { source, value }; setOwned({ source, value });
      setPositions(p => ({ ...p, [value.period]: value.anchor }));
    }).catch(reason => {
      if (!active) return;
      const changed = reason instanceof ReflectionPrototypeReadError && reason.code === 'changed';
      if (changed) { latest.current = undefined; setOwned(undefined); }
      setError({ source, changed });
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [source, request, retry]);
  const ask = (next: ReflectionRequest) => { setBusy(true); setRequest(next); };
  const choose = (period: ReflectionPeriod) => ask({ period, day: positions[period] });
  const visibleError = error?.source === source ? error : undefined;
  const max = Math.max(1, ...(snapshot?.buckets.map(b => b.knownSeconds ?? 0) ?? []));
  return <ScrollView testID="reflection-preview-scroll" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
    <Notice title="検証用プレビュー">合成データまたは点の観測を使う実装検証です。実機の制限時間との接続はまだ行っていません。</Notice>
    <Heading>これまでの自分の時間</Heading>
    <Panel>
      <Body muted>制限を続けた時間</Body>
      <Text testID="reflection-total" style={[styles.total, { color: theme.text }]}>{reflectionDuration(snapshot?.total.knownSeconds)}</Text>
      {snapshot && <>
        <Body>{coverageText(snapshot.total)}</Body>
        {snapshot.total.knownSeconds !== undefined && snapshot.total.knownSeconds > 0 && <Body>自分の時間を、少しずつ積み重ねています。</Body>}
        {snapshot.proofScope === 'syntheticFixture' && <Body muted>表示の時間はすべて架空の検証値です。</Body>}
        <Trend buckets={snapshot.trend} />
      </>}
    </Panel>
    {visibleError && <Notice title={visibleError.changed ? '記録が更新されました' : '記録を読み取れませんでした'}>
      {visibleError.changed ? '累計と期間の記録を、同じ時点で再確認できます。' : '空の記録とは扱っていません。もう一度確認できます。'}
    </Notice>}
    {busy && <Body muted>記録を確認しています。</Body>}
    <View style={styles.row}>
      <Button label={snapshot?.period === 'week' ? '✓ 週次' : '週次'} secondary disabled={busy} onPress={() => choose('week')} />
      <Button label={snapshot?.period === 'month' ? '✓ 月次' : '月次'} secondary disabled={busy} onPress={() => choose('month')} />
    </View>
    {snapshot && <>
      <Heading>{snapshot.period === 'month' ? `${snapshot.anchor.slice(0, 4)}年${Number(snapshot.anchor.slice(5, 7))}月` : `${shortDay(snapshot.anchor)}からの週`}</Heading>
      <Body>{snapshot.period === 'month' ? 'この月' : 'この週'}の記録：{reflectionDuration(snapshot.selected.knownSeconds)}</Body>
      <Body muted>{coverageText(snapshot.selected)} · {snapshot.timeZone}</Body>
      <View style={styles.row}>
        <Button label="前の期間" secondary disabled={busy || !snapshot.previousAnchor} onPress={() => { if (snapshot.previousAnchor) ask({ period: snapshot.period, day: snapshot.previousAnchor }); }} />
        <Button label="次の期間" secondary disabled={busy || !snapshot.nextAnchor} onPress={() => { if (snapshot.nextAnchor) ask({ period: snapshot.period, day: snapshot.nextAnchor }); }} />
      </View>
      {snapshot.buckets.map((bucket) => <Pressable key={bucket.day} accessibilityRole="button"
        accessibilityLabel={`${shortDay(bucket.day)}、${reflectionDuration(bucket.knownSeconds)}、${coverageText(bucket)}`}
        disabled={busy || (snapshot.period === 'week' && !onDay)}
        onPress={() => snapshot.period === 'month' ? ask({ period: 'week', day: bucket.day, clippedTo: { from: bucket.from, until: bucket.until } }) : onDay?.(bucket.day, snapshot.token)}
        style={[styles.bucket, { borderColor: theme.line }]}>
        <Body>{shortDay(bucket.day)}{snapshot.period === 'month' ? 'から' : ''}</Body>
        <Body>{reflectionDuration(bucket.knownSeconds)}{bucket.coverage === 'partial' ? ' · 一部の記録' : ''}</Body>
        <View accessible={false} style={[styles.track, { backgroundColor: theme.soft }]}>
          {bucket.knownSeconds !== undefined && <View style={[styles.bar, { backgroundColor: theme.accent, width: `${bucket.knownSeconds / max * 100}%` }]} />}
        </View>
      </Pressable>)}
    </>}
    <Button label="最新の記録を確認する" secondary disabled={busy} onPress={() => {
      latest.current = undefined; setOwned(undefined); setBusy(true); setRetry(n => n + 1);
    }} />
  </ScrollView>;
}
const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: HomeLayout.maxWidth, alignSelf: 'center', paddingHorizontal: HomeLayout.gutter, paddingTop: 24, paddingBottom: 44, gap: 20 },
  total: { fontSize: 38, lineHeight: 52, fontWeight: '500', flexShrink: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, minHeight: 44 },
  bucket: { minHeight: 52, paddingVertical: 12, gap: 8, borderBottomWidth: 1 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' }, bar: { height: 6, borderRadius: 3 },
});
