import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import { growthDays, growthScenes } from '../scenarios/time-growth';
import type { ReflectionPeriod } from '../../../../modules/itoma-native/src/reflection-model';
function useGrowthState() {
  const [id, setID] = useState('days'), [period, setPeriod] = useState<ReflectionPeriod>('week');
  const [positions, setPositions] = useState({ week: '2026-11-16', month: '2026-11-01' });
  const scene = growthScenes.find(value => value.id === id)!;
  const records = useMemo(() => growthDays(scene), [scene]);
  return { scene, records, choose: (next: string) => { setID(next); setPositions({ week: '2026-11-16', month: '2026-11-01' }); }, period, setPeriod, anchor: positions[period], setAnchor: (value: string) => setPositions(previous => ({ ...previous, [period]: value })) };
}
const Context = createContext<ReturnType<typeof useGrowthState> | undefined>(undefined);
export function GrowthProvider({ children }: { children: ReactNode }) { const state = useGrowthState(); return <Context.Provider value={state}>{children}</Context.Provider>; }
export function useGrowth() { const state = useContext(Context); if (!state) throw Error('GrowthProvider missing'); return state; }
