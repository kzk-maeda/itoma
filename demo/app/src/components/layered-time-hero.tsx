import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Animated, Text, View } from 'react-native';
import Svg, { Ellipse, G, Path, Text as SvgText } from 'react-native-svg';
import { useFlowTheme } from '@/components/flow/ui';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { durationWords, growthReadout } from '../scenarios/time-growth';
import { foldMessage, timeLayers } from '../scenarios/time-layers';
function LayerStack({ seconds }: { seconds?: number }) {
  const theme = useFlowTheme(), reduced = useReducedMotion(), [drawSeconds, setDrawSeconds] = useState(seconds), previous = useRef(seconds);
  const scale = useRef(new Animated.Value(1)).current, arrival = useRef(new Animated.Value(0)).current;
  const focused = useRef(false), latest = useRef(seconds); latest.current = seconds;
  useFocusEffect(useCallback(() => {
    focused.current = true; setDrawSeconds(latest.current); scale.setValue(1); arrival.setValue(0);
    return () => { focused.current = false; scale.stopAnimation(); arrival.stopAnimation(); };
  }, [scale, arrival]));
  useEffect(() => {
    let active = true;
    scale.stopAnimation(); arrival.stopAnimation();
    const before = previous.current; previous.current = seconds;
    if (reduced || !focused.current || seconds === undefined || before === undefined) { setDrawSeconds(seconds); scale.setValue(1); arrival.setValue(0); return; }
    if (foldMessage(before, seconds)) {
      setDrawSeconds(before); scale.setValue(1);
      Animated.timing(scale, { toValue: 0.35, duration: 150, useNativeDriver: true }).start(({ finished }) => {
        if (!active || !focused.current || !finished) return;
        setDrawSeconds(seconds); scale.setValue(0.85);
        Animated.timing(scale, { toValue: 1, duration: 160, useNativeDriver: true }).start();
      });
    } else {
      setDrawSeconds(seconds); scale.setValue(1); arrival.setValue(-5);
      Animated.timing(arrival, { toValue: 0, duration: 180, useNativeDriver: true }).start();
    }
    return () => { active = false; scale.stopAnimation(); arrival.stopAnimation(); };
  }, [seconds, reduced, scale, arrival]);
  const model = timeLayers(drawSeconds), top = model.items.at(-1);
  const height = Math.max(94, 226 - (top?.top ?? 146));
  return <Animated.View testID="layer-motion" style={{ width: '100%', height, transform: [{ translateY: arrival }, { scaleY: scale }] }}><Svg testID="growth-visual-layers" accessible={false} aria-hidden width="100%" height="100%" viewBox={`0 ${198 - height} 278 ${height}`}>
    {model.items.length ? model.items.map(item => <G key={item.key} testID={`time-layer-${item.unit}`}>
      <Path d={`M26 ${item.top} C26 ${item.top + 12} 76 ${item.top + 22} 139 ${item.top + 22} C202 ${item.top + 22} 252 ${item.top + 12} 252 ${item.top} L252 ${item.bottom} C252 ${item.bottom + 12} 202 ${item.bottom + 22} 139 ${item.bottom + 22} C76 ${item.bottom + 22} 26 ${item.bottom + 12} 26 ${item.bottom} Z`} fill={item.unit === 'hour' || item.unit === 'fraction' ? theme.soft : theme.purposeSurface} stroke={theme.muted} strokeOpacity={0.65} strokeWidth={0.65} />
      <Ellipse cx={139} cy={item.top} rx={113} ry={22} fill={theme.purposeSurface} fillOpacity={item.unit === 'fraction' ? 0.4 + item.fraction * 0.6 : 1} stroke={theme.muted} strokeWidth={0.7} strokeOpacity={0.7} />
    </G>) : <Ellipse cx={139} cy={146} rx={113} ry={22} fill="none" stroke={theme.muted} strokeWidth={1} strokeDasharray={drawSeconds === undefined ? '2 7' : undefined} />}
    {top && <SvgText x={139} y={top.top + 5} textAnchor="middle" fontSize={13} fill={theme.text}>{top.unit === 'fraction' ? `＋${top.label}` : top.label}</SvgText>}
  </Svg></Animated.View>;
}
export function LayeredTimeHero({ seconds }: { seconds?: number }) {
  const theme = useFlowTheme(), readout = growthReadout(seconds), model = timeLayers(seconds), tail = readout?.remainder ? durationWords(readout.remainder) : undefined;
  const description = seconds === undefined ? 'まだ記録がありません' : seconds === 0 ? '記録した時間は0分です' : `${readout!.approximate ? '約' : ''}${readout!.whole}${readout!.label}${tail ? `と${tail}` : ''}。${model.groups.map(group => `${group.label}が${group.count}つ`).join('、')}${model.remainder ? `、端数${durationWords(model.remainder)}` : ''}。`;
  return <View testID="growth-hero" style={{ gap: 12, alignItems: 'center' }}><View testID="growth-ring" accessible accessibilityRole="image" accessibilityLabel={description} style={{ width: '100%', maxWidth: 278, gap: 4 }}>
    <View testID="growth-readout" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ alignItems: 'center', gap: 4 }}>
      {readout?.approximate && <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 21 }}>約</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, justifyContent: 'center', alignItems: 'baseline' }}><Text testID="growth-whole" style={{ color: theme.text, fontSize: 62, lineHeight: 76, fontVariant: ['tabular-nums'] }}>{seconds === undefined ? '—' : seconds === 0 ? '0' : readout?.whole.toLocaleString('ja-JP')}</Text><Text testID="growth-unit" style={{ color: theme.text, fontSize: 21, lineHeight: 32 }}>{seconds === 0 ? '分' : readout?.label}</Text></View>
      {tail && <Text testID="growth-tail" style={{ color: theme.muted, fontSize: 17, lineHeight: 28 }}>＋{tail}</Text>}
    </View><LayerStack seconds={seconds} />
  </View><View testID="time-layer-summary" style={{ gap: 6, width: '100%', padding: 14, borderRadius: 14, backgroundColor: theme.background }}>
    {model.groups.map(group => <View key={group.key} style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}><Text style={{ color: theme.muted, fontSize: 13, lineHeight: 21 }}>{group.label}</Text><Text testID={`layer-count-${group.key}`} style={{ color: theme.text, fontSize: 14, lineHeight: 22 }}>× {group.count}</Text></View>)}
    {!!model.remainder && <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 21 }}>端数の層：{durationWords(model.remainder)}</Text>}
    {!model.items.length && <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 21 }}>{seconds === undefined ? 'まだ時間の記録がありません。' : '記録した時間は0分です。'}</Text>}
  </View></View>;
}
