import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { FlowMotion, type GraphiteTheme } from '@/constants/theme';
import type { ReflectionPeriod } from '../../../modules/itoma-native/src/reflection-model';

export function PeriodSelector({ selected, onSelect, disabled, reduced, theme }: {
  selected: ReflectionPeriod; onSelect: (period: ReflectionPeriod) => void;
  disabled: boolean; reduced: boolean; theme: GraphiteTheme;
}) {
  const [width, setWidth] = useState(0);
  const [position] = useState(() => new Animated.Value(selected === 'month' ? 1 : 0));
  useLayoutEffect(() => {
    position.stopAnimation();
    const toValue = selected === 'month' ? 1 : 0;
    if (reduced) { position.setValue(toValue); return; }
    const animation = Animated.timing(position, { toValue, duration: FlowMotion.periodDuration, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [selected, reduced, position]);
  const segmentWidth = Math.max(0, (width - 12) / 2);
  return <View testID="reflection-period-selector" style={[styles.segments, { backgroundColor: theme.background }]} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    {width > 0 && <Animated.View testID="reflection-period-indicator" pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.indicator, { width: segmentWidth, backgroundColor: theme.surface, borderColor: theme.accent,
        transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, segmentWidth + 4] }) }] }]} />}
    {(['week', 'month'] as const).map(period => <Pressable key={period} testID={`reflection-period-${period}`} accessibilityRole="button"
      accessibilityState={{ selected: selected === period, disabled }} aria-selected={selected === period} disabled={disabled}
      onPress={() => { if (selected !== period) onSelect(period); }} style={({ pressed }) => [styles.segment, { opacity: pressed ? 0.75 : 1 }]}>
      <Text style={[styles.segmentText, { color: theme.text, fontWeight: selected === period ? '600' : '400' }]}>{period === 'week' ? '週次' : '月次'}</Text>
    </Pressable>)}
  </View>;
}

/** One content tree: a short incoming slide after the matching data is ready, no animation queue. */
export function PeriodTransition({ children, transitionKey, direction, reduced, busy }: {
  children: ReactNode; transitionKey: string; direction: -1 | 1; reduced: boolean; busy: boolean;
}) {
  const [offset] = useState(() => new Animated.Value(0)), [opacity] = useState(() => new Animated.Value(1));
  const previous = useRef(transitionKey);
  useLayoutEffect(() => {
    offset.stopAnimation(); opacity.stopAnimation();
    const animate = !!previous.current && !!transitionKey && previous.current !== transitionKey && !reduced;
    previous.current = transitionKey;
    if (!animate) { offset.setValue(0); opacity.setValue(1); return; }
    offset.setValue(direction * FlowMotion.periodOffset); opacity.setValue(0.7);
    const animation = Animated.parallel([
      Animated.timing(offset, { toValue: 0, duration: FlowMotion.periodDuration, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: FlowMotion.periodDuration, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [transitionKey, direction, reduced, offset, opacity]);
  return <Animated.View testID="reflection-period-panel" accessibilityState={{ busy }} aria-busy={busy} style={[styles.content, { opacity, transform: [{ translateX: offset }] }]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  segments: { flexDirection: 'row', padding: 4, borderRadius: 13, gap: 4, overflow: 'hidden' },
  indicator: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: 10, borderBottomWidth: 2 },
  segment: { flex: 1, minHeight: 46, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10, borderBottomWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: 14, lineHeight: 22 }, content: { gap: 20 },
});
