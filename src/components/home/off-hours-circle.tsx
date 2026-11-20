import { useSyncExternalStore } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useFlowTheme } from '../flow/ui';
import type { NextStart } from './off-hours-presentation';

const subscribe = () => () => {};
const client = () => true, server = () => false;
/** A static outline for the next native start; never a progress indicator or countdown. */
export function OffHoursCircle({ next }: { next?: NextStart }) {
  const theme = useFlowTheme(), { fontScale, width } = useWindowDimensions();
  const hydrated = useSyncExternalStore(subscribe, client, server), expanded = hydrated && fontScale > 1.5;
  const copy = <View style={styles.copy}>
    {next && <Text style={[styles.caption, { color: theme.muted }]}>次は</Text>}
    <Text testID="next-start" accessibilityRole="header" style={[styles.time, next && next.date.length > 3 && styles.longDate, !next && styles.empty, { color: theme.text }]}>
      {next ? `${next.date} ${next.time}` : '次の予定なし'}
    </Text>
  </View>;
  return <View testID="off-hours-circle" style={styles.group}>
    <View testID="off-hours-ring" style={[styles.ring, hydrated && width <= 340 && styles.narrowRing]}>
      <View style={StyleSheet.absoluteFill} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Svg width="100%" height="100%" viewBox="0 0 224 224" aria-hidden>
          <Circle cx={112} cy={112} r={104} fill="none" stroke={theme.muted} strokeOpacity={0.55} strokeWidth={1.6} strokeDasharray="1 9" strokeLinecap="round" />
        </Svg>
      </View>
      {!expanded && <View style={styles.center}>{copy}</View>}
    </View>
    {expanded && copy}
    <Text style={[styles.caption, { color: theme.muted }]}>制限時間外</Text>
  </View>;
}
const styles = StyleSheet.create({
  group: { alignItems: 'center', paddingVertical: 12, gap: 8 }, ring: { width: 240, maxWidth: '100%', aspectRatio: 1 }, narrowRing: { width: 224 },
  center: { position: 'absolute', inset: 24, alignItems: 'center', justifyContent: 'center' }, copy: { alignItems: 'center', gap: 8, maxWidth: '100%' },
  caption: { fontSize: 13, lineHeight: 21 }, time: { fontSize: 26, lineHeight: 36, fontWeight: '400', textAlign: 'center', fontVariant: ['tabular-nums'] },
  longDate: { fontSize: 18, lineHeight: 28 }, empty: { fontSize: 20, lineHeight: 30 },
});
