import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import { durationWords } from '../scenarios/time-growth';
import { foldMessage, nextLayerStep, withAddedTime } from '../scenarios/time-layers';
import type { CircleStyle } from '../scenarios/circle-styles';
import { growthDays, growthScenes } from '../scenarios/time-growth';
import type { ReflectionPeriod } from '../../../../modules/itoma-native/src/reflection-model';
function useGrowthState() {
  const [look, chooseLook] = useState<CircleStyle>('layers');
  const [id, setID] = useState('days'), [period, setPeriod] = useState<ReflectionPeriod>('week');
  const [positions, setPositions] = useState({ week: '2026-11-16', month: '2026-11-01' });
  const [action, setAction] = useState<{ steps: number[]; note: string }>({ steps: [], note: '' });
  const base = growthScenes.find(value => value.id === id)!;
  const scene = useMemo(() => withAddedTime(base, action.steps), [base, action.steps]);
  const addTime = () => { if (base.seconds === undefined) return; setAction(previous => { const before = base.seconds! + previous.steps.reduce((sum, value) => sum + value, 0), step = nextLayerStep(before); return { steps: [...previous.steps, step], note: foldMessage(before, before + step) ?? `${durationWords(step)}の層を重ねました。` }; }); };
  const undoTime = () => setAction(previous => ({ steps: previous.steps.slice(0, -1), note: '1回分を戻しました。' }));
  const records = useMemo(() => growthDays(scene), [scene]);
  return { look, chooseLook, scene, records, addTime, undoTime, canUndo: action.steps.length > 0, actionNote: action.note, choose: (next: string) => { setID(next); setAction({ steps: [], note: '' }); setPositions({ week: '2026-11-16', month: '2026-11-01' }); }, period, setPeriod, anchor: positions[period], setAnchor: (value: string) => setPositions(previous => ({ ...previous, [period]: value })) };
}
const Context = createContext<ReturnType<typeof useGrowthState> | undefined>(undefined);
export function GrowthProvider({ children }: { children: ReactNode }) { const state = useGrowthState(); return <Context.Provider value={state}>{children}</Context.Provider>; }
export function useGrowth() { const state = useContext(Context); if (!state) throw Error('GrowthProvider missing'); return state; }
