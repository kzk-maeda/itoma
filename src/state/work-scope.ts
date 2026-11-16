import { createContext, useContext } from 'react';
export type ExitGuard = { dirty: boolean; request: (repeat: () => void) => void };
export type WorkScope = { close: () => void; back: () => void; register: (id: string, guard?: ExitGuard) => void };
export const WorkScopeContext = createContext<WorkScope | undefined>(undefined);
export const useWorkScope = () => useContext(WorkScopeContext);
