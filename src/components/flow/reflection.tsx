import { router, useFocusEffect } from 'expo-router';
import { useCallback, useContext } from 'react';
import { ReflectionPreview } from '@/runtime/reflection-preview';
import { useHistoryRecords } from '@/state/history';
import { useReflection } from '@/state/reflection';
import { useProductTabs } from '@/state/product-tabs';
import { Body, FlowScreen, LinkRow } from './ui';
import { ReflectionContent } from './reflection-content';
import { completeNativeReflectionSmoke } from '@/qa/native-smoke';

export function ReflectionScreen() {
  const state = useReflection(), history = useHistoryRecords(), tabs = useProductTabs();
  const preview = useContext(ReflectionPreview);
  const { refresh } = state;
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  const onRead = useCallback((value: 'ready' | 'not-created' | 'error') => {
    completeNativeReflectionSmoke(value === 'not-created');
  }, []);
  return <FlowScreen title="振り返り" eyebrow="自分の時間を、振り返る" tab="reflection">
    <ReflectionContent source={state.source} embedded prototype={preview} initialMemory={state.memory} onMemory={state.remember} onRead={onRead} disabled={state.busy}
      visible={!tabs || (tabs.active && tabs.current === 'reflection')}
      onDay={(day, snapshot) => {
        if (preview) { history.choose('event', day); router.navigate('/history'); return; }
        if (!snapshot.historyRevision) return;
        history.chooseReflectionDay(day, { revision: snapshot.historyRevision, asOf: snapshot.asOf, timeZone: snapshot.timeZone });
        router.navigate('/history');
      }} />
    {preview && <Body muted>表示例：2026年11月15日時点。グラフと選択の記録は、それぞれ独立した架空データです。</Body>}
    <LinkRow label="すべての選択の記録を見る" detail="日付で絞らず、これまでの理由と結果を確認" onPress={() => { history.choose('event', ''); router.navigate('/history'); }} />
  </FlowScreen>;
}
