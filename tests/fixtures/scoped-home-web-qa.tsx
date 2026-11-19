// Local browser QA only. Applied temporarily by docs/qa/scoped-home-deck/web-harness.patch; never imported by production.
import { useEffect } from 'react';
import { Alert } from 'react-native';
import { useScreenTime } from '../../src/state/screen-time';
import { scopedSnapshot, at2130, at2205, ids } from './scoped-rules';
const realNow = Date.now; let clockBase = realNow();
let snapshot = scopedSnapshot(), selected = ids.x, sequence = 10;
const qa = (globalThis as any).__itomaQA = { at: at2130, actions: [] as string[], alert: undefined as any,
  scenario(name: string) {
    if (name === 'late') { qa.at = at2205; snapshot = scopedSnapshot(true); }
    else if (name === 'long') snapshot = { ...snapshot, rules: snapshot.rules.map(r => ({ ...r, title: 'これは長い日本語のルール名です。自分で決めた夜の大切な時間を守ります', goal: '気になっていた本をゆっくり読むために、通知や画面から距離を置き、自分で選んだ時間を過ごしたい。\n未読のページから少しずつ読み進める。' })) };
    else if (name === 'unknown') snapshot = { ...snapshot, observation: 'unknown' };
    else if (name === 'paused') snapshot = { ...snapshot, activation: 'paused' };
    else if (name === 'granted') snapshot = { ...snapshot, targets: snapshot.targets.map(t => ({ ...t, restricted: false, unlockable: false, grantCommandID: ids.command, grantStatus: 'active', grantEndsAt: Date.now() / 1000 + 300 })) };
    else { qa.at = at2130; snapshot = scopedSnapshot(); }
    clockBase = realNow(); snapshot = { ...snapshot, sequence: String(++sequence) };
  },
};
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
