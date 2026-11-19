import { unavailableSnapshot } from '../../modules/itoma-native/src/screen-time';
import type { ScreenTimeSnapshot, ScreenTimeAction, ScreenTimeRequest, ScreenTimeResponse } from '../../modules/itoma-native';

// Synthetic native DTOs only. No winning-rule/calendar computation is supplied to the product.
export const at2130 = Date.parse('2026-11-19T21:30:00Z');
export const at2205 = Date.parse('2026-11-19T22:05:00Z');
export const ids = { night: '11111111-1111-1111-1111-111111111111', reading: '22222222-2222-2222-2222-222222222222', bed: '33333333-3333-3333-3333-333333333333', selection: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', instagram: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', x: 'cccccccc-cccc-cccc-cccc-cccccccccccc', youtube: 'dddddddd-dddd-dddd-dddd-dddddddddddd', tiktok: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', preview: 'ffffffff-ffff-ffff-ffff-ffffffffffff', command: '99999999-9999-9999-9999-999999999999' };
const second = (time: string) => Date.parse(`2026-11-19T${time}:00Z`) / 1000;
export const names: Record<string, string> = { [ids.instagram]: 'Instagram', [ids.x]: 'X', [ids.youtube]: 'YouTube', [ids.tiktok]: 'TikTok' };
export function scopedSnapshot(later = false): ScreenTimeSnapshot {
  const rules = [
    { id: ids.night, title: '夜の時間', goal: '夜の余白を、自分のために使う', startMinute: 1260, endMinute: 1410 },
    { id: ids.reading, title: '読書', goal: '気になっていた本を読む', startMinute: 1260, endMinute: 1320 },
    { id: ids.bed, title: 'おやすみ前', goal: 'ゆっくり休む準備をする', startMinute: 1320, endMinute: 1439 },
  ].map(rule => ({ ...rule, selectionRef: ids.selection, weekdays: [1, 2, 3, 4, 5, 6, 7], nextDay: false, enabled: true }));
  const winner = later ? ids.bed : ids.reading;
  return { ...unavailableSnapshot('device'), storage: 'ready', authorization: 'approved', activation: 'enabled', schedulesReady: true, observation: 'applied',
    sequence: later ? '2' : '1', revision: later ? '2' : '1', ruleDetailsStatus: 'ready', ruleDetailsRevision: '1',
    evaluatedAt: (later ? at2205 : at2130) / 1000, validUntil: second(later ? '23:30' : '22:00'), rules,
    selections: [{ ref: ids.selection, count: 4 }],
    periods: [ { ruleID: ids.night, startsAt: second('21:00'), endsAt: second('23:30') },
      { ruleID: winner, startsAt: second(later ? '22:00' : '21:00'), endsAt: second(later ? '23:59' : '22:00') } ],
    nextPeriod: later ? undefined : { ruleID: ids.bed, startsAt: second('22:00'), endsAt: second('23:59') },
    targets: [ { ref: ids.instagram, ruleID: ids.night }, { ref: ids.x, ruleID: winner }, { ref: later ? ids.tiktok : ids.youtube, ruleID: winner } ]
      .map(target => ({ ...target, selectionRef: ids.selection, restricted: true, unlockable: true })),
  };
}
export function scopedBackend() {
  let snapshot = scopedSnapshot(), target = ids.x;
  const run = jest.fn(async (action: ScreenTimeAction, request: ScreenTimeRequest = {}): Promise<ScreenTimeResponse> => {
    const response = (extra: Partial<ScreenTimeResponse> = {}): ScreenTimeResponse => ({ status: 'ok', impacts: [], snapshot, ...extra });
    if (action === 'previewUnlock') { target = request.targetRef!; return response({ status: 'confirmation-required', ref: ids.preview, minutes: request.minutes, previewEndsAt: Date.now() / 1000 + 300 }); }
    if (action === 'unlock') snapshot = { ...snapshot, sequence: String(Number(snapshot.sequence) + 1), targets: snapshot.targets.map(t => t.ref === target ? { ...t, restricted: false, unlockable: false, grantCommandID: ids.command, grantStatus: 'active', grantEndsAt: Date.now() / 1000 + 300 } : t) };
    return response(action === 'unlock' ? { ref: ids.command } : {});
  });
  return { client: { run }, current: () => snapshot, replace: (value: Partial<ScreenTimeSnapshot>) => { snapshot = { ...snapshot, ...value }; } };
}
