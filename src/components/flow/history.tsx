import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { useHistoryRecords } from '@/state/history';
import { completeNativeHistorySmoke } from '@/qa/native-smoke';
import type { HistoryCode, HistoryRow } from '../../../modules/itoma-native';
import { back } from './navigation';
import { Body, Button, Field, FlowScreen, Heading, Notice, Panel, flowStyles } from './ui';

const actions: Record<HistoryRow['action'], string> = { reason: '保存した理由', cancelled: '確定前の取消', commitPolicy: 'ルールの変更', requestTemporaryGrant: '一時解除の要求', retryCommand: '要求の再試行', resumeAfterAuthorization: 'ルールの再開', stop: 'ルールの停止' };
const statuses: Record<HistoryRow['status'], string> = { prepared: '理由の保存', pending: '受付済み', scheduling: '予定を登録中', applying: '反映処理中', succeeded: '処理の完了を記録', failed: '処理できませんでした', uncertain: '反映を確認できません', superseded: '新しい操作に置き換え済み', expired: '期限が終了', cancelled: '取消済み' };
const grantStatuses: Record<string, string> = { pending: '受付済み', scheduling: '予定登録中', applying: '反映処理中', active: '解除の反映を確認', expired: '期限終了', invalidated: '条件変更により終了', reblockPending: '再制限の処理待ち', reconciled: '再制限の反映を確認', uncertain: '反映が不明', failed: '処理失敗' };
const errors: Record<HistoryCode, string> = { unavailable: 'この環境では履歴を利用できません。履歴機能を含むiPhone版で確認できます。', 'storage-failed': '保存した記録を読み取れません。空の履歴とは扱わず、端末のロックを解除してから再度確認してください。', busy: '前の操作を確認しています。少し待ってから再度確認できます。', changed: '記録が更新されました。古いページは閉じています。最新の記録を確認してください。', 'invalid-input': '日付をYYYY-MM-DDの形式で確認してください。', 'capacity-full': '記録を保存する上限に達しました。不要な理由や操作履歴を削除してから、取込を再試行できます。' };
const when = (at: number) => new Date(at * 1000).toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
function bytes(value: string) { const number = Number(value); return number >= 1_048_576 ? `${(number / 1_048_576).toFixed(2)} MiB` : `${value} B`; }

