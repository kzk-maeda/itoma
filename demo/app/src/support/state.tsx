import { createContext, useContext, useState, type ReactNode } from 'react';

type Frequency = 'once' | 'monthly';
export type Choice = { frequency: Frequency; amount: number };
type State = {
  choice?: Choice; select: (value?: Choice) => void;
  frequency: Frequency; switchFrequency: (value: Frequency) => void;
  monthly?: number; receipt?: Choice; confirm: () => void; stop: () => void;
};
const Context = createContext<State | null>(null);
export function SupportProvider({ children }: { children: ReactNode }) {
  const [frequency, setFrequency] = useState<Frequency>('once');
  const [choice, select] = useState<Choice>();
  const [monthly, setMonthly] = useState<number>();
  const [receipt, setReceipt] = useState<Choice>();
  function switchFrequency(value: Frequency) {
    if (value !== frequency) { setFrequency(value); select(undefined); }
  }
  function confirm() {
    if (!choice || (choice.frequency === 'monthly' && monthly)) return;
    setReceipt(choice);
    if (choice.frequency === 'monthly') setMonthly(choice.amount);
    select(undefined);
  }
  return <Context.Provider value={{ choice, select, frequency, switchFrequency, monthly, receipt, confirm, stop: () => setMonthly(undefined) }}>{children}</Context.Provider>;
}
export function useSupport() {
  const state = useContext(Context);
  if (!state) throw new Error('Missing support context');
  return state;
}
