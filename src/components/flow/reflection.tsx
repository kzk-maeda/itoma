import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useHistoryRecords } from '@/state/history';
import { useReflection } from '@/state/reflection';
import { back } from './navigation';
import { Body, Button, FlowScreen, Notice } from './ui';
import { ReflectionContent } from './reflection-content';
import { completeNativeReflectionSmoke } from '@/qa/native-smoke';

export function ReflectionScreen() {
  const state = useReflection(), history = useHistoryRecords();
  const { refresh } = state;
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  const onRead = useCallback((value: 'ready' | 'not-created' | 'error') => {
    completeNativeReflectionSmoke(value === 'not-created');
  }, []);
  const confirmDelete = () => Alert.alert('全記録と累計を削除しますか',
    '操作履歴、理由、振り返りの記録と累計を削除します。ルールと現在の一時解除は変わりません。削除前の記録を再取込しても復活させません。この操作は元に戻せません。', [
      { text: '戻る', style: 'cancel' },
      { text: '全記録と累計を削除する', style: 'destructive', onPress: () => state.mutate('deleteAll') },
    ]);
  return <FlowScreen title="自分の時間" onBack={back}>
    <Body>一時解除している時間を除いた記録を振り返ります。確認できない時間は、成果として加算しません。</Body>
    <Notice title="時間の集計は準備中です">このバージョンでは、制限を続けた時間をまだ集計できません。保存した操作の記録は確認できます。</Notice>
    <ReflectionContent source={state.source} embedded initialMemory={state.memory} onMemory={state.remember} onRead={onRead} disabled={state.busy}
      onDay={(day, snapshot) => {
        if (!snapshot.historyRevision) return;
        history.chooseReflectionDay(day, { revision: snapshot.historyRevision, asOf: snapshot.asOf, timeZone: snapshot.timeZone });
        router.navigate('/history');
      }} />
    {state.busy && <Body muted>記録への操作を確認しています。</Body>}
    {state.response?.status === 'error' && <Notice title="操作結果を確認できませんでした">
      {state.response.code === 'capacity-full' ? '記録の保存上限に達しています。不要な理由や操作履歴を削除した後、取込を再試行できます。'
        : '操作の結果と最新の記録を、もう一度確認してください。空の記録とは扱っていません。'}
    </Notice>}
    {state.response?.status === 'ok' && <Body muted>操作後の記録を読み直しています。</Body>}
    <Button label="新しい記録を取り込む" secondary disabled={state.busy} onPress={() => state.mutate('import')} />
    <Button label="選択の記録を見る" secondary disabled={state.busy} onPress={() => router.navigate('/history')} />
    <Button label="全記録と累計を削除する" secondary disabled={state.busy} onPress={confirmDelete} />
  </FlowScreen>;
}
