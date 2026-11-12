import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { clockMinute } from '@/lib/schedule-time';
import { TimePicker } from './time-picker';
import { Body, Button, Heading, useFlowTheme } from './ui';

export function TimeField({ label, value, disabled = false, onChange }: {
  label: string; value: string; disabled?: boolean; onChange: (value: string) => void;
}) {
  const theme = useFlowTheme(), [pending, setPending] = useState('00:00'), [open, setOpen] = useState(false);
  const selected = clockMinute(value) !== undefined;
  const choose = () => {
    const now = new Date();
    setPending(selected ? value : `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    setOpen(true);
  };
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityValue={{ text: selected ? value : '未選択' }}
      accessibilityState={{ disabled }} disabled={disabled} onPress={choose}
      style={({ pressed }) => [styles.field, { borderColor: theme.muted, backgroundColor: theme.surface, opacity: pressed ? 0.75 : 1 }]}>
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      <View style={styles.value}><Text style={[styles.time, { color: selected ? theme.text : theme.muted }]}>{selected ? value : '未選択'}</Text><Text style={{ color: theme.muted, fontSize: 16 }}>{selected ? '変更' : '選ぶ'}</Text></View>
    </Pressable>
    {open && <Modal presentationStyle="pageSheet" animationType="none" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
        <ScrollView contentContainerStyle={styles.content}>
          <Heading>{label}を選ぶ</Heading>
          <Body>24時間表示で選びます。</Body>
          <TimePicker label={label} value={pending} onChange={setPending} />
          <Button label="この時刻にする" disabled={disabled} onPress={() => { if (!disabled) { onChange(pending); setOpen(false); } }} />
          <Button label="キャンセル" secondary onPress={() => setOpen(false)} />
        </ScrollView>
      </SafeAreaView>
    </Modal>}
  </>;
}
const styles = StyleSheet.create({
  field: { minHeight: 76, borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
  label: { fontSize: 16, lineHeight: 24 }, time: { fontSize: 20, lineHeight: 30 },
  value: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  content: { padding: 24, gap: 24, paddingBottom: 48 },
});
