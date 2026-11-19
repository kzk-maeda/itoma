import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { RuleDeckMotion as motion } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useFlowTheme } from '../flow/ui';

type Card = { id: string; title: string; content: ReactNode };
/** Browsing only: a swipe never mutates a rule, grants access or dismisses a restriction. */
export function RuleDeck({ items, selectedID, onSelect }: { items: Card[]; selectedID?: string; onSelect: (id: string) => void }) {
  const theme = useFlowTheme(), reduced = useReducedMotion();
  const [moving, setMoving] = useState(false), [width, setWidth] = useState(320);
  const [drag] = useState(() => new Animated.Value(0));
  const index = Math.max(0, items.findIndex(item => item.id === selectedID));
  const latest = useRef({ items, index, reduced, width, onSelect });
  const gestureOrigin = useRef<string | undefined>(undefined);
  const mounted = useRef(true), locked = useRef(false);
  useLayoutEffect(() => {
    const previous = latest.current, currentID = items[index]?.id;
    latest.current = { items, index, reduced, width, onSelect };
    if (currentID && selectedID !== currentID) onSelect(currentID);
    if (previous.items[previous.index]?.id !== currentID || (reduced && !previous.reduced)) {
      drag.stopAnimation(); drag.setValue(0); locked.current = false;
      queueMicrotask(() => { if (mounted.current) setMoving(false); });
    }
  });
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; drag.stopAnimation(); };
  }, [drag]);
  const restore = useCallback(() => {
    if (latest.current.reduced) { drag.setValue(0); return; }
    Animated.spring(drag, { toValue: 0, damping: 24, stiffness: 240, mass: 0.8, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [drag]);
  const choose = useCallback((direction: -1 | 1) => {
    if (locked.current) return;
    const current = latest.current, next = current.items[current.index + direction];
    if (!next) { restore(); return; }
    const from = current.items[current.index]?.id;
    const finish = (finished = true) => {
      if (!mounted.current) return;
      if (finished && latest.current.items[latest.current.index]?.id === from && latest.current.items.some(item => item.id === next.id)) latest.current.onSelect(next.id);
      drag.setValue(0); locked.current = false; setMoving(false);
    };
    if (current.reduced) { current.onSelect(next.id); drag.setValue(0); return; }
    locked.current = true; setMoving(true);
    Animated.timing(drag, { toValue: -direction * current.width * 1.1, duration: motion.exitDuration,
      easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start(({ finished }) => finish(finished));
  }, [drag, restore]);
  const shouldMove = useCallback((_event: unknown, gesture: { dx: number; dy: number }) => !locked.current && latest.current.items.length > 1
    && Math.abs(gesture.dx) > motion.captureDistance && Math.abs(gesture.dx) > Math.abs(gesture.dy) * motion.horizontalRatio, []);
  const startDrag = useCallback(() => { gestureOrigin.current = latest.current.items[latest.current.index]?.id; drag.stopAnimation(); }, [drag]);
  const moveDrag = useCallback((_event: unknown, gesture: { dx: number }) => {
    if (latest.current.reduced) return;
    const noCard = gesture.dx < 0 ? latest.current.index === latest.current.items.length - 1 : latest.current.index === 0;
    drag.setValue(gesture.dx * (noCard ? 0.18 : 1));
  }, [drag]);
  const releaseDrag = useCallback((_event: unknown, gesture: { dx: number; vx: number }) => {
    if (gestureOrigin.current !== latest.current.items[latest.current.index]?.id) { restore(); return; }
    if (Math.abs(gesture.dx) > latest.current.width * motion.commitFraction || (Math.abs(gesture.dx) > motion.flickDistance && Math.abs(gesture.vx) > motion.flickVelocity)) choose(gesture.dx < 0 ? 1 : -1);
    else restore();
  }, [choose, restore]);
  const [pan, setPan] = useState<ReturnType<typeof PanResponder.create>>();
  useEffect(() => {
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => false, onMoveShouldSetPanResponder: shouldMove,
      onPanResponderGrant: startDrag, onPanResponderMove: moveDrag, onPanResponderRelease: releaseDrag,
      onPanResponderTerminate: restore, onPanResponderTerminationRequest: () => true,
    });
    let active = true;
    queueMicrotask(() => { if (active) setPan(responder); });
    return () => { active = false; };
  }, [shouldMove, startDrag, moveDrag, releaseDrag, restore]);
  if (!items[index]) return null;
  const behind = items[index + 1] ?? items[index - 1];
  return <View style={styles.group}>
    {items.length > 1 && <View style={styles.controls}>
      <Pressable accessibilityRole="button" accessibilityLabel="前のルール" disabled={index === 0 || moving} accessibilityState={{ disabled: index === 0 || moving }} onPress={() => choose(-1)} style={styles.arrow}>
        <Text accessible={false} style={[styles.chevron, { color: index === 0 ? theme.muted : theme.text }]}>‹</Text>
      </Pressable>
      <View style={styles.position}>
        <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: theme.text }]}>{index + 1} / {items.length} · {items[index].title}</Text>
        <View accessible={false} style={styles.dots}>{items.map((item, at) => <View key={item.id} style={[styles.dot, { width: at === index ? 18 : 5, backgroundColor: at === index ? theme.text : theme.line }]} />)}</View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="次のルール" disabled={index === items.length - 1 || moving} accessibilityState={{ disabled: index === items.length - 1 || moving }} onPress={() => choose(1)} style={styles.arrow}>
        <Text accessible={false} style={[styles.chevron, { color: index === items.length - 1 ? theme.muted : theme.text }]}>›</Text>
      </Pressable>
    </View>}
    <View testID="rule-deck" style={styles.deck} onLayout={event => { if (event.nativeEvent.layout.width > 0) setWidth(event.nativeEvent.layout.width); }}>
      {behind && <View pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.behind, { backgroundColor: theme.soft, borderColor: theme.line }]} />}
      <Animated.View testID="active-rule-card" {...pan?.panHandlers} style={{ transform: reduced ? [] : [
        { translateX: drag }, { rotate: drag.interpolate({ inputRange: [-width, 0, width], outputRange: [`-${motion.maxRotation}deg`, '0deg', `${motion.maxRotation}deg`], extrapolate: 'clamp' }) },
      ] }}>
        {items[index].content}
      </Animated.View>
    </View>
    {items.length > 1 && <Text style={[styles.caption, styles.hint, { color: theme.muted }]}>左右にスワイプしてルールを確認</Text>}
  </View>;
}
const styles = StyleSheet.create({
  group: { gap: 10 }, controls: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  arrow: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  chevron: { fontSize: 28, lineHeight: 36 }, position: { flex: 1, alignItems: 'center', gap: 7 },
  caption: { fontSize: 13, lineHeight: 21 }, dots: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { height: 5, borderRadius: 3 }, deck: { overflow: 'hidden', paddingHorizontal: 6, paddingTop: 4, paddingBottom: 14 },
  behind: { position: 'absolute', top: 17, bottom: 3, left: 15, right: 15, borderRadius: 20, borderWidth: 1, transform: [{ rotate: '2deg' }] },
  hint: { textAlign: 'center' },
});