export function HistoryScreen() {
  const state = useHistoryRecords(), [day, setDay] = useState(state.day);
  const { refresh } = state;
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  useEffect(() => {
    if (!state.busy && (state.storage === 'not-created' || state.error)) completeNativeHistorySmoke(state.storage === 'not-created' && !state.error);
  }, [state.busy, state.storage, state.error]);
  const page = state.page;
  const confirmDelete = (all: boolean) => Alert.alert(all ? '保存した操作履歴と理由を削除しますか' : '保存した理由をすべて削除しますか',
    all ? '保存済みの操作記録と理由本文を削除します。ルールと現在の一時解除は変わりません。削除前の記録を再取込しても復活させません。この操作は元に戻せません。' : '理由本文を削除します。操作の記録、ルール、現在の一時解除は変わりません。この操作は元に戻せません。', [
      { text: '戻る', style: 'cancel' }, { text: all ? '履歴と理由を削除する' : '理由をすべて削除する', style: 'destructive', onPress: () => state.mutate(all ? 'deleteHistory' : 'deleteReasons') },
    ]);
  const files = page && page.databaseBytes !== undefined && page.walBytes !== undefined && page.sharedMemoryBytes !== undefined
    ? (BigInt(page.databaseBytes) + BigInt(page.walBytes) + BigInt(page.sharedMemoryBytes)).toString() : undefined;
  return <FlowScreen title="あなたの選択の記録" onBack={back}>
    <Body>保存した操作と、自分の言葉を確認できます。ここにあるのは操作時点の記録で、実際の利用時間や現在の制限を測定したものではありません。</Body>
    {state.error && <View accessibilityLiveRegion="polite"><Notice title="記録を確認してください">{errors[state.error]}</Notice></View>}
    <View style={flowStyles.row}>
      <Button label={state.kind === 'event' ? '✓ 操作の記録' : '操作の記録'} secondary disabled={state.busy} onPress={() => state.choose('event', state.day)} />
      <Button label={state.kind === 'reason' ? '✓ 保存した理由' : '保存した理由'} secondary disabled={state.busy} onPress={() => state.choose('reason', state.day)} />
    </View>
    <Field label="日付で絞り込む（YYYY-MM-DD・空欄はすべて）" value={day} onChangeText={setDay} autoCapitalize="none" keyboardType="numbers-and-punctuation" />
    <Button label="この日付の記録を見る" secondary disabled={state.busy} onPress={() => state.choose(state.kind, day)} />
    {state.busy && <Body muted>記録を確認しています。</Body>}
    {state.storage === 'not-created' && <Panel><Heading>まだ保存された記録がありません</Heading><Body>ルールの保存や、理由を確定した後の記録をここで確認できます。</Body></Panel>}
    {page && <>
      {page.incomplete && <Notice title="記録の一部が欠けている可能性があります">残っている記録だけを表示しています。取込を再試行しても、保存できなかった過去の記録がすべて戻るとは限りません。</Notice>}
      {page.transfer !== 'current' && <Notice title={page.transfer === 'pending' ? '未取込の記録があります' : '新しい記録の取込状況を確認できません'}>保存済みの記録は下で確認できます。取込はご自身で再試行できます。</Notice>}
      <Body muted>取得時点：{when(page.asOf)} · {page.timeZone}。表示は新しい記録から、最大40件ずつです。</Body>
      <Button label="新しい記録を取り込む" secondary disabled={state.busy} onPress={() => state.mutate('import')} />
      <View style={flowStyles.row}>
        <Button label="新しい40件へ" secondary disabled={state.busy || !page.previous} onPress={() => { if (page.previous) state.move(page.previous, 'newer'); }} />
        <Button label="前の40件へ" secondary disabled={state.busy || !page.next} onPress={() => { if (page.next) state.move(page.next, 'older'); }} />
      </View>
      {!page.rows.length && <Body>この範囲に保存された記録はありません。</Body>}
      {page.rows.map((row) => <Panel key={row.key}>
        <Heading>{actions[row.action]}</Heading><Body muted>{when(row.at)}</Body>
        <Body>{row.reasonDeleted ? '理由本文は削除済みです' : `記録時の状態：${statuses[row.status]}`}</Body>
        {row.grantStatus && <Body muted>解除の記録：{grantStatuses[row.grantStatus] ?? '状態を確認できません'}</Body>}
        {row.expiresAt !== undefined && <Body>記録上の解除上限：{when(row.expiresAt)}</Body>}
        {row.action === 'cancelled' && <Body muted>確定前に取り消した本文は保存していません。</Body>}
        {(row.action === 'reason' || row.action === 'requestTemporaryGrant') && row.commandID && !row.reasonDeleted && <Button label="この記録の理由を読む" secondary disabled={state.busy} onPress={() => { state.readReason(row.commandID!); router.push('/history-reason'); }} />}
      </Panel>)}
      <Panel><Heading>記録の保存容量</Heading>
        <Body>保存内容：{bytes(page.logicalBytes)} / 上限 {bytes(page.maximumBytes)}</Body>
        <Body muted>警告の目安：{bytes(page.warningBytes)}</Body>
        <Body>関連ファイル合計（観測値）：{files === undefined ? '確認できません' : bytes(files)}</Body>
        <Body muted>保存内容の量とファイル使用量は別の値です。削除してもファイルの大きさがすぐ小さくなるとは限りません。</Body>
        {(page.warningReached || page.limitReached) && <Notice title={page.limitReached ? '保存内容の上限です' : '保存内容が増えています'}>不要な理由や操作履歴をご自身で削除できます。上限では新しい内容の保存を停止します。過去の内容を自動削除しません。</Notice>}
        <Button label="理由の全削除を確認" secondary disabled={state.busy} onPress={() => confirmDelete(false)} />
        <Button label="操作履歴と理由の全削除を確認" secondary disabled={state.busy} onPress={() => confirmDelete(true)} />
      </Panel>
    </>}
    <Button label="最新の記録を確認する" secondary disabled={state.busy} onPress={refresh} />
  </FlowScreen>;
}

export function HistoryReasonScreen() {
  const state = useHistoryRecords(), reason = state.reason;
  const close = () => { state.closeReason(); back(); };
  return <FlowScreen title="保存した理由" onBack={close}>
    {state.error && <Notice title="記録を確認してください">{errors[state.error]}</Notice>}
    {state.busy && <Body>理由を確認しています。</Body>}
    {reason && <Panel><Heading>あなたの言葉</Heading>
      <Body>{reason.state === 'deleted' ? '理由本文は削除済みです。' : reason.state === 'missing' ? 'この要求に紐づく理由の保存を確認できません。'
        : reason.state === 'prepared-only' ? '理由の保存だけを確認しました。一時解除の受付記録はありません。'
          : reason.state === 'shared-accepted' ? '一時解除の要求を受け付けた記録があります。反映の結果は操作の記録で確認できます。' : '理由は保存されていますが、解除の受付は確認できません。'}</Body>
      {reason.body !== undefined && <Body>{reason.body}</Body>}
    </Panel>}
    {!reason && !state.busy && <Body>記録の一覧から理由を選ぶか、再度確認できます。</Body>}
    {state.selectedCommandID && <Button label="理由を再確認する" secondary disabled={state.busy} onPress={() => state.readReason(state.selectedCommandID!)} />}
    <Button label="記録の一覧へ戻る" secondary onPress={close} />
  </FlowScreen>;
}
