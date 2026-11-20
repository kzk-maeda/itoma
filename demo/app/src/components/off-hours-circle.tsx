import { useSyncExternalStore } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useFlowTheme } from '@/components/flow/ui';

const subscribe = () => () => {};
const client = () => true;
const server = () => false;

/** A static outline, never a progress fraction, loading spinner or time until next start. */
export function OffHoursCircle() {
  const theme = useFlowTheme(), { fontScale, width } = useWindowDimensions();
  const hydrated = useSyncExternalStore(subscribe, client, server);
  const expanded = hydrated && fontScale > 1.5;
  const label = <Text accessibilityRole="header" style={[styles.label, { color: theme.text }]}>制限時間外</Text>;
  return <View testID="off-hours-circle" style={styles.group}>
    <View style={[styles.ring, hydrated && width <= 340 && styles.narrowRing]}>
      <View style={StyleSheet.absoluteFill} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Svg width="100%" height="100%" viewBox="0 0 224 224" aria-hidden>
          <Circle cx={112} cy={112} r={104} fill="none" stroke={theme.muted} strokeOpacity={0.55} strokeWidth={1.6} strokeDasharray="1 9" strokeLinecap="round" />
        </Svg>
      </View>
      <View style={styles.center}>
        <View testID="off-hours-motif" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Svg width={72} height={72} viewBox="0 0 72 72" aria-hidden fill="none" stroke={theme.purposeMotif} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M34 42C19 44 16 32 21 22C32 23 39 30 34 42Z" fill={theme.purposeSurface} />
            <Path d="M39 33C35 19 45 12 58 14C58 27 51 35 39 33Z" fill={theme.purposeSurface} />
            <Path d="M26 55C31 43 37 33 49 23M28 32L34 42" />
          </Svg>
        </View>
        {!expanded && label}
      </View>
    </View>
    {expanded && label}
  </View>;
}
const styles = StyleSheet.create({
  group: { alignItems: 'center', paddingVertical: 12, gap: 16 },
  ring: { width: 240, maxWidth: '100%', aspectRatio: 1 }, narrowRing: { width: 224 },
  center: { position: 'absolute', inset: 24, alignItems: 'center', justifyContent: 'center', gap: 14 },
  label: { fontSize: 16, lineHeight: 25, fontWeight: '400', textAlign: 'center', flexShrink: 1 },
});
