import { createContext } from 'react';
import type { HistoryRow } from '../../modules/itoma-native';
/** Proposed historical context. Production v1 does not supply this port; never use current settings. */
export type HistoricalChoiceContext = Readonly<{ applicationLabel?: string; ruleTitle?: string; goal?: string; requestedMinutes?: number }>;
export const HistoricalChoices = createContext<((row: HistoryRow) => HistoricalChoiceContext | undefined) | undefined>(undefined);
