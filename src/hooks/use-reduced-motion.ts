import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Conservative until the OS responds, and follows changes while the screen is open. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true, changed = false;
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      changed = true;
      if (active) setReduced(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (active && !changed) setReduced(value);
    }).catch(() => { /* Keep the static presentation if OS settings cannot be read. */ });
    return () => { active = false; listener.remove(); };
  }, []);
  return reduced;
}
