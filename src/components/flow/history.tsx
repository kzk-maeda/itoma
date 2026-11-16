import { useFocusEffect, useIsFocused } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useHistoryRecords } from '@/state/history';
import { completeNativeHistorySmoke } from '@/qa/native-smoke';
import type { HistoryCode, HistoryRow } from '../../../modules/itoma-native';
import { useAppNavigation } from '@/state/navigation';
import { Body, Button, FlowScreen, Heading, LinkRow, Notice, Panel, flowStyles, useFlowTheme } from './ui';
import { HistoryCalendar } from './history-calendar';
import { canReadChoiceReason, choiceStatus, choiceTitle, dateLabel, dayAt, moveDay, timeLabel } from './history-presentation';
import { HistoryTimelineEntry } from './history-timeline';

const errors: Record<HistoryCode, string> = {
  unavailable: 'この環境では履歴を利用できません。履歴機能を含むiPhone版で確認できます。',
  'storage-failed': '記録を読み取れませんでした。記録がないとは扱っていません。端末のロックを解除して、もう一度確認できます。',
  busy: '前の操作を確認しています。少し待ってから再度確認できます。',
  changed: '記録が更新されました。最新の内容を読み直してください。',
  'invalid-input': '日付を確認してください。',
  'capacity-full': '保存する上限に達しました。設定で記録を確認し、取込を再試行できます。',
};
function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false), theme = useFlowTheme();
  return <View style={styles.disclosure}><Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} aria-expanded={open} onPress={() => setOpen(value => !value)} style={styles.disclosureButton}>
    <Text style={{ color: theme.text, fontSize: 14, flex: 1 }}>{label}</Text><Text accessible={false} style={{ color: theme.muted }}>{open ? '−' : '＋'}</Text>
  </Pressable>{open && <View style={flowStyles.section}>{children}</View>}</View>;
}
export function HistoryScreen() {
  const navigation = useAppNavigation();
  const state = useHistoryRecords(), theme = useFlowTheme();
  const [calendar, setCalendar] = useState(false), [viewedAt, setViewedAt] = useState(Date.now);
  const { ensureLoaded, pauseOlder } = state;
  const focused = useIsFocused();
  useFocusEffect(useCallback(() => {
    setViewedAt(Date.now()); ensureLoaded();
    return pauseOlder;
  }, [ensureLoaded, pauseOlder]));
  useEffect(() => {
    if (!state.busy && (state.storage === 'not-created' || state.error)) completeNativeHistorySmoke(state.storage === 'not-created' && !state.error);
  }, [state.busy, state.storage, state.error]);
  const page = state.page, zone = page?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = dayAt(viewedAt / 1000, zone), selectedDay = state.day || today;
  const rows = state.rows;
  const chooseDay = (day: string) => { state.choose(state.kind, day); setCalendar(false); };
  const footer = <>
    {page && rows.length > 0 && !state.error && <View style={styles.feedStatus} accessibilityLiveRegion="polite">
      {state.loadingOlder ? <Body muted>過去の記録を読み込んでいます。</Body>
        : state.olderError ? <><Body>過去の記録を読み込めませんでした。表示済みの記録は残っています。</Body><Button label="過去の記録を再読み込み" secondary onPress={() => { void state.loadOlder(true); }} /></>
          : state.next ? <Button label="過去の記録を読み込む" secondary disabled={state.busy} onPress={() => { void state.loadOlder(); }} />
            : <Body muted>{state.day ? 'この日の記録はここまでです。' : 'この範囲の記録はここまでです。'}</Body>}
    </View>}
    <Disclosure label="記録について・保存状況">
      <Body muted>これは選択や処理の記録です。実際の利用時間や集中の成果、現在の制限を示すものではありません。線の長さや間隔は利用時間を表しません。</Body>
      {page && <Body muted>取得時点：{new Date(page.asOf * 1000).toLocaleString('ja-JP', { timeZone: zone })} · {zone}。最大40件ずつ。{page.grouping === 'command' ? '同じ要求の経過は1件にまとめています。' : '保存した操作を表示しています。'}</Body>}
      <LinkRow label="記録の保存状況を確認する" detail="設定で保存状況と取込を開く" onPress={() => navigation.open({ screen: 'settings-storage' })} />
    </Disclosure>
    <Button label="最新の記録を確認する" secondary disabled={state.busy} onPress={state.restart} />
  </>;
  return <FlowScreen<HistoryRow> title="あなたの選択の記録" backLabel="‹ 振り返り" onBack={() => navigation.open({ screen: 'reflection' })} footer={footer}
    list={{
      viewKey: `${state.kind}:${state.day}:${state.viewGeneration}`, data: rows, keyExtractor: row => row.key, extraData: [zone, today, state.busy],
      getInitialOffset: state.getScrollOffset, onScrollOffset: offset => { if (focused) state.rememberScroll(offset); },
      onEndReachedThreshold: 0.6, onEndReached: () => { if (focused) void state.loadOlder(); },
      renderItem: ({ item: row, index }) => <HistoryTimelineEntry row={row} zone={zone} today={today} busy={state.busy}
        first={index === 0 || dayAt(rows[index - 1].at, zone) !== dayAt(row.at, zone)}
        continues={index + 1 < rows.length && dayAt(rows[index + 1].at, zone) === dayAt(row.at, zone)}
        onOpen={item => { if (state.openRecord(item)) navigation.open({ screen: 'history-reason' }); }} />,
    }}>
    <Body muted>そのとき、何を選んだか。理由と結果を、一つずつ見直せます。</Body>
    <View style={[styles.segments, { backgroundColor: theme.background }]}>
      {(['event', 'reason'] as const).map(kind => <Pressable key={kind} accessibilityRole="button" accessibilityState={{ selected: state.kind === kind, disabled: state.busy }} aria-pressed={state.kind === kind} disabled={state.busy}
        onPress={() => { setCalendar(false); state.choose(kind, state.day); }} style={[styles.segment, { backgroundColor: state.kind === kind ? theme.surface : 'transparent' }]}>
        <Text style={{ color: state.kind === kind ? theme.text : theme.muted, fontSize: 14, fontWeight: state.kind === kind ? '600' : '400' }}>{kind === 'event' ? '操作と結果' : '保存した理由'}</Text>
      </Pressable>)}
    </View>
    {state.kind === 'reason' && <Body muted>解除の受付に至らず、理由だけを保存した記録も確認できます。</Body>}
    {!!state.day && <View accessibilityLiveRegion="polite"><Body muted>日付で絞り込み中</Body></View>}
    <View style={styles.dateControls}>
      <Pressable accessibilityRole="button" accessibilityLabel="日付を選ぶ" accessibilityValue={{ text: state.day ? dateLabel(state.day) : 'すべての日' }} accessibilityState={{ expanded: calendar, disabled: state.busy || !selectedDay }} aria-expanded={calendar} disabled={state.busy || !selectedDay} onPress={() => setCalendar(value => !value)} style={[styles.dateButton, { borderColor: theme.line }]}>
        <Text style={{ color: theme.text, fontSize: 15 }}>{state.day ? dateLabel(state.day) : 'すべての日'}　⌄</Text>
      </Pressable>
      {state.day ? <Button label="絞り込みを解除" secondary disabled={state.busy} onPress={() => chooseDay('')} /> : <Button label="今日" secondary disabled={state.busy || !today} onPress={() => chooseDay(today)} />}
    </View>
    {calendar && <HistoryCalendar initialDay={selectedDay} onChoose={chooseDay} onClose={() => setCalendar(false)} />}
    {!!state.day && <View style={styles.dayNavigation}><Button label="前の日" secondary disabled={state.busy} onPress={() => chooseDay(moveDay(state.day, -1))} /><Button label="次の日" secondary disabled={state.busy} onPress={() => chooseDay(moveDay(state.day, 1))} /></View>}
    {state.error && <View accessibilityLiveRegion="polite"><Notice title="記録を確認してください">{errors[state.error]}</Notice></View>}
    {state.pages.some(p => p.incomplete) && <Notice title="記録が一部欠けている可能性があります">確認できる記録だけを表示しています。</Notice>}
    {page && state.pages.some(p => p.transfer !== 'current') && <Notice title={state.pages.some(p => p.transfer === 'pending') ? 'まだ取り込んでいない記録があります' : '新しい記録の取込状況は未確認です'}>保存済みの記録は下で確認できます。</Notice>}
    {state.reference && page && (state.reference.revision !== page.revision || state.reference.asOf !== page.asOf || state.reference.timeZone !== page.timeZone) && <Body muted>振り返りとは別の時点の記録です。時間の集計と一致する一覧とは限りません。</Body>}
    {state.busy && <Body muted>記録を確認しています。</Body>}
    {state.storage === 'not-created' && !state.error && <Panel><Heading>これからの選択を、ここに。</Heading><Body>理由の保存や、設定を見直したときの記録を確認できます。</Body></Panel>}
    {!!page && !state.error && !state.busy && !rows.length && <Panel><Heading>{state.day ? 'この日の記録はありません' : 'この範囲に記録はありません'}</Heading><Body>{state.kind === 'event' ? '理由だけの保存は「保存した理由」から確認できます。' : 'ここで確認できる理由の記録はありません。'}</Body>{state.day && <Button label="すべての日の記録を見る" secondary onPress={() => chooseDay('')} />}</Panel>}
    {!!rows.length && <Body muted>新しい記録から</Body>}
  </FlowScreen>;
}

