import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useHistoryRecords } from '@/state/history';
import { useReflection } from '@/state/reflection';
import { useProductTabs } from '@/state/product-tabs';
import { FlowScreen, LinkRow } from './ui';
import { ReflectionContent } from './reflection-content';
import { completeNativeReflectionSmoke } from '@/qa/native-smoke';

export function ReflectionScreen() {
  const state = useReflection(), history = useHistoryRecords(), tabs = useProductTabs();
  const { refresh } = state;
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  const onRead = useCallback((value: 'ready' | 'not-created' | 'error') => {
    completeNativeReflectionSmoke(value === 'not-created');
  }, []);
  return <FlowScreen title="振り返り" eyebrow="自分の時間を、振り返る" tab="reflection">
    <LinkRow label="選択の記録を見る" detail="そのときの理由と結果を、日付から見直す" onPress={() => router.navigate('/history')} />
    <ReflectionContent source={state.source} embedded initialMemory={state.memory} onMemory={state.remember} onRead={onRead} disabled={state.busy}
      visible={!tabs || (tabs.active && tabs.current === 'reflection')}
      onDay={(day, snapshot) => {
        if (!snapshot.historyRevision) return;
        history.chooseReflectionDay(day, { revision: snapshot.historyRevision, asOf: snapshot.asOf, timeZone: snapshot.timeZone });
        router.navigate('/history');
      }} />
  </FlowScreen>;
}
