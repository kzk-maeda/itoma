import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useHistoryRecords } from '@/state/history';
import { useReflection } from '@/state/reflection';
import { useProductTabs } from '@/state/product-tabs';
import { FlowScreen } from './ui';
import { ReflectionContent } from './reflection-content';
import { completeNativeReflectionSmoke } from '@/qa/native-smoke';

export function ReflectionScreen() {
  const state = useReflection(), history = useHistoryRecords(), tabs = useProductTabs();
  const { refresh } = state;
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  const onRead = useCallback((value: 'ready' | 'not-created' | 'error') => {
    completeNativeReflectionSmoke(value === 'not-created');
  }, []);
  return <FlowScreen title="時間の積み上げ" eyebrow="自分の時間を、振り返る" tab="reflection">
    <ReflectionContent source={state.source} embedded initialMemory={state.memory} onMemory={state.remember} onRead={onRead} disabled={state.busy}
      visible={!tabs || (tabs.active && tabs.current === 'reflection')}
      onDay={(day, snapshot) => {
        if (!snapshot.historyRevision) return;
        history.chooseReflectionDay(day, { revision: snapshot.historyRevision, asOf: snapshot.asOf, timeZone: snapshot.timeZone });
        router.navigate('/history');
      }} />
  </FlowScreen>;
}
