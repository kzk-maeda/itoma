import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useScreenTime } from '@/state/screen-time';
import { useMultiRuleDemo } from '@/demo/multi-rule/context';

/** Display-only clock; it never grants, extends or applies restrictions. One per focused screen. */
export function useVisibleClock() {
  const demo = useMultiRuleDemo();
  const clock = useCallback(() => demo ? demo.now() : Date.now(), [demo]);
  const [now, setNow] = useState(clock), { refresh } = useScreenTime();
  useFocusEffect(useCallback(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let lastRefresh = clock();
    const start = () => {
      if (timer) clearInterval(timer);
      setNow(clock());
      timer = setInterval(() => {
        const at = clock(); setNow(at);
        if (at - lastRefresh >= 15_000) { lastRefresh = at; void refresh(); }
      }, 1000);
    };
    if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') start();
    void refresh();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') start(); else { if (timer) clearInterval(timer); timer = undefined; }
    });
    return () => { if (timer) clearInterval(timer); listener.remove(); };
  }, [refresh, clock]));
  return now;
}
