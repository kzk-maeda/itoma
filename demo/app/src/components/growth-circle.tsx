import { useEffect, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useFlowTheme } from '@/components/flow/ui';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { durationWords, growthReadout } from '../scenarios/time-growth';
export function GrowthCircle({ seconds }: { seconds?: number }) {
  const theme = useFlowTheme(), reduced = useReducedMotion(), opacity = useRef(new Animated.Value(1)).current, readout = growthReadout(seconds);
  useEffect(() => {
    opacity.stopAnimation();
    if (reduced) { opacity.setValue(1); return; }
    opacity.setValue(0.5);
    const animation = Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true });
    animation.start(); return () => animation.stop();
  }, [seconds, reduced, opacity]);
  const [outside, setOutside] = useState(false);
  const radius = 113, length = 2 * Math.PI * radius, ratio = readout ? readout.ringValue / readout.ringSize : 0;
  const tail = readout?.remainder ? durationWords(readout.remainder) : undefined;
  const description = seconds === undefined ? 'まだ記録がありません' : seconds === 0 ? '記録した時間は0分です' : `${readout!.approximate ? '約' : ''}${readout!.whole}${readout!.label}${tail ? `と${tail}` : ''}。円弧は${durationWords(readout!.ringValue)}。1周は${durationWords(readout!.ringSize)}。`;
  return <Animated.View testID="growth-hero" style={{ opacity, gap: 20, alignItems: 'center' }}>
    <View testID="growth-ring" accessible accessibilityRole="image" accessibilityLabel={description} style={{ width: '100%', maxWidth: 278, minHeight: outside ? undefined : 278, justifyContent: 'center', gap: outside ? 16 : 0 }}>
      <View accessible={false} aria-hidden style={outside ? { width: 160, height: 160, alignSelf: 'center' } : { position: 'absolute', inset: 0 }}>
      <Svg accessible={false} aria-hidden width="100%" height="100%" viewBox="0 0 278 278">
        <Circle cx={139} cy={139} r={radius} fill="none" stroke={theme.soft} strokeWidth={11} strokeDasharray={seconds === undefined ? '2 9' : undefined} />
        {readout && readout.kind !== 'hours' && <Circle cx={139} cy={139} r={97} fill="none" stroke={theme.accent} strokeOpacity={0.2} strokeWidth={1} />}
        {ratio > 0 && <Circle testID="growth-arc" cx={139} cy={139} r={radius} fill="none" stroke={theme.accent} strokeWidth={11} strokeLinecap="round" strokeDasharray={`${length * ratio} ${length}`} rotation={-90} origin="139, 139" />}
        {[0, 1, 2, 3].map(n => <Circle key={n} cx={139 + 132 * Math.sin(n * Math.PI / 2)} cy={139 - 132 * Math.cos(n * Math.PI / 2)} r={1.8} fill={theme.muted} />)}
      </Svg>
      </View>
    <View testID="growth-readout" onLayout={event => { if (event.nativeEvent.layout.height > 326) setOutside(true); }} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ alignItems: 'center', gap: 4, minHeight: outside ? undefined : 278, width: '100%', justifyContent: 'center', paddingHorizontal: 34, paddingVertical: outside ? 0 : 52, pointerEvents: 'none' }}>
      {readout?.approximate && <Text style={{ fontSize: 13, lineHeight: 20, color: theme.muted }}>約</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'center', columnGap: 7 }}><Text testID="growth-whole" style={{ fontSize: 62, lineHeight: 76, color: theme.text, fontWeight: '400', fontVariant: ['tabular-nums'] }}>{seconds === undefined ? '—' : seconds === 0 ? '0' : readout?.whole.toLocaleString('ja-JP')}</Text><Text testID="growth-unit" style={{ fontSize: 21, lineHeight: 32, color: theme.text }}>{seconds === 0 ? '分' : readout?.label}</Text></View>
      {tail && seconds !== 0 && <Text testID="growth-tail" style={{ fontSize: 17, lineHeight: 28, textAlign: 'center', color: theme.muted }}>＋{tail}</Text>}
    </View></View>
    <Text testID="growth-ring-key" style={{ color: theme.muted, textAlign: 'center', fontSize: 12, lineHeight: 20 }}>{readout ? `${readout.kind === 'hours' ? 'ここまで' : '端数'} ${durationWords(readout.ringValue)} · 1周＝${readout.ringSize === 86400 ? '24時間' : durationWords(readout.ringSize)}` : 'まだ時間の記録がありません'}</Text>
  </Animated.View>;
}
