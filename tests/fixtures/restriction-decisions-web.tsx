// Browser QA only. The temporary root layout patch injects these synthetic native responses.
import { useEffect } from 'react';
import { Alert, type AlertButton } from 'react-native';
import type { ScreenTimeAction, ScreenTimeRequest, ScreenTimeResponse, ScreenTimeSnapshot } from '../../modules/itoma-native';
import { useScreenTime } from '../../src/state/screen-time';
import { ids, scopedSnapshot } from './scoped-rules';

const start = Date.parse('2026-11-19T22:57:00Z'), expiry = start / 1000 + 180;
let clock = start, revision = 0, snapshot: ScreenTimeSnapshot, allowReconcile = true;
let omitPreviewSnapshot = false;
let lastAlert: AlertButton[] | undefined;
const actions: ScreenTimeAction[] = [];
function scenario(name: 'review' | 'unconfirmed' | 'schedules', long = false) {
  clock = start;
  const source = scopedSnapshot(), [instagram, x] = source.targets;
  snapshot = { ...source, sequence: String(++revision), evaluatedAt: start / 1000, validUntil: expiry, nextPeriod: undefined,
    activation: name === 'schedules' ? 'paused' : 'enabled', observation: name === 'review' ? 'applied' : 'unknown',
    rules: [{ ...source.rules[0], title: long ? '通知から少し距離を置いて、気になっていた本を読む夜の時間' : '夜の読書', goal: undefined, endMinute: 1380 },
      { ...source.rules[1], title: '朝の支度', startMinute: 420, endMinute: 480, enabled: false }],
    periods: [{ ruleID: ids.night, startsAt: expiry - 7200, endsAt: expiry }], targets: [instagram, { ...x, ruleID: ids.night }],
  };
}
scenario('review');
if (typeof window !== 'undefined') {
  Date.now = () => clock;
  Alert.alert = (_title, _message, buttons) => { lastAlert = buttons; };
}
const qa = { actions, scenario, setClock: (secondsAfterStart: number) => { clock = start + secondsAfterStart * 1000; },
  omitNextPreviewSnapshot: () => { omitPreviewSnapshot = true; },
  reconcilesSuccessfully: (value: boolean) => { allowReconcile = value; },
  choose: (index: number) => { const action = lastAlert?.[index]; lastAlert = undefined; action?.onPress?.(); },
  refresh: undefined as ReturnType<typeof useScreenTime>['refresh'] | undefined,
};
export const qaSetup = { run: async () => ({ status: 'ok' as const, impacts: [], onboarding: { revision: '1', seenIntro: true, completed: true, selectionReady: false, canEdit: true } }) };
export const qaClient = { async run(action: ScreenTimeAction, request: ScreenTimeRequest = {}): Promise<ScreenTimeResponse> {
  if (typeof window !== 'undefined') actions.push(action);
  if (action === 'previewUnlock') {
    const previewSnapshot = omitPreviewSnapshot ? undefined : snapshot;
    omitPreviewSnapshot = false;
    return { status: 'confirmation-required', impacts: [], snapshot: previewSnapshot, ref: ids.preview, minutes: request.minutes, previewEndsAt: expiry, shortened: true };
  }
  if (action === 'reconcile' && !allowReconcile) return { status: 'error', code: 'application-uncertain', impacts: [] };
  if (action === 'reconcile') snapshot = { ...snapshot, sequence: String(++revision), observation: 'applied' };
  if (action === 'stop' || action === 'resume') snapshot = { ...snapshot, sequence: String(++revision), activation: action === 'stop' ? 'paused' : 'enabled' };
  return { status: 'ok', impacts: [], snapshot };
} };
export function QAObserver() {
  const { refresh } = useScreenTime();
  useEffect(() => { qa.refresh = refresh; (window as typeof window & { __itomaDecisionQA?: typeof qa }).__itomaDecisionQA = qa; }, [refresh]);
  return null;
}