export function HistoryReasonScreen() {
  const navigation = useAppNavigation();
  const state = useHistoryRecords(), theme = useFlowTheme(), row = state.selectedRow, reason = state.reason;
  const zone = state.page?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const expected = !!state.selectedCommandID || (row && canReadChoiceReason(row));
  const { closeReason } = state;
  const close = () => { closeReason(); navigation.open({ screen: 'history' }); };
  useFocusEffect(useCallback(() => () => closeReason(), [closeReason]));
  return <FlowScreen title="選択の詳細" backLabel="‹ 選択の記録" onBack={close}>
    {row && <View style={flowStyles.section}><Heading>{choiceTitle(row)}</Heading>
      <Body muted>{dateLabel(dayAt(row.at, zone))} {timeLabel(row.at, zone)} の記録</Body>
      {row.updatedAt !== undefined && row.updatedAt !== row.at && <Body muted>最後の記録：{dateLabel(dayAt(row.updatedAt, zone))} {timeLabel(row.updatedAt, zone)}</Body>}
      <Body>{choiceStatus(row)}</Body>
    </View>}
    {state.error && <Notice title="記録を確認してください">{errors[state.error]}</Notice>}
    {(expected || reason) && <Panel><Heading>あなたの理由</Heading>
      {state.busy && <Body muted>理由を確認しています。</Body>}
      {reason && <>
        <Body>{reason.state === 'deleted' ? '理由本文は削除済みです。操作の記録は残っています。' : reason.state === 'missing' ? 'この記録に紐づく理由を確認できません。'
          : reason.state === 'prepared-only' ? '理由の保存だけを確認しました。一時解除の受付記録はありません。'
            : reason.state === 'shared-accepted' ? '一時解除の要求を受け付けた記録があります。' : '理由は保存されていますが、解除の受付は確認できません。'}</Body>
        {reason.body !== undefined && <Text selectable style={[styles.reason, { color: theme.text }]}>{reason.body}</Text>}
      </>}
      {!reason && !state.busy && <Body muted>理由を読み取れていません。記録がないとは扱っていません。</Body>}
    </Panel>}
    {row?.reasonDeleted && <Body muted>理由本文は削除済みです。操作の記録は残っています。</Body>}
    {row?.action === 'cancelled' && <Body muted>確定前に取り消した本文は保存していません。</Body>}
    {row && <Panel><Heading>このときの選択と結果</Heading>
      {row.expiresAt !== undefined && <Body>記録上の解除上限：{dateLabel(dayAt(row.expiresAt, zone))} {timeLabel(row.expiresAt, zone)}</Body>}
      <Body>{reason?.state === 'prepared-only' ? '理由の保存だけを確認しています。解除の成立を示す記録ではありません。' : choiceStatus(row)}</Body>
      <Body muted>解除を選んだことと、実際にアプリを使ったことは別です。上限まで利用した時間や集中の成果を示していません。</Body>
    </Panel>}
    {row && <Body muted>当時のアプリ名・ルール名・希望時間は、この記録に含まれていません。現在の設定から補っていません。</Body>}
    {row && <Disclosure label="処理の記録・補足"><Body muted>保存済みの要約を表示しています。個々の処理の全経過は、この記録に含まれていません。</Body><Body>{choiceStatus(row)}</Body></Disclosure>}
    {!row && !expected && !reason && <Body>記録の一覧から、見直したい選択を開いてください。</Body>}
    {state.selectedCommandID && !state.busy && !reason && <Button label="理由を再確認する" secondary onPress={() => state.readReason(state.selectedCommandID!)} />}
    <Button label="記録の一覧へ戻る" secondary onPress={close} />
  </FlowScreen>;
}
const styles = StyleSheet.create({
  feedStatus: { minHeight: 88, justifyContent: 'center', gap: 12 },
  segments: { flexDirection: 'row', borderRadius: 12, padding: 4, gap: 4 }, segment: { flex: 1, minHeight: 48, padding: 10, borderRadius: 9, justifyContent: 'center', alignItems: 'center' },
  dateControls: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, dateButton: { flex: 1, minWidth: 150, borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 50, justifyContent: 'center' },
  dayNavigation: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, reason: { fontSize: 18, lineHeight: 30 },
  disclosure: { gap: 12 }, disclosureButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
});
