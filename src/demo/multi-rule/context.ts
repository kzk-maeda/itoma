import { createContext, useContext } from 'react';
import type { createMultiRuleDemo, ScenarioID } from './fixture';
export type MultiRuleRuntime = ReturnType<typeof createMultiRuleDemo> & { scenario: ScenarioID; choose: (scenario: ScenarioID) => void };
export const MultiRuleContext = createContext<MultiRuleRuntime | undefined>(undefined);
export const useMultiRuleDemo = () => useContext(MultiRuleContext);
