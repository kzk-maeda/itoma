import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFlowTheme } from '@/components/flow/ui';
import { useDemo } from '../state/demo';
import { datasets } from '../scenarios/records';
export function DemoToolbar() {
  const theme = useFlowTheme(), { dataset, choose } = useDemo(), [open, setOpen] = useState(false);
  return <View style={{ backgroundColor: theme.background, borderBottomWidth: 1, borderColor: theme.line }}>
    <View style={{ width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 24 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="デモの記録を切り替える" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={{ minHeight: 64, paddingVertical: 10, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <View style={{ flex: 1, gap: 2 }}><Text style={{ fontSize: 11, lineHeight: 17, color: theme.muted }}>比較デモ · 架空の記録</Text><Text style={{ fontSize: 13, lineHeight: 20, color: theme.text }}>{dataset.label}</Text></View>
        <Text style={{ color: theme.muted, fontSize: 13 }}>{open ? '閉じる −' : '切替 ＋'}</Text>
      </Pressable>
      {open && <View style={{ gap: 8, paddingBottom: 16 }}>{datasets.map(value => <Pressable key={value.id} accessibilityRole="button" accessibilityLabel={value.label} aria-pressed={value.id === dataset.id} onPress={() => { choose(value.id); setOpen(false); }} style={{ minHeight: 44, borderWidth: 1, borderRadius: 10, borderColor: value.id === dataset.id ? theme.muted : theme.line, backgroundColor: theme.surface, padding: 10 }}>
        <Text style={{ fontSize: 14, lineHeight: 22, color: theme.text }}>{value.id === dataset.id ? '● ' : '○ '}{value.label}</Text>
      </Pressable>)}<Text style={{ color: theme.muted, fontSize: 12, lineHeight: 20 }}>一時解除を除いた架空の集計です。実機の記録・保存は使いません。</Text></View>}
    </View>
  </View>;
}
