import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Heading, useFlowTheme } from './ui';

/** Secondary actions retain a 44pt target while leaving confirmation visually primary. */
export function ReviewAction({ label, accessibilityLabel = label, disabled = false, onPress }: {
  label: string; accessibilityLabel?: string; disabled?: boolean; onPress: () => void;
}) {
  const theme = useFlowTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.action, { opacity: pressed ? 0.75 : 1 }]}>
    <Text style={[styles.actionText, { color: disabled ? theme.muted : theme.accent }]}>{label}</Text>
  </Pressable>;
}

/** The edit affordance belongs to the summary it changes, rather than a second navigation list. */
export function ReviewSection({ title, onChange, changeLabel, disabled, divider = false, children }: {
  title: string; onChange?: () => void; changeLabel: string; disabled: boolean; divider?: boolean; children: ReactNode;
}) {
  const theme = useFlowTheme();
  return <View style={[styles.section, divider && { borderTopWidth: 1, borderColor: theme.line, paddingTop: 16 }]}>
    <View style={styles.heading}>
      <View style={styles.title}><Heading>{title}</Heading></View>
      {onChange && <ReviewAction label="変更" accessibilityLabel={changeLabel} disabled={disabled} onPress={onChange} />}
    </View>
    {children}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 8 }, heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flexShrink: 1 }, action: { minHeight: 44, minWidth: 64, paddingHorizontal: 12, paddingVertical: 9, alignSelf: 'flex-start', justifyContent: 'center' },
  actionText: { fontSize: 16, lineHeight: 26, textDecorationLine: 'underline' },
});
