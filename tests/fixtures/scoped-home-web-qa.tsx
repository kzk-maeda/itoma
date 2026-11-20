// Local browser QA only. Applied temporarily by docs/qa/scoped-home-deck/web-harness.patch; never imported by production.
import { useEffect } from 'react';
import { Alert, Dimensions, type ScaledSize } from 'react-native';
import { useScreenTime } from '../../src/state/screen-time';
import { offHoursSnapshot, offHoursNow } from './off-hours';
import { scopedSnapshot, at2130, at2205, ids } from './scoped-rules';
const realNow = Date.now; let clockBase = realNow();
let snapshot = scopedSnapshot(), selected = ids.x, sequence = 10;
const qa = (globalThis as any).__itomaQA = { at: at2130, fontScale: 1, actions: [] as string[], alert: undefined as any,
  scenario(name: string) {
    if (name.startsWith('off-')) {
      qa.at = offHoursNow; snapshot = offHoursSnapshot();
      if (name === 'off-tomorrow') snapshot = { ...snapshot, nextPeriod: { ruleID: ids.night, startsAt: Date.parse('2026-11-21T07:00:00Z') / 1000, endsAt: Date.parse('2026-11-21T08:00:00Z') / 1000 } };
      if (name === 'off-week') snapshot = { ...snapshot, nextPeriod: { ruleID: ids.night, startsAt: Date.parse('2026-11-27T21:00:00Z') / 1000, endsAt: Date.parse('2026-11-27T23:00:00Z') / 1000 } };
      if (name === 'off-overnight') snapshot = { ...snapshot, nextPeriod: { ...snapshot.nextPeriod!, endsAt: Date.parse('2026-11-21T07:00:00Z') / 1000 } };
      if (name === 'off-none') snapshot = { ...snapshot, rules: snapshot.rules.map(r => ({ ...r, enabled: false })), nextPeriod: undefined };
      if (name === 'off-missing') snapshot = { ...snapshot, nextPeriod: undefined };
      if (name === 'off-no-goal') snapshot = { ...snapshot, rules: snapshot.rules.map(r => ({ ...r, goal: undefined })) };
      if (name === 'off-unknown') snapshot = { ...snapshot, observation: 'unknown' };
      if (name === 'off-paused') snapshot = { ...snapshot, activation: 'paused' };
      if (name === 'off-long') snapshot = { ...snapshot, rules: snapshot.rules.map(r => ({ ...r, title: '自分で決めた夜の大切な時間を守るための長い日本語のルール名', goal: '気になっていた本をゆっくり読むために、通知や画面から距離を置き、自分で選んだ時間を過ごしたい。\n未読のページから少しずつ読み進める。' })) };
    }
    else if (name === 'late') { qa.at = at2205; snapshot = scopedSnapshot(true); }
    else if (name === 'long') snapshot = { ...snapshot, rules: snapshot.rules.map(r => ({ ...r, title: 'これは長い日本語のルール名です。自分で決めた夜の大切な時間を守ります', goal: '気になっていた本をゆっくり読むために、通知や画面から距離を置き、自分で選んだ時間を過ごしたい。\n未読のページから少しずつ読み進める。' })) };
    else if (name === 'unknown') snapshot = { ...snapshot, observation: 'unknown' };
    else if (name === 'paused') snapshot = { ...snapshot, activation: 'paused' };
    else if (name === 'granted') snapshot = { ...snapshot, targets: snapshot.targets.map(t => ({ ...t, restricted: false, unlockable: false, grantCommandID: ids.command, grantStatus: 'active', grantEndsAt: Date.now() / 1000 + 300 })) };
    else { qa.at = at2130; snapshot = scopedSnapshot(); }
    clockBase = realNow(); snapshot = { ...snapshot, sequence: String(++sequence) };
  },
};
// Test-only fontScale port for exercising the native layout branch in a Web renderer.
const getDimensions = Dimensions.get, listenDimensions = Dimensions.addEventListener;
Dimensions.get = key => ({ ...getDimensions.call(Dimensions, key), fontScale: qa.fontScale });
Dimensions.addEventListener = (type, listener) => listenDimensions.call(Dimensions, type, (value: { window: ScaledSize; screen: ScaledSize }) => listener({ ...value, window: { ...value.window, fontScale: qa.fontScale } }));
Date.now = () => qa.at + realNow() - clockBase;
Alert.alert = (title, message, actions) => { qa.alert = { title, message, actions }; };
export const qaSetup = { run: async () => ({ status: 'ok' as const, impacts: [], onboarding: { revision: '1', seenIntro: true, completed: true, selectionReady: false, canEdit: true } }) };
export const qaClient = { async run(action: any, request: any = {}) {
  qa.actions.push(action);
  if (action === 'previewUnlock') { selected = request.targetRef; return { status: 'confirmation-required' as const, impacts: [], snapshot, ref: ids.preview, minutes: request.minutes, previewEndsAt: Date.now() / 1000 + 300 }; }
  if (action === 'unlock') snapshot = { ...snapshot, sequence: String(++sequence), targets: snapshot.targets.map(t => t.ref === selected ? { ...t, restricted: false, unlockable: false, grantCommandID: ids.command, grantStatus: 'active', grantEndsAt: Date.now() / 1000 + 300 } : t) };
  return { status: 'ok' as const, impacts: [], snapshot, ...(action === 'unlock' ? { ref: ids.command } : {}) };
} };
export function QAObserver() { const state = useScreenTime(); useEffect(() => { (qa as any).refresh = state.refresh; (qa as any).state = () => ({ draft: state.unlockDraft, preview: state.unlockPreviewRef, busy: state.busy, home: state.homeRuleKey }); }, [state]); return null; }
