import { router, usePreventRemove } from 'expo-router';
import { useCallback, useId, useLayoutEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useWorkScope } from '@/state/work-flow';

export function home() { router.dismissTo('/'); }
export function back() { if (router.canGoBack()) router.back(); else router.replace('/'); }
export function useDraftGuard(dirty: boolean, allowed: () => boolean, allow: () => void, discard: () => void | boolean | Promise<void | boolean>, message = '保存や一時解除は行いません。入力を続けることもできます。') {
  const discarding = useRef(false), id = useId(), scope = useWorkScope();
  const latest = useRef({ allowed, allow, discard, message });
  useLayoutEffect(() => { latest.current = { allowed, allow, discard, message }; });
  const request = useCallback((repeat: () => void) => {
    if (latest.current.allowed()) { repeat(); return; }
    Alert.alert('入力を破棄して戻りますか', latest.current.message, [
      { text: '入力を続ける', style: 'cancel' },
      { text: '破棄して戻る', style: 'destructive', onPress: () => {
        if (discarding.current) return;
        discarding.current = true;
        void (async () => {
          try {
            if (await latest.current.discard() !== false) { latest.current.allow(); repeat(); }
          } catch { /* Keep removal blocked when discard cannot be acknowledged. */ }
          finally { discarding.current = false; }
        })();
      } },
    ]);
  }, []);
  usePreventRemove(dirty && !scope, ({ repeat }) => request(repeat));
  const register = scope?.register;
  useLayoutEffect(() => {
    register?.(id, { dirty, request });
    return () => register?.(id);
  }, [register, id, dirty, request]);
}
