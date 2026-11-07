import { type NativeModule, requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { createNativeClient } from './src/client';

interface ItomaNativePort extends NativeModule {
  readonly apiVersion: number;
  validateDuration(minutes: number): unknown;
  reportSmokeResult(commit: string, passed: boolean): boolean;
}

const load = () => requireOptionalNativeModule<ItomaNativePort>('ItomaNative');
export const itomaNative = createNativeClient(Platform.OS, load);
export type { BridgeAvailability, DurationValidation } from './src/client';

/** QA signal only: native also requires an explicit launch environment flag. No product state. */
export function reportNativeSmokeResult(commit: string, passed: boolean): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    const native = load();
    return typeof native?.reportSmokeResult === 'function' && native.reportSmokeResult(commit, passed);
  } catch {
    return false;
  }
}
