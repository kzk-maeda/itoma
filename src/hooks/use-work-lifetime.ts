import { useCallback, useEffect, useRef } from 'react';
/** Accepted native work continues; a hidden/removed screen must not redirect a later flow. */
export function useWorkLifetime() {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return useCallback(() => mounted.current, []);
}
