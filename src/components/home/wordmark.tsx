import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import identity from '../../../assets/brand/identity.json';
import type { GraphiteTheme } from '@/constants/theme';
import { OpenCircle } from './open-circle';

const { wordmark } = identity;

export function Wordmark({ theme, label = identity.name, heading = false }: { theme: GraphiteTheme; label?: string; heading?: boolean }) {
  return <View style={styles.row}>
    <OpenCircle color={theme.accent} size={wordmark.markSize} />
    <Text accessibilityRole={heading ? 'header' : undefined} style={[styles.name, { color: theme.text }]}>{label}</Text>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: wordmark.gap },
  name: { fontSize: wordmark.size, fontWeight: wordmark.weight as TextStyle['fontWeight'], letterSpacing: wordmark.tracking, lineHeight: 36 },
});
