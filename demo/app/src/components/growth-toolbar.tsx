import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useFlowTheme } from '@/components/flow/ui';
import { growthScenes } from '../scenarios/time-growth';
import { circleStyles } from '../scenarios/circle-styles';
import { useGrowth } from '../state/time-growth';
export function GrowthToolbar() {
  const { scene, choose, look, chooseLook } = useGrowth(), theme = useFlowTheme(), [open, setOpen] = useState<'time' | 'design' | undefined>();
  const after = 'after' in scene ? scene.after : undefined, selected = circleStyles.find(option => option.id === look)!;
  return <View style={{ backgroundColor: theme.background, borderBottomWidth: 1, borderColor: theme.line }}><View style={{ width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 24 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="サークルのデザインを切り替える" accessibilityState={{ expanded: open === 'design' }} onPress={() => setOpen(open === 'design' ? undefined : 'design')} style={{ minHeight: 44, paddingVertical: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}><Text style={{ color: theme.text, fontSize: 13, lineHeight: 21 }}>{selected.label}</Text><Text style={{ color: theme.muted, fontSize: 12, lineHeight: 20 }}>デザイン {open === 'design' ? '−' : '＋'}</Text></Pressable>
    {open === 'design' && <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ gap: 6, paddingVertical: 8 }}>{circleStyles.map(option => <Pressable key={option.id} accessibilityRole="button" accessibilityLabel={option.label} accessibilityState={{ selected: look === option.id }} onPress={() => { chooseLook(option.id); router.setParams({ look: option.id }); setOpen(undefined); }} style={{ minHeight: 56, padding: 10, gap: 3, borderWidth: 1, borderColor: look === option.id ? theme.accent : theme.line, borderRadius: 10 }}><Text style={{ color: theme.text, fontSize: 14, lineHeight: 22 }}>{look === option.id ? '● ' : '○ '}{option.label}</Text><Text style={{ color: theme.muted, fontSize: 12, lineHeight: 20 }}>{option.note}</Text></Pressable>)}</ScrollView>}
    <Pressable accessibilityRole="button" accessibilityLabel="デモの時間を切り替える" accessibilityState={{ expanded: open === 'time' }} onPress={() => setOpen(open === 'time' ? undefined : 'time')} style={{ minHeight: 56, paddingVertical: 10, gap: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 20 }}>架空の記録 · {scene.label}</Text><Text style={{ color: theme.text, fontSize: 12, lineHeight: 20 }}>{open === 'time' ? '閉じる −' : '場面を切替 ＋'}</Text>
    </Pressable>
    {after && !open && <Pressable accessibilityRole="button" accessibilityLabel="20分を重ねる" onPress={() => choose(after)} style={{ minHeight: 44, borderWidth: 1, borderColor: theme.accent, borderRadius: 10, padding: 10, marginBottom: 10 }}><Text style={{ color: theme.text, fontSize: 14, lineHeight: 22 }}>20分を重ねて、単位の変化を見る →</Text></Pressable>}
    {open === 'time' && <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ gap: 6, paddingBottom: 12 }}>{growthScenes.map(option => <Pressable key={option.id} accessibilityRole="button" accessibilityLabel={option.label} accessibilityState={{ selected: scene.id === option.id }} onPress={() => { choose(option.id); setOpen(undefined); }} style={{ minHeight: 44, padding: 10, borderWidth: 1, borderColor: scene.id === option.id ? theme.accent : theme.line, borderRadius: 10 }}><Text style={{ color: theme.text, fontSize: 14, lineHeight: 22 }}>{scene.id === option.id ? '● ' : '○ '}{option.label}</Text></Pressable>)}<Text style={{ color: theme.muted, fontSize: 12, lineHeight: 20 }}>日・月・年の境目を試せます。全て固定の架空値で、実際の記録・保存は使いません。</Text></ScrollView>}
  </View></View>;
}
