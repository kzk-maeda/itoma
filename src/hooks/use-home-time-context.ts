import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useScreenTime } from '@/state/screen-time';
import { homeTimeContext } from '@/components/home/off-hours-presentation';

/** Shares the screen clock: a civil date/zone/offset change needs a native read, not a new timer. */
export function useHomeTimeContext(now: number) {
  const { refresh, error } = useScreenTime(), key = homeTimeContext(now);
  const [confirmed, setConfirmed] = useState(key);
  useFocusEffect(useCallback(() => {
    if (key === confirmed || error) return;
    let active = true;
    void (async () => {
      // The first read may be pooled with a request begun before the date/zone changed.
      await refresh();
      if (!active) return;
      const result = await refresh();
      if (active && result.status === 'ok' && result.snapshot) setConfirmed(key);
    })();
    // If the read fails, stay unconfirmed. A later successful poll clears error and retries this check.
    return () => { active = false; };
  }, [key, confirmed, refresh, error]));
  return key === confirmed;
}
