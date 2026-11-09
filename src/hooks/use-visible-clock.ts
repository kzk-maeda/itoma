import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useScreenTime } from '@/state/screen-time';

/** Display-only clock; it never grants, extends or applies restrictions. One per focused screen. */
export function useVisibleClock() {
  const [now, setNow] = useState(Date.now), { refresh } = useScreenTime();
  useFocusEffect(useCallback(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let lastRefresh = Date.now();
    const start = () => {
      if (timer) clearInterval(timer);
      setNow(Date.now());
      timer = setInterval(() => {
        const at = Date.now(); setNow(at);
        if (at - lastRefresh >= 15_000) { lastRefresh = at; void refresh(); }
      }, 1000);
    };
    if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') start();
    void refresh();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') start(); else { if (timer) clearInterval(timer); timer = undefined; }
    });
    return () => { if (timer) clearInterval(timer); listener.remove(); };
  }, [refresh]));
  return now;
}
