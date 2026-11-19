import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useScreenTime } from '@/state/screen-time';
import { useFlowTheme } from '@/components/flow/ui';
import { useMultiRuleDemo } from './context';
import { scenarios } from './fixture';

export function MultiRuleDemoToolbar() {
  const demo = useMultiRuleDemo(), state = useScreenTime(), theme = useFlowTheme();
  const [open, setOpen] = useState(false);
  if (!demo) return null;
  return <View style={{ backgroundColor: theme.soft, borderBottomWidth: 1, borderColor: theme.line }}>
    <Pressable accessibilityRole="button" accessibilityLabel="デモの状態を切り替える" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.toggle}>
      <Text style={[styles.label, { color: theme.text }]}>画面デモ · {scenarios.find(s => s.id === demo.scenario)?.label}</Text>
      <Text style={[styles.label, { color: theme.muted }]}>{open ? '閉じる ∧' : '状態を変更 ∨'}</Text>
    </Pressable>
    {open && <ScrollView style={{ maxHeight: 270 }} contentContainerStyle={styles.controls}>
      <Text style={[styles.note, { color: theme.muted }]}>架空のアプリ・設定です。OS制限や保存は行いません。時刻はデモ用です。再読込でリセットします。</Text>
      <View style={styles.options}>{scenarios.map(scenario => <Pressable key={scenario.id} accessibilityRole="button" accessibilityState={{ selected: demo.scenario === scenario.id, disabled: !!state.busy }} disabled={!!state.busy}
        onPress={() => { demo.choose(scenario.id); void state.refresh(); setOpen(false); }}
        style={[styles.option, { backgroundColor: demo.scenario === scenario.id ? theme.accent : theme.surface, borderColor: theme.line }]}>
        <Text style={[styles.label, { color: demo.scenario === scenario.id ? theme.onAccent : theme.text }]}>{scenario.label}</Text>
      </Pressable>)}</View>
      <Text style={[styles.note, { color: theme.muted }]}>Xが重複します。21時は「読書に集中」、22時は「おやすみ前」を適用する例です。設定の編集や振り返りは今回のデモ対象外です。</Text>
    </ScrollView>}
  </View>;
}
const styles = StyleSheet.create({
  toggle: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 12, lineHeight: 20 }, note: { fontSize: 13, lineHeight: 21 }, controls: { padding: 16, gap: 12 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, option: { minHeight: 44, justifyContent: 'center', padding: 10, borderRadius: 10, borderWidth: 1 },
});
