import { useAppNavigation } from '@/state/navigation';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useHistoryRecords } from '@/state/history';
import { useReflection } from '@/state/reflection';
import { useProductTabs } from '@/state/product-tabs';
import { FlowScreen, LinkRow } from './ui';
import { ReflectionContent } from './reflection-content';
import { completeNativeReflectionSmoke } from '@/qa/native-smoke';

export function ReflectionScreen() {
  const navigation = useAppNavigation();
  const state = useReflection(), history = useHistoryRecords(), tabs = useProductTabs();
  const { refresh } = state;
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  const onRead = useCallback((value: 'ready' | 'not-created' | 'error') => {
    completeNativeReflectionSmoke(value === 'not-created');
  }, []);
  return <FlowScreen title="振り返り" tab="reflection">
    <ReflectionContent source={state.source} embedded initialMemory={state.memory} onMemory={state.remember} onRead={onRead} disabled={state.busy}
      visible={!tabs || (tabs.active && tabs.current === 'reflection')}
      onDay={(day, snapshot) => {
        if (!snapshot.historyRevision) return;
        history.chooseReflectionDay(day, { revision: snapshot.historyRevision, asOf: snapshot.asOf, timeZone: snapshot.timeZone });
        navigation.open({ screen: 'history' });
      }} />
    <LinkRow label="すべての選択の記録を見る" detail="日付で絞らず、これまでの理由と結果を確認" onPress={() => { history.choose('event', ''); navigation.open({ screen: 'history' }); }} />
  </FlowScreen>;
}
