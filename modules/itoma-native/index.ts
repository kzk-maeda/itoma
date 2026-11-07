import { type NativeModule, requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { createNativeClient } from './src/client';
import { createScreenTimePoCClient } from './src/screen-time-poc';

interface ItomaNativePort extends NativeModule {
  readonly apiVersion: number;
  validateDuration(minutes: number): unknown;
  reportSmokeResult(commit: string, passed: boolean): boolean;
  screenTimePoC(action: string, ref: string | null): Promise<unknown>;
}

const load = () => requireOptionalNativeModule<ItomaNativePort>('ItomaNative');
export const itomaNative = createNativeClient(Platform.OS, load);
export const screenTimePoC = createScreenTimePoCClient(Platform.OS, load);
export type { PoCAction, PoCCode, PoCSnapshot, PoCResult } from './src/screen-time-poc';
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
