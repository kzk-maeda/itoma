import { unavailableSnapshot, type ScreenTimeAction, type ScreenTimeRequest, type ScreenTimeResponse, type ScreenTimeRule, type ScreenTimeSnapshot } from '../../../modules/itoma-native/src/screen-time';

export const scenarios = [
  { id: 'overlap', label: '重複中', hour: 21, minute: 30 },
  { id: 'single', label: '単独ルール', hour: 20, minute: 30 },
  { id: 'switch', label: '22時の切替後', hour: 22, minute: 5 },
  { id: 'outside', label: '時間外', hour: 19, minute: 0 },
  { id: 'grant', label: '一時解除中', hour: 21, minute: 30 },
  { id: 'overnight', label: '日跨ぎ', hour: 0, minute: 30 },
  { id: 'unknown', label: '反映未確認', hour: 21, minute: 30 },
  { id: 'paused', label: '全体停止', hour: 21, minute: 30 },
] as const;
export type ScenarioID = typeof scenarios[number]['id'];
const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const [morning, evening, reading, sleep] = [1, 2, 3, 4].map(id);
export const appIDs = { x: id(11), instagram: id(12), youtube: id(13), tiktok: id(14) };
const allDays = [1, 2, 3, 4, 5, 6, 7];
const makeRule = (ref: string, title: string, start: number, end: number, goal?: string): ScreenTimeRule => ({
  id: ref, selectionRef: ref, title, goal, startMinute: start, endMinute: end, weekdays: allDays, enabled: true, nextDay: end <= start,
});
export const rules = [
  makeRule(morning, '朝の準備', 480, 540),
  makeRule(evening, '夜の自分時間', 1200, 1380, 'スマホを置いて、ゆっくり過ごす。'),
  makeRule(reading, '読書に集中', 1260, 1320, '読みかけの本を、もう少し。'),
  makeRule(sleep, 'おやすみ前', 1320, 420, '眠る前に、気持ちを落ち着ける。'),
];
const members: Record<string, string[]> = {
  [morning]: [appIDs.x], [evening]: [appIDs.x, appIDs.instagram],
  [reading]: [appIDs.x, appIDs.youtube], [sleep]: [appIDs.x, appIDs.tiktok],
};
const identities: Record<string, { name: string; glyph: string }> = {
  [appIDs.x]: { name: 'X', glyph: '𝕏' }, [appIDs.instagram]: { name: 'Instagram', glyph: '◎' },
  [appIDs.youtube]: { name: 'YouTube', glyph: '▶' }, [appIDs.tiktok]: { name: 'TikTok', glyph: '♪' },
};
export function demoAppIdentity(selectionRef: string, targetRef?: string) {
  return (targetRef ? [targetRef] : members[selectionRef] ?? []).map(ref => identities[ref]).filter(Boolean);
}
/** Fictional controller; no native calls, OS changes, purchase or disk write. This fixed
 * scenario precedence does not replace production RuleEvaluator or represent OS success. */
