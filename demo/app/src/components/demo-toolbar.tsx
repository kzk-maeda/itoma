import { router, usePathname, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFlowTheme } from '@/components/flow/ui';
import { useDemo } from '../state/demo';
import { viewOptions } from '../scenarios/visual-options';
import { datasets } from '../scenarios/records';
export function DemoToolbar() {
  const theme = useFlowTheme(), { dataset, choose } = useDemo(), pathname = usePathname();
  const [open, setOpen] = useState<'views' | 'data' | undefined>();
  const selected = viewOptions.find(value => pathname.endsWith(value.path));
  return <View style={{ backgroundColor: theme.background, borderBottomWidth: 1, borderColor: theme.line }}>
    <View style={{ width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 24 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="表示案を切り替える" accessibilityState={{ expanded: open === 'views' }} onPress={() => setOpen(open === 'views' ? undefined : 'views')} style={{ minHeight: 44, paddingTop: 8, justifyContent: 'center' }}><Text style={{ fontSize: 13, lineHeight: 21, color: theme.text }}>{selected?.short ?? '可視化の比較'}　⌄</Text></Pressable>
      {open === 'views' && <View style={{ gap: 6, paddingVertical: 8 }}>{viewOptions.map(value => <Pressable key={value.path} accessibilityRole="button" accessibilityLabel={value.label} aria-pressed={selected?.path === value.path} onPress={() => { router.dismissTo(value.path as Href); setOpen(undefined); }} style={{ minHeight: 44, justifyContent: 'center', padding: 10, borderWidth: 1, borderColor: selected?.path === value.path ? theme.muted : theme.line, borderRadius: 10 }}><Text style={{ color: theme.text, fontSize: 14, lineHeight: 22 }}>{selected?.path === value.path ? '● ' : '○ '}{value.label}</Text></Pressable>)}</View>}
      <Pressable accessibilityRole="button" accessibilityLabel="デモの記録を切り替える" accessibilityState={{ expanded: open === 'data' }} onPress={() => setOpen(open === 'data' ? undefined : 'data')} style={{ minHeight: 64, paddingVertical: 10, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <View style={{ flex: 1, gap: 2 }}><Text style={{ fontSize: 11, lineHeight: 17, color: theme.muted }}>比較デモ · 架空の記録</Text><Text style={{ fontSize: 13, lineHeight: 20, color: theme.text }}>{dataset.label}</Text></View>
        <Text style={{ color: theme.muted, fontSize: 13 }}>{open === 'data' ? '閉じる −' : '記録を切替 ＋'}</Text>
      </Pressable>
      {open === 'data' && <View style={{ gap: 8, paddingBottom: 16 }}>{datasets.map(value => <Pressable key={value.id} accessibilityRole="button" accessibilityLabel={value.label} aria-pressed={value.id === dataset.id} onPress={() => { choose(value.id); setOpen(undefined); }} style={{ minHeight: 44, borderWidth: 1, borderRadius: 10, borderColor: value.id === dataset.id ? theme.muted : theme.line, backgroundColor: theme.surface, padding: 10 }}>
        <Text style={{ fontSize: 14, lineHeight: 22, color: theme.text }}>{value.id === dataset.id ? '● ' : '○ '}{value.label}</Text>
      </Pressable>)}<Text style={{ color: theme.muted, fontSize: 12, lineHeight: 20 }}>11/20までの架空の記録です。一時解除を除いています。実機の記録・保存は使いません。</Text></View>}
    </View>
  </View>;
}
