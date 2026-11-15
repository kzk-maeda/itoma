import { createContext } from 'react';
/** Optional external identity renderer's data. Native still uses Apple's saved-selection view. */
export const ApplicationLabels = createContext<((selectionRef: string, targetRef: string) => string | undefined) | undefined>(undefined);

/** Preview glyphs are supplied by the demo, never inferred from real Apple tokens. */
export const ApplicationSymbols = createContext<((selectionRef: string, targetRef: string) => string | undefined) | undefined>(undefined);