export function createMultiRuleDemo() {
  let scenario: ScenarioID = 'overlap', offset = 0, sequence = 0;
  type Grant = { target: string; endsAt: number; ruleID: string; ref: string };
  let grant: Grant | undefined, preview: Grant | undefined;
  const now = () => Date.now() + offset;
  const at = (minutes: number, day = 0) => {
    const date = new Date(now()); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() + day);
    date.setMinutes(minutes); return date.getTime() / 1000;
  };
  const periods = () => rules.flatMap(rule => [-1, 0, 1].map(day => ({
    ruleID: rule.id, startsAt: at(rule.startMinute, day), endsAt: at(rule.endMinute, day + (rule.nextDay ? 1 : 0)),
  })));
  const snapshot = (): ScreenTimeSnapshot => {
    const time = now() / 1000, all = periods(), active = all.filter(p => p.startsAt <= time && p.endsAt > time);
    const enabled = scenario !== 'paused';
    if (grant && (grant.endsAt <= time || !active.some(p => p.ruleID === grant!.ruleID))) grant = undefined;
    const targets = Object.values(appIDs).map(ref => {
      // Fixed fixture: sleep > reading > evening > morning.
      const rule = [...rules].reverse().find(rule => active.some(p => p.ruleID === rule.id) && members[rule.id].includes(ref));
      const validGrant = grant?.target === ref && grant.ruleID === rule?.id ? grant : undefined;
      return { ref, selectionRef: rule?.selectionRef ?? rules.find(rule => members[rule.id].includes(ref))!.selectionRef,
        ruleID: enabled ? rule?.id : undefined, restricted: enabled && !!rule && !validGrant,
        unlockable: enabled && !!rule && !validGrant && scenario !== 'unknown',
        grantCommandID: validGrant?.ref, grantEndsAt: validGrant?.endsAt, grantStatus: validGrant ? 'active' as const : undefined };
    });
    return { ...unavailableSnapshot('device'), storage: 'ready', sequence: String(++sequence), revision: '1',
      authorization: 'approved', activation: enabled ? 'enabled' : 'paused', schedulesReady: true,
      rules, selections: rules.map(rule => ({ ref: rule.selectionRef, count: members[rule.id].length })), targets,
      periods: active, nextPeriod: all.filter(p => p.startsAt > time).sort((a, b) => a.startsAt - b.startsAt)[0],
      observation: scenario === 'unknown' ? 'uncertain' : 'applied', evaluatedAt: time, validUntil: time + 60,
      ruleDetailsStatus: 'ready', ruleDetailsRevision: '1' };
  };
  const select = (next: ScenarioID) => {
    scenario = next; grant = undefined; preview = undefined;
    const setting = scenarios.find(value => value.id === next)!;
    const date = new Date(); date.setHours(setting.hour, setting.minute, 0, 0); offset = date.getTime() - Date.now();
    if (next === 'grant') grant = { target: appIDs.x, endsAt: now() / 1000 + 300, ruleID: reading, ref: id(91) };
  };
  select('overlap');
  const client = { async run(action: ScreenTimeAction, request: ScreenTimeRequest = {}): Promise<ScreenTimeResponse> {
    let s = snapshot();
    if (action === 'previewUnlock') {
      const target = s.targets.find(target => target.ref === request.targetRef);
      const period = s.periods.find(period => period.ruleID === target?.ruleID);
      if (!target?.restricted || !target.unlockable || !period || !request.reason?.trim() || !request.minutes || request.minutes < 1 || request.minutes > 30)
        return { status: 'error', code: 'changed', impacts: [], snapshot: s };
      const limit = target.ref === appIDs.x && target.ruleID === evening ? Math.min(period.endsAt, at(1260)) : period.endsAt;
      preview = { target: target.ref, endsAt: Math.min(now() / 1000 + request.minutes * 60, limit), ruleID: target.ruleID!, ref: id(++sequence + 100) };
      return { status: 'confirmation-required', ref: preview.ref, minutes: request.minutes, previewEndsAt: preview.endsAt,
        shortened: preview.endsAt < now() / 1000 + request.minutes * 60, impacts: [], snapshot: s };
    }
    if (action === 'unlock') {
      const target = s.targets.find(target => target.ref === preview?.target);
      if (!preview || preview.ref !== request.ref || preview.endsAt <= now() / 1000 || !request.reason?.trim()
        || target?.ruleID !== preview.ruleID || !target?.unlockable)
        return { status: 'error', code: 'changed', impacts: [], snapshot: s };
      grant = preview; preview = undefined; s = snapshot();
      return { status: 'ok', ref: grant.ref, impacts: [], snapshot: s };
    }
    if (action === 'endGrant') { grant = undefined; s = snapshot(); }
    else if (action === 'cancelUnlock') preview = undefined;
    else if (!['snapshot', 'initialize', 'reconcile'].includes(action))
      return { status: 'error', code: 'unavailable', impacts: [], snapshot: s };
    return { status: 'ok', impacts: [], snapshot: s };
  } };
  const onboarding = { run: async () => ({ status: 'ok' as const, impacts: [],
    onboarding: { revision: '1', seenIntro: true, completed: true, selectionReady: false, canEdit: true } }) };
  return { now, select, client, onboarding };
}
