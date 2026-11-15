import { router, useFocusEffect } from 'expo-router';
import { type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useHistoryRecords } from '@/state/history';
import { HistoricalChoices, HistoryPresentation } from '@/runtime/history-context';
import { completeNativeHistorySmoke } from '@/qa/native-smoke';
import type { HistoryCode, HistoryRow } from '../../../modules/itoma-native';
import { back } from './navigation';
import { Body, Button, FlowScreen, Heading, LinkRow, Notice, Panel, flowStyles, useFlowTheme } from './ui';
import { HistoryCalendar } from './history-calendar';
import { canReadChoiceReason, choiceRecordTitle, choiceStatus, choiceTitle, dateLabel, dayAt, groupChoices, moveDay, timeLabel } from './history-presentation';
import { HistoryTimelineEntry } from './history-timeline';

const errors: Record<HistoryCode, string> = { unavailable: 'この環境では履歴を利用できません。履歴機能を含むiPhone版で確認できます。', 'storage-failed': '記録を読み取れませんでした。記録がないとは扱っていません。端末のロックを解除して、もう一度確認できます。', busy: '前の操作を確認しています。少し待ってから再度確認できます。', changed: '記録が更新されました。最新の内容を読み直してください。', 'invalid-input': '日付を確認してください。', 'capacity-full': '保存する上限に達しました。設定で記録を確認し、取込を再試行できます。' };
function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false), theme = useFlowTheme();
  return <View style={styles.disclosure}><Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} aria-expanded={open} onPress={() => setOpen(value => !value)} style={styles.disclosureButton}>
    <Text style={{ color: theme.text, fontSize: 14, flex: 1 }}>{label}</Text><Text accessible={false} style={{ color: theme.muted }}>{open ? '−' : '＋'}</Text>
  </Pressable>{open && <View style={flowStyles.section}>{children}</View>}</View>;
}
export function HistoryScreen() {
  const state = useHistoryRecords(), theme = useFlowTheme(), contexts = useContext(HistoricalChoices);
  const presentation = useContext(HistoryPresentation);
  const [calendar, setCalendar] = useState(false), [viewedAt, setViewedAt] = useState(Date.now);
  const { refresh, ensureLoaded, pauseOlder } = state;
  const focused = useRef(false);
  useFocusEffect(useCallback(() => {
    focused.current = true; setViewedAt(Date.now());
    ensureLoaded();
    return () => { focused.current = false; pauseOlder(); };
  }, [ensureLoaded, pauseOlder]));
  useEffect(() => {
    if (!state.busy && (state.storage === 'not-created' || state.error)) completeNativeHistorySmoke(state.storage === 'not-created' && !state.error);
  }, [state.busy, state.storage, state.error]);
  const page = state.page, zone = page?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = dayAt(viewedAt / 1000, zone), selectedDay = state.day || today;
  const grouped = groupChoices(presentation === 'timeline' ? state.rows : page?.rows ?? []);
  const timelineRows = grouped.map(group => group.row);
  const chooseDay = (day: string) => { state.choose(state.kind, day); setCalendar(false); };
  const footer = <>
    {presentation === 'timeline' && page && state.rows.length > 0 && !state.error && <View style={styles.feedStatus} accessibilityLiveRegion="polite">
      {state.loadingOlder ? <Body muted>過去の記録を読み込んでいます。</Body>
        : state.olderError ? <><Body>過去の記録を読み込めませんでした。表示済みの記録は残っています。</Body><Button label="過去の記録を再読み込み" secondary onPress={() => { void state.loadOlder(true); }} /></>
          : state.next ? <Button label="過去の記録を読み込む" secondary disabled={state.busy} onPress={() => { void state.loadOlder(); }} />
            : <Body muted>{state.day ? 'この日の記録はここまでです。' : 'この範囲の記録はここまでです。'}</Body>}
    </View>}
    {presentation === 'list' && !!page && (page.next || page.previous) && <View style={styles.dayNavigation}>
      {page.previous && <Button label="新しい記録へ" secondary disabled={state.busy} onPress={() => state.move(page.previous!, 'newer')} />}
      {page.next && <Button label="前の記録へ" secondary disabled={state.busy} onPress={() => state.move(page.next!, 'older')} />}
    </View>}
    {state.reference && page && (state.reference.revision !== page.revision || state.reference.asOf !== page.asOf || state.reference.timeZone !== page.timeZone) && <Body muted>振り返りとは別の時点の記録です。時間の集計と一致する一覧とは限りません。</Body>}
    {contexts && <Text style={[styles.caption, { color: theme.muted }]}>デモ：アプリ・ルールは「当時の情報を保存する案」です。現行の履歴には含まれません。</Text>}
    <Disclosure label="記録について・保存状況">
      <Body muted>これは選択や処理の記録です。実際の利用時間や集中の成果、現在の制限を示すものではありません。</Body>
      {page && <Body muted>取得時点：{new Date(page.asOf * 1000).toLocaleString('ja-JP', { timeZone: zone })} · {zone}。最大40件ずつ。関連する処理は{presentation === 'timeline' ? '読み込んだ範囲' : 'このページ内'}でまとめています。</Body>}
      <LinkRow label="記録の保存状況を確認する" onPress={() => router.navigate('/settings-storage')} />
    </Disclosure>
    <Button label="最新の記録を確認する" secondary disabled={state.busy} onPress={presentation === 'timeline' ? state.restart : refresh} />
  </>;
  return <FlowScreen<HistoryRow> title="あなたの選択の記録" onBack={back} footer={footer}
    list={presentation === 'timeline' ? {
      viewKey: `${state.kind}:${state.day}:${state.viewGeneration}`, data: timelineRows, keyExtractor: row => row.key, extraData: [zone, today, state.busy],
      onEndReachedThreshold: 0.6, onEndReached: () => { if (focused.current) void state.loadOlder(); },
      renderItem: ({ item: row, index }) => <HistoryTimelineEntry row={row} zone={zone} today={today} busy={state.busy}
        first={index === 0 || dayAt(timelineRows[index - 1].at, zone) !== dayAt(row.at, zone)}
        continues={index + 1 < timelineRows.length && dayAt(timelineRows[index + 1].at, zone) === dayAt(row.at, zone)}
        onOpen={item => { state.openRecord(item); router.push('/history-reason'); }} />,
    } : undefined}>
    <Body muted>そのとき、何を選んだか。理由と結果を、一つずつ見直せます。</Body>
    <View style={[styles.segments, { backgroundColor: theme.background }]}>
      {(['event', 'reason'] as const).map(kind => <Pressable key={kind} accessibilityRole="button" accessibilityState={{ selected: state.kind === kind, disabled: state.busy }} aria-pressed={state.kind === kind} disabled={state.busy}
        onPress={() => state.choose(kind, state.day)} style={[styles.segment, { backgroundColor: state.kind === kind ? theme.surface : 'transparent' }]}>
        <Text style={{ color: state.kind === kind ? theme.text : theme.muted, fontSize: 14, fontWeight: state.kind === kind ? '600' : '400' }}>{kind === 'event' ? '操作と結果' : '保存した理由'}</Text>
      </Pressable>)}
    </View>
    {state.kind === 'reason' && <Body muted>解除の受付に至らず、理由だけを保存した記録も確認できます。</Body>}
    <View style={styles.dateControls}>
      <Pressable accessibilityRole="button" accessibilityLabel="日付を選ぶ" accessibilityState={{ expanded: calendar, disabled: state.busy }} aria-expanded={calendar} disabled={state.busy} onPress={() => setCalendar(value => !value)} style={[styles.dateButton, { borderColor: theme.line }]}>
        <Text style={{ color: theme.text, fontSize: 15 }}>{state.day ? dateLabel(state.day) : 'すべての日'}　⌄</Text>
      </Pressable>
      {state.day ? <Button label="すべての日へ" secondary disabled={state.busy} onPress={() => chooseDay('')} /> : <Button label="今日" secondary disabled={state.busy} onPress={() => chooseDay(today)} />}
    </View>
    {calendar && <HistoryCalendar initialDay={selectedDay} onChoose={chooseDay} onClose={() => setCalendar(false)} />}
    {!!state.day && <View style={styles.dayNavigation}><Button label="前の日" secondary disabled={state.busy} onPress={() => chooseDay(moveDay(state.day, -1))} /><Button label="次の日" secondary disabled={state.busy} onPress={() => chooseDay(moveDay(state.day, 1))} /></View>}
    {state.error && <View accessibilityLiveRegion="polite"><Notice title="記録を確認してください">{errors[state.error]}</Notice></View>}
    {state.pages.some(p => p.incomplete) && <Notice title="記録が一部欠けている可能性があります">確認できる記録だけを表示しています。</Notice>}
    {page && state.pages.some(p => p.transfer !== 'current') && <Notice title={state.pages.some(p => p.transfer === 'pending') ? 'まだ取り込んでいない記録があります' : '新しい記録の取込状況は未確認です'}>保存済みの記録は下で確認できます。</Notice>}
    {state.busy && <Body muted>記録を確認しています。</Body>}
    {state.storage === 'not-created' && !state.error && <Panel><Heading>これからの選択を、ここに。</Heading><Body>理由の保存や、設定を見直したときの記録を確認できます。</Body></Panel>}
    {!!page && !state.error && !state.busy && !grouped.length && <Panel><Heading>{state.day ? 'この日の記録はありません' : 'この範囲に記録はありません'}</Heading><Body>{state.kind === 'event' ? '理由だけの保存は「保存した理由」から確認できます。' : 'ここで確認できる理由の記録はありません。'}</Body>{state.day && <Button label="すべての日の記録を見る" secondary onPress={() => chooseDay('')} />}</Panel>}
    {presentation === 'timeline' && <View testID="history-timeline">{page?.previous && <Button label="新しい記録から見る" secondary onPress={state.restart} />}{grouped.length > 0 && <Body muted>新しい記録から</Body>}</View>}
    {presentation === 'list' && grouped.map((group, index) => {
      const row = group.row, context = contexts?.(row), day = dayAt(row.at, zone), first = index === 0 || dayAt(grouped[index - 1].row.at, zone) !== day;
      const label = choiceRecordTitle(row, context?.applicationLabel);
      return <View key={row.key} style={styles.dayGroup}>
        {first && <Text accessibilityRole="header" style={[styles.dateHeading, { color: theme.text }]}>{day === today ? '今日' : day === moveDay(today, -1) ? '昨日' : dateLabel(day)} {(day === today || day === moveDay(today, -1)) && <Text style={{ color: theme.muted, fontWeight: '400' }}>{dateLabel(day)}</Text>}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}、${timeLabel(row.at, zone)}、${choiceStatus(row)}。詳細を見る`} disabled={state.busy}
          testID={`history-choice-${row.key}`} onPress={() => { state.openRecord(row); router.push('/history-reason'); }} style={({ pressed }) => [styles.record, { borderColor: theme.line, opacity: pressed ? 0.75 : 1 }]}>
          <View style={styles.recordHeader}><View style={styles.timeColumn}><Text style={[styles.caption, { color: theme.muted }]}>記録</Text><Text style={[styles.time, { color: theme.muted }]}>{timeLabel(row.at, zone)}</Text></View><View style={styles.recordBody}>
            <Text style={[styles.recordTitle, { color: theme.text }]}>{label}</Text>
            <Text style={[styles.status, { color: theme.text, backgroundColor: theme.soft }]}>{choiceStatus(row)}</Text>
            {row.expiresAt !== undefined && <Text style={[styles.caption, { color: theme.muted }]}>記録上の上限 {timeLabel(row.expiresAt, zone)}</Text>}
            <Text style={[styles.caption, { color: theme.muted }]}>{row.reasonDeleted ? '理由は削除済み · 結果を見る' : canReadChoiceReason(row) ? '理由と結果を見る' : '記録を見る'}　›</Text>
          </View></View>
        </Pressable>
      </View>;
    })}

  </FlowScreen>;
}

export function HistoryReasonScreen() {
  const state = useHistoryRecords(), row = state.selectedRow, reason = state.reason, contexts = useContext(HistoricalChoices), theme = useFlowTheme();
  const context = row ? contexts?.(row) : undefined, zone = state.page?.timeZone ?? 'UTC';
  const related = row?.commandID ? state.rows.filter(item => item.commandID === row.commandID) : row ? [row] : [];
  const close = () => { state.closeReason(); back(); };
  const reasonExpected = !!state.selectedCommandID;
  return <FlowScreen title="選択の詳細" onBack={close}>
    {state.error && <Notice title="記録を確認してください">{errors[state.error]}</Notice>}
    {row && <View style={flowStyles.section}>
      <Text style={[styles.caption, { color: theme.muted }]}>記録日時：{dateLabel(dayAt(row.at, zone))} · {timeLabel(row.at, zone)}</Text>
      <Heading>{choiceRecordTitle(row, context?.applicationLabel)}</Heading>
      <Text style={[styles.status, { color: theme.text, backgroundColor: theme.soft }]}>{reason?.state === 'prepared-only' ? '理由の保存のみ' : choiceStatus(row)}</Text>
    </View>}
    {context?.goal && <View style={[styles.goal, { backgroundColor: theme.purposeSurface }]}><Text style={[styles.caption, { color: theme.muted }]}>当時、大切にしたかったこと</Text><Body>{context.goal}</Body></View>}
    {(reasonExpected || reason) && <Panel><Heading>あなたの理由</Heading>
      {state.busy && <Body muted>理由を確認しています。</Body>}
      {reason && <>
        <Body>{reason.state === 'deleted' ? '理由本文は削除済みです。' : reason.state === 'missing' ? 'この記録に紐づく理由を確認できません。'
          : reason.state === 'prepared-only' ? '理由の保存だけを確認しました。一時解除の受付記録はありません。'
            : reason.state === 'shared-accepted' ? '保存した理由です。' : '理由は保存されていますが、解除の受付は確認できません。'}</Body>
        {reason.body !== undefined && <Text selectable style={[styles.reason, { color: theme.text }]}>{reason.body}</Text>}
      </>}
      {!reason && !state.busy && <Body muted>理由を読み取れていません。記録がないとは扱っていません。</Body>}
    </Panel>}
    {row?.reasonDeleted && <Body muted>理由本文は削除済みです。操作の記録は残っています。</Body>}
    {row?.action === 'cancelled' && <Body muted>確定前に取り消した本文は保存していません。</Body>}
    {row && <Panel><Heading>このときの選択と結果</Heading>
      {context?.ruleTitle && <Body>ルール：{context.ruleTitle}</Body>}
      {context?.requestedMinutes !== undefined && <Body>希望した時間：{context.requestedMinutes}分</Body>}
      {row.expiresAt !== undefined && <Body>記録上の解除上限：{timeLabel(row.expiresAt, zone)}</Body>}
      <Body>{reason?.state === 'prepared-only' ? '理由の保存だけを確認しています。解除の成立を示す記録ではありません。' : choiceStatus(row)}</Body>
      <Body muted>解除を選んだことと、実際にアプリを使ったことは別です。上限まで利用した時間や集中の成果を示していません。</Body>
    </Panel>}
    {row && !context && <Body muted>当時のアプリ名・ルール名・希望時間は、この記録に含まれていません。現在の設定から補っていません。</Body>}
    {contexts && context && <Body muted>当時の情報を保存するデモ案です。現行のnative履歴から取得した情報ではありません。</Body>}
    {row && <Disclosure label="処理の記録・補足">
      <Body muted>読み込んだ範囲で確認できる関連記録です。すべての経過が含まれるとは限りません。</Body>
      {related.slice().reverse().map(item => <View key={item.key} style={flowStyles.section}><Body muted>{timeLabel(item.at, zone)} · {choiceTitle(item)}</Body><Body>{choiceStatus(item)}</Body></View>)}
    </Disclosure>}
    {!row && !reasonExpected && !reason && <Body>記録の一覧から、見直したい選択を開いてください。</Body>}
    {state.selectedCommandID && !state.busy && !reason && <Button label="理由を再確認する" secondary onPress={() => state.readReason(state.selectedCommandID!)} />}
    <Button label="記録の一覧へ戻る" secondary onPress={close} />
  </FlowScreen>;
}
const styles = StyleSheet.create({
  feedStatus: { minHeight: 88, justifyContent: 'center', gap: 12 },
  segments: { flexDirection: 'row', borderRadius: 12, padding: 4, gap: 4 }, segment: { flex: 1, minHeight: 48, padding: 10, borderRadius: 9, justifyContent: 'center', alignItems: 'center' },
  dateControls: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, dateButton: { flex: 1, minWidth: 150, borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 50, justifyContent: 'center' },
  dayNavigation: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, dayGroup: { gap: 8 }, dateHeading: { fontSize: 15, lineHeight: 24, fontWeight: '600', marginTop: 8 },
  record: { borderBottomWidth: 1, paddingVertical: 18, minHeight: 88 }, recordHeader: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  timeColumn: { minWidth: 42 }, time: { fontSize: 13, lineHeight: 24, minWidth: 42 }, recordBody: { flex: 1, gap: 8, minWidth: 0 }, recordTitle: { fontSize: 17, lineHeight: 27, fontWeight: '500' },
  status: { alignSelf: 'flex-start', fontSize: 12, lineHeight: 20, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }, caption: { fontSize: 13, lineHeight: 21 },
  goal: { padding: 18, borderRadius: 16, gap: 8 }, reason: { fontSize: 18, lineHeight: 30 },
  disclosure: { gap: 12 }, disclosureButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
});
