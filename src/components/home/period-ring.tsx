import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { type GraphiteTheme, HomeLayout } from '@/constants/theme';

import type { PeriodPresentation } from './period-presentation';

export function PeriodRing({ period, theme }: {
  period: Extract<PeriodPresentation, { state: 'current' }>; theme: GraphiteTheme;
}) {
  const { fontScale } = useWindowDimensions();
  const expandedText = fontScale > 1.2;
  const radius = 94, circumference = 2 * Math.PI * radius;
  const angle = -Math.PI / 2 + 2 * Math.PI * period.fraction;
  const text = <View style={expandedText ? styles.expandedText : styles.centerText}>
    <Text style={[styles.label, { color: theme.muted }]}>この時間帯の終了まで</Text>
    <Text style={[styles.time, { color: theme.text }]}>{period.remaining}</Text>
    <Text style={[styles.label, { color: theme.muted }]}>{period.endLabel}</Text>
  </View>;
  return <View style={styles.group}>
    <View testID="period-ring" style={styles.ring}>
      <View style={styles.svg} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" viewBox="0 0 224 224" aria-hidden>
        <Circle cx={112} cy={112} r={radius} fill="none" stroke={theme.line} strokeWidth={5} />
        <Circle cx={112} cy={112} r={radius} fill="none" stroke={theme.accent} strokeWidth={5}
          strokeDasharray={`${circumference * period.fraction} ${circumference}`} strokeLinecap="round"
          transform="rotate(-90 112 112)" />
        <Circle cx={112 + radius * Math.cos(angle)} cy={112 + radius * Math.sin(angle)} r={5} fill={theme.accent} />
      </Svg>
      </View>
      {!expandedText && text}
    </View>
    {expandedText && text}
  </View>;
}

const styles = StyleSheet.create({
  group: { alignItems: 'center', gap: HomeLayout.sectionGap },
  ring: { width: 224, maxWidth: '100%', aspectRatio: 1 },
  svg: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  centerText: { position: 'absolute', inset: 22, alignItems: 'center', justifyContent: 'center', gap: 8 },
  expandedText: { alignItems: 'center', gap: 8 },
  label: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
  time: { fontSize: 32, lineHeight: 44, fontWeight: '400', fontVariant: ['tabular-nums'], textAlign: 'center' },
});
