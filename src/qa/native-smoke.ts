import { itomaNative, reportNativeSmokeResult } from '../../modules/itoma-native';

let ran = false;

/** Opt-in synthetic JS -> Swift proof. It never reads or changes a user's settings/reasons. */
export function runNativeSmoke() {
  if (process.env.EXPO_PUBLIC_NATIVE_SMOKE !== '1' || ran) return;
  ran = true;
  const commit = process.env.EXPO_PUBLIC_BUILD_SHA;
  if (!commit || commit.length !== 40 || !/^[0-9a-f]{40}$/.test(commit)) return;
  const availability = itomaNative.getAvailability();
  const valid = itomaNative.validateDuration(5);
  const invalid = itomaNative.validateDuration(0);
  reportNativeSmokeResult(commit,
    availability.status === 'available' && availability.osRestrictions === 'unconnected'
    && valid.status === 'valid' && valid.minutes === 5 && invalid.status === 'invalid');
}
