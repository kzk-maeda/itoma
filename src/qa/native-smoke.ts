import { router } from 'expo-router';

import type { PoCResult } from '../../modules/itoma-native';
import { itomaNative, reportNativeSmokeResult, screenTimePoC, screenTime, historyRecords, reflectionRecords } from '../../modules/itoma-native';

let ran = false;
let bridgePassed = false;
let completed = false;
let pocPassed = false;
let historyPassed = false;
let reflectionPassed = false;

function qaCommit() {
  if (process.env.EXPO_PUBLIC_NATIVE_SMOKE !== '1') return null;
  const commit = process.env.EXPO_PUBLIC_BUILD_SHA;
  return commit && commit.length === 40 && /^[0-9a-f]{40}$/.test(commit) ? commit : null;
}

const simulatorSnapshot = (result: PoCResult) => result.status === 'snapshot'
  && result.snapshot.availability === 'simulator-unavailable'
  && result.snapshot.authorization === 'unknown' && result.snapshot.storage === 'not-created'
  && result.snapshot.selections.length === 0 && result.snapshot.observation === 'unknown'
  && result.snapshot.operation === 'idle' && result.snapshot.code === null;

/** Opt-in synthetic JS -> Swift proof. It never reads or changes a user's settings/reasons. */
export async function runNativeSmoke() {
  const commit = qaCommit();
  if (!commit || ran) return;
  ran = true;
  const availability = itomaNative.getAvailability();
  const valid = itomaNative.validateDuration(5);
  const invalid = itomaNative.validateDuration(0);
  const poc = await screenTimePoC.run('snapshot');
  const product = await screenTime.run('snapshot');
  const history = simulatorSnapshot(poc) && product.snapshot?.availability === 'simulator'
    ? await historyRecords.run('page') : undefined;
  const reflection = history?.status === 'ok' && history.storage === 'not-created'
    ? await reflectionRecords.run('read') : undefined;
  bridgePassed = availability.status === 'available' && availability.osRestrictions === 'unconnected'
    && valid.status === 'valid' && valid.minutes === 5 && invalid.status === 'invalid'
    && simulatorSnapshot(poc) && product.status === 'error' && product.code === 'unavailable'
    && product.snapshot?.availability === 'simulator' && product.snapshot.storage === 'not-created'
    && product.snapshot.targets.length === 0 && product.snapshot.observation === 'unknown'
    && history?.status === 'ok' && history.storage === 'not-created' && !history.page
    && reflection?.status === 'ok' && reflection.storage === 'not-created' && !reflection.snapshot;
  if (!bridgePassed) {
    completed = true; reportNativeSmokeResult(commit, false); return;
  }
  // Stay inside the app: simctl openurl can stop at the OS "Open in itoma?" dialog.
  // No passing marker exists until the destination screen obtains its own typed snapshot.
  try { router.replace('/native-poc'); }
  catch { completed = true; reportNativeSmokeResult(commit, false); }
}

/** Called only by the mounted PoC screen after a read-only response. Normal builds are a no-op. */
export function completeNativePoCSmoke(result: PoCResult) {
  const commit = qaCommit();
  if (!commit || !ran || !bridgePassed || completed) return;
  if (!simulatorSnapshot(result)) {
    completed = true; reportNativeSmokeResult(commit, false); return;
  }
  if (pocPassed) return;
  pocPassed = true;
  try { router.replace('/history'); }
  catch { completed = true; reportNativeSmokeResult(commit, false); }
}

/** The history route obtains its own bounded, read-only native response before returning home. */
export function completeNativeHistorySmoke(passed: boolean) {
  const commit = qaCommit();
  if (!commit || !bridgePassed || !pocPassed || historyPassed || completed) return;
  if (!passed) { completed = true; reportNativeSmokeResult(commit, false); return; }
  historyPassed = true;
  try { router.replace('/reflection'); }
  catch { completed = true; reportNativeSmokeResult(commit, false); }
}

/** The normal reflection route proves its own read-only response, without fixture or OS writes. */
export function completeNativeReflectionSmoke(passed: boolean) {
  const commit = qaCommit();
  if (!commit || !bridgePassed || !pocPassed || !historyPassed || reflectionPassed || completed) return;
  if (!passed) { completed = true; reportNativeSmokeResult(commit, false); return; }
  reflectionPassed = true;
  try { router.replace('/'); }
  catch { completed = true; reportNativeSmokeResult(commit, false); }
}

/** Normal launches are a no-op. Pass only after bridge -> PoC screen -> home mount. */
export function completeNativeHomeSmoke() {
  const commit = qaCommit();
  if (!commit || !bridgePassed || !pocPassed || !historyPassed || !reflectionPassed || completed) return;
  completed = true;
  reportNativeSmokeResult(commit, true);
}
