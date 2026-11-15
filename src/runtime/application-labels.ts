import { createContext } from 'react';
/** Optional external identity renderer's data. Native still uses Apple's saved-selection view. */
export const ApplicationLabels = createContext<((selectionRef: string, targetRef: string) => string | undefined) | undefined>(undefined);
