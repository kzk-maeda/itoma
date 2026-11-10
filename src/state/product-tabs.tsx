import { createContext, type ReactNode, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing } from 'react-native';
import { FlowMotion } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { nextTabFrame, productTabIndex, settledTabFrame, type ProductTab, type TabFrame } from '@/components/flow/product-tab-model';

type TabMotion = { current: ProductTab; frame: TabFrame; clock: Animated.Value; width: number;
  active: boolean; setWidth: (value: number) => void; select: (tab: ProductTab) => void };
const Context = createContext<TabMotion | undefined>(undefined);
export function useProductTabs() { return useContext(Context); }

/** A single active clock drives both scenes and the persistent tab indicator. */
export function ProductTabsProvider({ current, onSelect, focused, children }: {
  current: ProductTab; onSelect: (tab: ProductTab) => void; focused: boolean; children: ReactNode;
}) {
  const index = productTabIndex(current), reduced = useReducedMotion();
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const [width, setWidth] = useState(0);
  const [clocks] = useState(() => [new Animated.Value(1), new Animated.Value(1)] as const);
  const [frame, setFrame] = useState(() => settledTabFrame(index));
  const painted = useRef(frame);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => listener.remove();
  }, []);
  useLayoutEffect(() => {
    let active = true;
    const previous = painted.current;
    clocks[previous.bank].stopAnimation(progress => {
      if (!active) return;
      const next = nextTabFrame(previous, progress, index, focused && foreground && !reduced);
      clocks[next.bank].stopAnimation();
      clocks[next.bank].setValue(next.animate ? 0 : 1);
      painted.current = next; setFrame(next);
    });
    return () => { active = false; };
  }, [index, focused, foreground, reduced, clocks]);
  useLayoutEffect(() => {
    if (!frame.animate) return;
    let active = true;
    const animation = Animated.timing(clocks[frame.bank], { toValue: 1, duration: FlowMotion.tabDuration,
      easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start(result => {
      if (!active || !result.finished || painted.current !== frame) return;
      const settled = settledTabFrame(frame.target, frame.bank);
      painted.current = settled; setFrame(settled);
    });
    return () => { active = false; animation.stop(); };
  }, [clocks, frame]);
  useEffect(() => () => { clocks.forEach(clock => clock.stopAnimation()); }, [clocks]);
  return <Context.Provider value={{ current, frame, clock: clocks[frame.bank], width, setWidth,
    active: focused && foreground,
    select: tab => { if (tab !== current) onSelect(tab); } }}>{children}</Context.Provider>;
}
