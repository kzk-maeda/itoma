import { router } from 'expo-router';

import type { PoCResult } from '../../modules/itoma-native';
import { itomaNative, reportNativeSmokeResult, screenTimePoC } from '../../modules/itoma-native';

let ran = false;
let bridgePassed = false;
let completed = false;

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
  bridgePassed = availability.status === 'available' && availability.osRestrictions === 'unconnected'
    && valid.status === 'valid' && valid.minutes === 5 && invalid.status === 'invalid'
    && simulatorSnapshot(poc);
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
  completed = true;
  reportNativeSmokeResult(commit, simulatorSnapshot(result));
}
