import { scopedSnapshot, ids } from './scoped-rules';
import type { ScreenTimeSnapshot } from '../../modules/itoma-native';

export const offHoursNow = Date.parse('2026-11-20T19:00:00Z');
export function offHoursSnapshot(): ScreenTimeSnapshot {
  const s = scopedSnapshot();
  return { ...s, evaluatedAt: offHoursNow / 1000, validUntil: offHoursNow / 1000 + 120, period: undefined, periods: [],
    nextPeriod: { ruleID: ids.night, startsAt: Date.parse('2026-11-20T21:00:00Z') / 1000, endsAt: Date.parse('2026-11-20T23:00:00Z') / 1000 },
    targets: s.targets.map(t => ({ ...t, restricted: false, unlockable: false, ruleID: undefined })) };
}
