import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFlowTheme } from '@/components/flow/ui';
import { useDemo } from '../state/demo';
import { scenarios } from '../scenarios/home';

export function DemoToolbar() {
  const theme = useFlowTheme(), { scenario, choose } = useDemo();
  const [expanded, setExpanded] = useState(false);
  return <View style={{ backgroundColor: theme.background, borderBottomColor: theme.line, borderBottomWidth: 1 }}>
    <View style={styles.frame}>
      <Pressable accessibilityRole="button" accessibilityLabel="デモの表示条件を切り替える" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}
        style={styles.toggle}>
        <View style={{ flex: 1, gap: 3 }}><Text style={[styles.eyebrow, { color: theme.muted }]}>画面デモ · 架空の設定</Text>
          <Text style={[styles.label, { color: theme.text }]}>{scenario.clock} · {scenario.id === 'active' ? '制限中' : '時間外'}</Text></View>
        <Text style={{ color: theme.muted, fontSize: 14 }}>{expanded ? '閉じる −' : '切替 ＋'}</Text>
      </Pressable>
      {expanded && <View style={styles.options}>
        {scenarios.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.label} aria-pressed={scenario.id === item.id}
          onPress={() => { choose(item.id); setExpanded(false); }} style={[styles.option, { borderColor: scenario.id === item.id ? theme.muted : theme.line, backgroundColor: theme.surface }]}>
          <Text style={{ color: theme.text, fontSize: 14, lineHeight: 22 }}>{scenario.id === item.id ? '● ' : '○ '}{item.label}</Text>
        </Pressable>)}
        <Text style={[styles.eyebrow, { color: theme.muted }]}>2026年11月20日を基準にした固定データです。OSの制限・保存は行いません。</Text>
      </View>}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  frame: { maxWidth: 480, width: '100%', alignSelf: 'center', paddingHorizontal: 24 },
  toggle: { minHeight: 64, paddingVertical: 10, flexDirection: 'row', gap: 12, alignItems: 'center' },
  eyebrow: { fontSize: 11, lineHeight: 17 }, label: { fontSize: 13, lineHeight: 20 },
  options: { paddingBottom: 16, gap: 8 }, option: { minHeight: 44, padding: 10, borderWidth: 1, borderRadius: 10, justifyContent: 'center' },
});
