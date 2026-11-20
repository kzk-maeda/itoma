import { useEffect, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import { GrowthArtwork } from './growth-artwork';
import { circleStyles } from '../scenarios/circle-styles';
import { useGrowth } from '../state/time-growth';
import { useFlowTheme } from '@/components/flow/ui';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { DAY, HOUR, MONTH, YEAR, durationWords, growthReadout } from '../scenarios/time-growth';
export function GrowthCircle({ seconds }: { seconds?: number }) {
  const { look } = useGrowth(), variant = circleStyles.find(value => value.id === look)!;
  const theme = useFlowTheme(), reduced = useReducedMotion(), opacity = useRef(new Animated.Value(1)).current, readout = growthReadout(seconds);
  useEffect(() => {
    opacity.stopAnimation();
    if (reduced) { opacity.setValue(1); return; }
    opacity.setValue(0.5);
    const animation = Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true });
    animation.start(); return () => animation.stop();
  }, [seconds, look, reduced, opacity]);
  const [outside, setOutside] = useState(false);
  const layers = [HOUR, DAY, MONTH, YEAR].filter(value => seconds !== undefined && seconds >= value).length;
  const tail = readout?.remainder ? durationWords(readout.remainder) : undefined;
  const description = seconds === undefined ? 'まだ記録がありません' : seconds === 0 ? '記録した時間は0分です' : `${readout!.approximate ? '約' : ''}${readout!.whole}${readout!.label}${tail ? `と${tail}` : ''}。${look === 'original' ? `円弧は${durationWords(readout!.ringValue)}。1周は${durationWords(readout!.ringSize)}。` : variant.explanation}`;
  return <Animated.View testID="growth-hero" style={{ opacity, gap: 20, alignItems: 'center' }}>
    <View testID="growth-ring" accessible accessibilityRole="image" accessibilityLabel={description} style={{ width: '100%', maxWidth: 278, minHeight: outside ? undefined : 278, justifyContent: 'center', gap: outside ? 16 : 0 }}>
      <View accessible={false} aria-hidden style={outside ? { width: 160, height: 160, alignSelf: 'center' } : { position: 'absolute', inset: 0 }}>
      <GrowthArtwork seconds={seconds} look={look} />
      </View>
    <View testID="growth-readout" onLayout={event => { if (event.nativeEvent.layout.height > 326) setOutside(true); }} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ alignItems: 'center', gap: 4, minHeight: outside ? undefined : 278, width: '100%', justifyContent: 'center', paddingHorizontal: 34, paddingVertical: outside ? 0 : 52, pointerEvents: 'none' }}>
      {readout?.approximate && <Text style={{ fontSize: 13, lineHeight: 20, color: theme.muted }}>約</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'center', columnGap: 7 }}><Text testID="growth-whole" style={{ fontSize: 62, lineHeight: 76, color: theme.text, fontWeight: '400', fontVariant: ['tabular-nums'] }}>{seconds === undefined ? '—' : seconds === 0 ? '0' : readout?.whole.toLocaleString('ja-JP')}</Text><Text testID="growth-unit" style={{ fontSize: 21, lineHeight: 32, color: theme.text }}>{seconds === 0 ? '分' : readout?.label}</Text></View>
      {tail && seconds !== 0 && <Text testID="growth-tail" style={{ fontSize: 17, lineHeight: 28, textAlign: 'center', color: theme.muted }}>＋{tail}</Text>}
    </View></View>
    <Text testID="growth-ring-key" style={{ color: theme.muted, textAlign: 'center', fontSize: 12, lineHeight: 20 }}>{!readout ? 'まだ時間の記録がありません' : seconds === 0 ? '記録した時間は0分です' : look === 'rings' ? `${layers}つの節目を、${layers}本の輪に。` : look === 'ticks' ? '時間の長さは、中央の数字に。' : look === 'disc' ? '自分の時間を、まるい余白に。' : `${readout.kind === 'hours' ? 'ここまで' : '端数'} ${durationWords(readout.ringValue)} · 1周＝${readout.ringSize === 86400 ? '24時間' : durationWords(readout.ringSize)}`}</Text>
  </Animated.View>;
}
