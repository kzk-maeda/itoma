import { Stack, usePreventRemove, useSegments } from 'expo-router';
import { createContext, useCallback, useContext, useState } from 'react';
import { View } from 'react-native';
import { defaultWorkReturn, type WorkDestination } from '@/lib/navigation-state';
import { useAppNavigation } from './navigation';

type ExitGuard = { dirty: boolean; request: (repeat: () => void) => void };
type Scope = { close: () => void; register: (id: string, guard?: ExitGuard) => void };
const Context = createContext<Scope | undefined>(undefined);
export const useWorkScope = () => useContext(Context);

export function WorkFlowLayout() {
  const navigation = useAppNavigation(), segments = useSegments();
  const [guards, setGuards] = useState<ReadonlyMap<string, ExitGuard>>(() => new Map());
  const register = useCallback((id: string, guard?: ExitGuard) => setGuards(previous => {
    const next = new Map(previous); if (guard) next.set(id, guard); else next.delete(id); return next;
  }), []);
  const active = [...guards.values()].filter(value => value.dirty).at(-1);
  // This boundary is removed only when the whole modal leaves. Internal step-back keeps input.
  usePreventRemove(!!active, ({ repeat }) => { if (active) active.request(repeat); else repeat(); });
  const screen = segments.at(-1) as WorkDestination['screen'];
  const close = () => navigation.close(defaultWorkReturn(screen));
  return <Context.Provider value={{ close, register }}><View style={{ flex: 1 }} accessibilityViewIsModal>
    <Stack screenOptions={{ headerShown: false }} />
  </View></Context.Provider>;
}
