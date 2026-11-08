import { useEffect } from 'react';

import { completeNativeHomeSmoke } from '@/qa/native-smoke';

import { HomeView } from './home-view';
import { PoCRecoveryEntry } from './poc-recovery-entry';

/** Product rule snapshots are not connected yet (#56). Never manufacture an active period. */
export function HomeScreen() {
  useEffect(() => { completeNativeHomeSmoke(); }, []);
  return <HomeView recoveryEntry={<PoCRecoveryEntry />} />;
}
