import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useFlowTheme } from '@/components/flow/ui';

const subscribe = () => () => {};
const client = () => true;
const server = () => false;

/** A static outline, never a progress fraction, loading spinner or time until next start. */
export function OffHoursCircle() {
  const theme = useFlowTheme(), { fontScale, width } = useWindowDimensions();
  const hydrated = useSyncExternalStore(subscribe, client, server);
  const expanded = hydrated && (fontScale > 1.2 || width <= 340);
  const copy = <View style={[styles.copy, expanded && styles.expandedCopy]}>
    <Text style={[styles.eyebrow, { color: theme.muted }]}>いまは</Text>
    <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>制限時間外</Text>
    <Text style={[styles.detail, { color: theme.muted }]}>アプリの制限はありません</Text>
  </View>;
  return <View testID="off-hours-circle" style={[styles.group, expanded && styles.expandedGroup]}>
    <View style={[styles.ring, expanded && styles.smallRing]}>
      <View style={StyleSheet.absoluteFill} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Svg width="100%" height="100%" viewBox="0 0 224 224" aria-hidden>
          <Circle cx={112} cy={112} r={104} fill="none" stroke={theme.muted} strokeOpacity={0.55} strokeWidth={1.6} strokeDasharray="1 9" strokeLinecap="round" />
        </Svg>
      </View>
      {!expanded && copy}
    </View>
    {expanded && copy}
  </View>;
}
const styles = StyleSheet.create({
  group: { alignItems: 'center', paddingVertical: 12, gap: 16 }, ring: { width: 240, maxWidth: '100%', aspectRatio: 1 },
  copy: { position: 'absolute', inset: 24, alignItems: 'center', justifyContent: 'center', gap: 8 },
  eyebrow: { fontSize: 14, lineHeight: 22 }, title: { fontSize: 26, lineHeight: 38, fontWeight: '500' }, detail: { fontSize: 13, lineHeight: 21, textAlign: 'center' },
  expandedGroup: { alignItems: 'flex-start' }, smallRing: { width: 72 },
  expandedCopy: { position: 'relative', inset: undefined, alignItems: 'flex-start', gap: 6 },
});
import { useSyncExternalStore } from 'react';
