import { useEffect, useSyncExternalStore } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, type AlertButton, type AlertOptions } from 'react-native';
import { GraphiteColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
type Message = { title: string; message?: string; buttons: AlertButton[]; options?: AlertOptions };
let current: Message | undefined;
const listeners = new Set<() => void>();
const publish = () => listeners.forEach(listener => listener());
const close = () => { current = undefined; publish(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const Alert = { alert(title: string, message?: string, buttons: AlertButton[] = [{ text: '閉じる' }], options?: AlertOptions) {
  if (current) return; // One decision at a time; never stack destructive confirmations.
  current = { title, message, buttons, options }; publish();
} };
/** RN Web's Alert is a no-op; a platform host preserves the same product confirmation callbacks. */
export function ProductAlertHost() {
  const value = useSyncExternalStore(subscribe, () => current, () => undefined);
  const theme = GraphiteColors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  useEffect(() => close, []);
  const choose = (button?: AlertButton) => { close(); button?.onPress?.(); };
  const cancel = () => { const button = value?.buttons.find(item => item.style === 'cancel'); if (button) choose(button); else if (value?.options?.cancelable !== false) { choose(); value?.options?.onDismiss?.(); } };
  return <Modal visible={!!value} transparent animationType="none" onRequestClose={cancel}>
    <View style={styles.backdrop}><ScrollView contentContainerStyle={styles.container}>
      <View role="alertdialog" aria-modal accessibilityLabel={value?.title} style={[styles.dialog, { backgroundColor: theme.surface }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{value?.title}</Text>
        {!!value?.message && <Text style={[styles.message, { color: theme.text }]}>{value.message}</Text>}
        {value?.buttons.map((button, index) => <Pressable key={index} accessibilityRole="button" onPress={() => choose(button)}
          style={[styles.button, { backgroundColor: theme.accent }]}><Text style={[styles.label, { color: theme.onAccent }]}>{button.text ?? '閉じる'}</Text></Pressable>)}
      </View>
    </ScrollView></View>
  </Modal>;
}
const styles = StyleSheet.create({ backdrop: { flex: 1, backgroundColor: '#0006' }, container: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 440, padding: 24, borderRadius: 20, gap: 16 }, title: { fontSize: 20, lineHeight: 30, fontWeight: '600' },
  message: { fontSize: 16, lineHeight: 26 }, button: { minHeight: 48, padding: 14, borderRadius: 12, justifyContent: 'center' }, label: { fontSize: 16, lineHeight: 26, textAlign: 'center' } });
