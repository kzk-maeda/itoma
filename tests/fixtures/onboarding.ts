import type { OnboardingAction, OnboardingProgress, OnboardingRequest, OnboardingResponse } from '../../modules/itoma-native/src/onboarding';
import { unavailableSnapshot, type ScreenTimeAction, type ScreenTimeRequest, type ScreenTimeResponse, type ScreenTimeSnapshot } from '../../modules/itoma-native/src/screen-time';

/** Synthetic bridge fixture. No Apple APIs, real identities, filesystem or OS success evidence. */
export function onboardingFixture() {
  const ruleID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', selectionRef = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', commandID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  let progress: OnboardingProgress = { revision: '0', seenIntro: false, completed: false, selectionReady: false, canEdit: true };
  let snapshot: ScreenTimeSnapshot = unavailableSnapshot('device');
  let deny = false, cancel = false, failSave = false, failCommit = false;
  const nativeActions: ScreenTimeAction[] = [], setupActions: OnboardingAction[] = [];
  const advance = () => { progress = { ...progress, revision: String(Number(progress.revision) + 1) }; };
  const response = (): OnboardingResponse => ({ status: 'ok', impacts: [], onboarding: structuredClone(progress), snapshot: structuredClone(snapshot) });
  const setup = { async run(action: OnboardingAction, request?: OnboardingRequest): Promise<OnboardingResponse> {
    setupActions.push(action);
    if (action !== 'onboardingRead' && request?.expectedRevision !== progress.revision) return { status: 'error', code: 'changed', impacts: [] };
    switch (action) {
      case 'onboardingBegin': progress = { ...progress, seenIntro: true, draft: { id: ruleID, step: 'purpose', title: '', goal: '', weekdays: [], start: '', end: '', nextDay: false, submitted: false } }; advance(); break;
      case 'onboardingSave':
        if (failSave) { failSave = false; return { status: 'error', code: 'storage-failed', impacts: [] }; }
        progress = { ...progress, draft: { ...request!.draft!, submitted: false }, selectionReady: request?.draft?.selectionRef === selectionRef && snapshot.authorization === 'approved' }; advance(); break;
      case 'onboardingDefer': progress = { ...progress, seenIntro: true }; advance(); break;
      case 'onboardingDiscard': progress = { ...progress, draft: undefined, selectionReady: false, commandState: undefined }; advance(); break;
      case 'onboardingEdit': progress = { ...progress, draft: { ...progress.draft!, step: 'apps', commandID: undefined, submitted: false }, commandState: undefined }; advance(); break;
      case 'onboardingPrepare':
        if (!progress.selectionReady) return { status: 'error', code: 'selection-required', impacts: [] };
        progress = { ...progress, draft: { ...progress.draft!, commandID, step: 'review' }, commandState: 'pending' }; advance();
        return { ...response(), status: 'confirmation-required', ref: commandID };
      case 'onboardingCommit': {
        const d = progress.draft!;
        if (failCommit) { progress = { ...progress, draft: { ...d, submitted: true }, commandState: 'failed' }; advance(); return { ...response(), status: 'error', code: 'schedule-failed', retryable: true }; }
        const minute = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
        snapshot = { ...snapshot, revision: '1', sequence: '2', observation: 'applied', validUntil: Date.now() / 1000 + 3600, schedulesReady: true,
          rules: [{ id: d.id, title: d.title.trim(), goal: d.goal, selectionRef, weekdays: d.weekdays, startMinute: minute(d.start), endMinute: minute(d.end), nextDay: d.nextDay, enabled: true }],
          nextPeriod: { ruleID, startsAt: Date.now() / 1000 + 7200, endsAt: Date.now() / 1000 + 10800 } };
        progress = { ...progress, completed: true, draft: undefined, selectionReady: false, commandState: undefined }; advance(); break;
      }
      case 'onboardingAdopt': progress = { ...progress, seenIntro: true, completed: true }; advance(); break;
    }
    return response();
  } };
  const control = { async run(action: ScreenTimeAction, _request?: ScreenTimeRequest): Promise<ScreenTimeResponse> {
    nativeActions.push(action);
    if (action === 'authorize') { snapshot = { ...snapshot, authorization: deny ? 'denied' : 'approved' }; if (deny) return { status: 'error', code: 'authorization-required', impacts: [], snapshot }; }
    if (action === 'initialize') snapshot = { ...snapshot, storage: 'ready' };
    if (action === 'pickApplications') {
      if (cancel) return { status: 'cancelled', impacts: [] };
      snapshot = { ...snapshot, selections: [{ ref: selectionRef, count: 2 }] };
      return { status: 'ok', ref: selectionRef, impacts: [], snapshot };
    }
    return { status: 'ok', impacts: [], snapshot };
  } };
  return { setup, control, nativeActions, setupActions, progress: () => structuredClone(progress), snapshot: () => structuredClone(snapshot),
    deny: (value = true) => { deny = value; }, cancelPicker: (value = true) => { cancel = value; }, failSave: () => { failSave = true; }, failCommit: (value = true) => { failCommit = value; },
    relaunch: () => { progress = { ...progress, selectionReady: false }; }, replace: (s: Partial<ScreenTimeSnapshot>) => { snapshot = { ...snapshot, ...s }; },
    restore: (p: OnboardingProgress, s: ScreenTimeSnapshot) => { progress = { ...p, selectionReady: false }; snapshot = s; },
  };
}
