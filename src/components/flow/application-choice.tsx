import { useContext } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApplicationLabels } from '@/runtime/application-labels';
import { Applications } from './applications';
import { useFlowTheme } from './ui';

/** Selection belongs to the shared row; Apple/native or preview only supplies its identity. */
export function ApplicationChoice({ selectionRef, targetRef, refreshKey, selected, disabled, detail, onSelect }: {
  selectionRef: string; targetRef: string; refreshKey: number; selected: boolean;
  disabled: boolean; detail: string; onSelect: () => void;
}) {
  const theme = useFlowTheme(), labels = useContext(ApplicationLabels);
  return <Pressable accessibilityRole="radio" accessibilityLabel={labels?.(selectionRef, targetRef)}
    accessibilityHint={detail} accessibilityState={{ checked: selected, disabled }} aria-checked={selected} aria-disabled={disabled} disabled={disabled} onPress={onSelect}
    testID={`application-choice-${targetRef}`} style={({ pressed }) => [styles.row, {
      borderColor: selected ? theme.accent : theme.line,
      backgroundColor: selected ? theme.soft : theme.surface,
      opacity: pressed && !disabled ? 0.75 : 1,
    }]}>
    <View pointerEvents="none" style={styles.identity}>
      <Applications selectionRef={selectionRef} targetRef={targetRef} refreshKey={refreshKey} />
      <Text accessible={false} style={[styles.detail, { color: theme.muted }]}>{detail}</Text>
    </View>
    <View accessible={false} accessibilityElementsHidden aria-hidden importantForAccessibility="no-hide-descendants" pointerEvents="none"
      testID={`application-choice-indicator-${targetRef}`} style={[styles.radio, { borderColor: disabled ? theme.muted : theme.accent }]}>
      {selected && <View style={[styles.dot, { backgroundColor: disabled ? theme.muted : theme.accent }]} />}
    </View>
  </Pressable>;
}
const styles = StyleSheet.create({
  row: { minHeight: 88, width: '100%', borderWidth: 2, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 16 },
  identity: { flex: 1, minWidth: 0, gap: 6 }, detail: { fontSize: 14, lineHeight: 22 },
  radio: { width: 24, height: 24, flexShrink: 0, borderWidth: 2, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
