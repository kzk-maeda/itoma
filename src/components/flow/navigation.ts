import { router, usePreventRemove } from 'expo-router';
import { useRef } from 'react';
import { Alert } from 'react-native';

export function home() { router.dismissTo('/'); }
export function back() { if (router.canGoBack()) router.back(); else router.replace('/'); }
export function useDraftGuard(dirty: boolean, allowed: () => boolean, allow: () => void, discard: () => void | boolean | Promise<void | boolean>) {
  const discarding = useRef(false);
  usePreventRemove(dirty, ({ repeat }) => {
    if (allowed()) { repeat(); return; }
    Alert.alert('入力を破棄して戻りますか', '保存や一時解除は行いません。入力を続けることもできます。', [
      { text: '入力を続ける', style: 'cancel' },
      { text: '破棄して戻る', style: 'destructive', onPress: () => {
        if (discarding.current) return;
        discarding.current = true;
        void (async () => {
          try {
            if (await discard() !== false) { allow(); repeat(); }
          } catch { /* Keep removal blocked when discard cannot be acknowledged. */ }
          finally { discarding.current = false; }
        })();
      } },
    ]);
  });
}
