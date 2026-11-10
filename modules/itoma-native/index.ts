import { type NativeModule, requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { createNativeClient } from './src/client';
import { createScreenTimePoCClient } from './src/screen-time-poc';
import { createScreenTimeClient } from './src/screen-time';
import { createHistoryClient } from './src/history';
import { createReflectionClient } from './src/reflection';

interface ItomaNativePort extends NativeModule {
  readonly apiVersion: number;
  readonly screenTimePoCUIVersion?: number;
  readonly screenTimeVersion?: number;
  readonly historyVersion?: number;
  readonly reflectionVersion?: number;
  reflection?(action: string, payload: string): Promise<string>;
  history?(action: string, payload: string): Promise<string>;
  screenTime?(action: string, payload: string): Promise<string>;
  validateDuration(minutes: number): unknown;
  reportSmokeResult(commit: string, passed: boolean): boolean;
  screenTimePoC(action: string, ref: string | null): Promise<string>;
}

const load = () => requireOptionalNativeModule<ItomaNativePort>('ItomaNative');
export const itomaNative = createNativeClient(Platform.OS, load);
export const screenTimePoC = createScreenTimePoCClient(Platform.OS, load);
export const screenTime = createScreenTimeClient(Platform.OS, load);
export const historyRecords = createHistoryClient(Platform.OS, load);
export const reflectionRecords = createReflectionClient(Platform.OS, load);
export type { ReflectionAction, ReflectionResponse } from './src/reflection';
export type { ReflectionSnapshot, ReflectionRequest, ReflectionPeriod } from './src/reflection-model';
export type { HistoryAction, HistoryKind, HistoryCode, HistoryCursor, HistoryRow, HistoryPage, HistoryReason, HistoryRequest, HistoryResponse } from './src/history';
export type { ScreenTimeAction, ScreenTimeCode, ScreenTimeRule, RuleInput, ScreenTimeTarget, ScreenTimePeriod, ScreenTimeSnapshot, ScreenTimeResponse, ScreenTimeRequest } from './src/screen-time';
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

/** New native views/actions require a build that contains the matching implementation. */
export function supportsSavedSelectionUI(): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    const native = load();
    return native?.apiVersion === 1 && typeof native.screenTimePoCUIVersion === 'number' && native.screenTimePoCUIVersion >= 2;
  }
  catch { return false; }
}
