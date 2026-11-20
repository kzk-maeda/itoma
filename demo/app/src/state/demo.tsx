import { createContext, type ReactNode, useContext, useState } from 'react';
import type { ReflectionPeriod } from '../../../../modules/itoma-native/src/reflection-model';
import { datasets, type Dataset } from '../scenarios/records';
type State = { dataset: Dataset; choose: (id: string) => void; period: ReflectionPeriod; setPeriod: (period: ReflectionPeriod) => void; anchor: string; setAnchor: (anchor: string) => void };
const Context = createContext<State | undefined>(undefined);
export function DemoProvider({ children }: { children: ReactNode }) {
  const [id, setID] = useState('normal'), [period, setPeriod] = useState<ReflectionPeriod>('week');
  const [positions, setPositions] = useState({ week: '2026-11-16', month: '2026-11-01' });
  return <Context.Provider value={{ dataset: datasets.find(value => value.id === id)!, choose: next => { setID(next); setPositions({ week: '2026-11-16', month: '2026-11-01' }); }, period, setPeriod, anchor: positions[period], setAnchor: next => setPositions(value => ({ ...value, [period]: next })) }}>{children}</Context.Provider>;
}
export function useDemo() { const value = useContext(Context); if (!value) throw new Error('DemoProvider missing'); return value; }
