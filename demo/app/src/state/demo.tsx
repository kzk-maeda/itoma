import { createContext, type ReactNode, useContext, useState } from 'react';
import { scenarios, type ScenarioID } from '../scenarios/home';

type State = { scenario: typeof scenarios[number]; choose: (id: ScenarioID) => void };
const Context = createContext<State | undefined>(undefined);
export function DemoProvider({ children }: { children: ReactNode }) {
  const [id, setID] = useState<ScenarioID>('today');
  return <Context.Provider value={{ scenario: scenarios.find(s => s.id === id)!, choose: setID }}>{children}</Context.Provider>;
}
export function useDemo() {
  const state = useContext(Context);
  if (!state) throw new Error('DemoProvider missing');
  return state;
}
