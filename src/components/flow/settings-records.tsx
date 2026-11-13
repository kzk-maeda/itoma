import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { useHistoryRecords } from '@/state/history';
import { useReflection } from '@/state/reflection';
import { back } from './navigation';
import { RecordStoragePanel } from './record-storage';
import { Body, Button, FlowScreen, Heading, LinkRow, Notice, Panel } from './ui';

export function RecordSettingsScreen() {
  return <FlowScreen title="記録とプライバシー" onBack={back}>
    <Body muted>記録は端末内で確認・管理できます。</Body>
    <Panel>
      <LinkRow label="選択の記録を見る" detail="保存した操作と、自分の言葉" onPress={() => router.navigate('/history')} />
      <LinkRow label="保存状況と取込" detail="使用量・上限・未取込の記録" onPress={() => router.navigate('/settings-storage')} />
      <LinkRow label="記録を削除する" detail="削除する範囲と、残るものを比較" onPress={() => router.navigate('/settings-delete')} />
    </Panel>
  </FlowScreen>;
}
export function RecordStorageScreen() {
  const history = useHistoryRecords(), reflection = useReflection(), { refresh } = history;
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  return <FlowScreen title="保存状況と取込" onBack={back}>
    {history.busy && <Body muted>保存状況を確認しています。</Body>}
    {history.error && <Notice title="保存状況を確認できません">端末のロックを解除してから、もう一度確認できます。確認できない量を0 MBとは扱いません。</Notice>}
    {history.storage === 'not-created' && !history.error && <Body>まだ記録の保存先が作られていません。容量と上限は保存先を確認できると表示します。</Body>}
    {history.page && <>
      <RecordStoragePanel page={history.page} />
      <Body muted>取得時点：{new Date(history.page.asOf * 1000).toLocaleString('ja-JP')}。取込・削除の後は最新の状態を確認できます。</Body>
      {history.page.incomplete && <Notice title="記録の一部が欠けている可能性があります">残っている記録を確認できます。取込を再試行しても、過去の欠損がすべて戻るとは限りません。</Notice>}
    </>}
    {history.page && history.page.transfer !== 'current' && <Notice title={history.page.transfer === 'pending' ? '未取込の操作記録があります' : '操作記録の取込状況を確認できません'}>保存済みの記録は確認できます。新しい記録はご自身で取り込めます。</Notice>}
    {reflection.response?.sharedIncomplete && <Notice title="状態の記録に欠落の可能性があります">取込の成功だけで、過去の欠損が復元されたとは扱いません。</Notice>}
    <Panel><Heading>新しい記録の取込</Heading><Body>未取込の操作と状態の記録を端末内の保存先へ取り込みます。制限の変更や外部との同期はしません。一度に取り込める量には限りがあります。</Body>
      {reflection.response && <Body muted>{reflection.response.status === 'error' ? reflection.response.code === 'capacity-full' ? '保存上限に達しています。不要な記録を削除してから再試行できます。' : '取込結果を確認できません。もう一度試すか、保存状況を確認できます。' : reflection.response.transfer === 'pending' ? '未取込の記録が残っています。引き続き取り込めます。' : reflection.response.transfer === 'current' ? '取得時点で未取込の状態記録はありません。' : '新しい状態記録の取込状況を確認できません。'}</Body>}
      <Button label="新しい記録を取り込む" secondary disabled={reflection.busy || history.busy} onPress={() => reflection.mutate('import')} />
    </Panel>
    <Button label="保存状況を確認し直す" secondary disabled={history.busy || reflection.busy} onPress={refresh} />
    <LinkRow label="記録を削除する" onPress={() => router.navigate('/settings-delete')} />
  </FlowScreen>;
}
export function RecordDeletionScreen() {
  const history = useHistoryRecords(), reflection = useReflection();
  const pending = useRef(false), mounted = useRef(true);
  const [result, setResult] = useState<string>();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const remove = async (scope: 'reasons' | 'history' | 'all') => {
    if (pending.current) return;
    pending.current = true; setResult('削除の結果を確認しています。');
    try {
      const response = scope === 'all' ? await reflection.mutate('deleteAll') : await history.mutate(scope === 'history' ? 'deleteHistory' : 'deleteReasons');
      if (mounted.current) setResult(response?.status === 'ok' ? response.storage === 'not-created' ? '保存済みの記録はありません。' : scope === 'all' ? '全記録と累計の削除を確認しました。' : scope === 'history' ? '操作履歴と理由の削除を確認しました。' : '理由本文の削除を確認しました。' : '削除結果を確認できません。保存状況を確認してから、必要なら再試行できます。');
    } catch { if (mounted.current) setResult('削除結果を確認できません。保存状況を確認してから、必要なら再試行できます。'); }
    finally { pending.current = false; }
  };
  const confirm = (scope: 'reasons' | 'history' | 'all') => {
    const title = scope === 'reasons' ? '保存した理由をすべて削除しますか' : scope === 'history' ? '操作履歴と理由を削除しますか' : '全記録と累計を削除しますか';
    const detail = scope === 'reasons' ? '理由本文のみを削除します。操作と振り返りの記録・累計は残ります。' : scope === 'history' ? '操作履歴と理由本文を削除します。振り返りの記録と累計は残ります。' : '操作履歴、理由、振り返りの記録と累計を削除します。';
    const label = scope === 'reasons' ? '理由をすべて削除する' : scope === 'history' ? '操作履歴と理由を削除する' : '全記録と累計を削除する';
    Alert.alert(title, `${detail}ルールと現在の一時解除は変わりません。この操作は元に戻せません。`, [
      { text: '戻る', style: 'cancel' }, { text: label, style: 'destructive', onPress: () => { void remove(scope); } },
    ]);
  };
  const busy = history.busy || reflection.busy;
  return <FlowScreen title="記録を削除する" onBack={back}>
    <Body>削除する範囲を選んだ後、最後に確認します。どの範囲でもルールと現在の一時解除は残ります。</Body>
    {result && <View accessibilityLiveRegion="polite"><Body>{result}</Body></View>}
    {(history.error || reflection.response?.status === 'error') && <Notice title="操作結果を確認してください">完了したとは扱わず、保存状況や記録を確認してから再試行できます。</Notice>}
    <Panel><Heading>理由本文のみ</Heading><Body>削除：保存した理由の文章。残るもの：操作と振り返りの記録・累計。</Body><Button label="理由本文のみの削除を確認" secondary disabled={busy} onPress={() => confirm('reasons')} /></Panel>
    <Panel><Heading>操作履歴と理由</Heading><Body>削除：操作の一覧と理由本文。残るもの：振り返りの記録・累計。</Body><Button label="操作履歴と理由の削除を確認" secondary disabled={busy} onPress={() => confirm('history')} /></Panel>
    <Panel><Heading>全記録と累計</Heading><Body>削除：理由・操作・振り返りの記録と累計。削除前の記録を取り込んでも復活させません。</Body><Button label="全記録と累計を削除する" secondary disabled={busy} onPress={() => confirm('all')} /></Panel>
    <LinkRow label="保存状況を確認する" onPress={() => router.navigate('/settings-storage')} />
  </FlowScreen>;
}
