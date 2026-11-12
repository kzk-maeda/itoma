import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { controlSnapshots, retainControlSnapshotLifecycle, withControlSnapshots } from './control-snapshot';
import { timeRange } from '@/lib/schedule-time';

import { screenTime, type RuleInput, type ScreenTimeAction, type ScreenTimeCode, type ScreenTimeRequest, type ScreenTimeResponse, type ScreenTimeRule, type ScreenTimeSnapshot } from '../../modules/itoma-native';

export type RuleDraft = { id?: string; selectionRef: string; weekdays: number[]; start: string; end: string; nextDay: boolean; enabled: boolean; dirty: boolean; remove?: boolean };
export type UnlockDraft = { targetRef?: string; reason: string; minutes: string };
type Client = Pick<typeof screenTime, 'run'>;
type HistoryChangeOrigin = 'history' | 'reflection' | 'settings' | 'external';
type State = {
  snapshot?: ScreenTimeSnapshot; error?: ScreenTimeCode; loading: boolean; busy?: ScreenTimeAction; legacyActive: boolean; refreshKey: number; historyEpoch: number;
  historyChangeOrigin: HistoryChangeOrigin;
  run: Client['run']; refresh: () => Promise<ScreenTimeResponse>; clearError: () => void; invalidateHistory: (origin?: HistoryChangeOrigin) => void;
  ruleDraft?: RuleDraft; setRuleDraft: (draft: RuleDraft | undefined) => void; beginRule: (rule?: ScreenTimeRule) => void;
  rulePreviewRef?: string; setRulePreviewRef: (ref: string | undefined) => void;
  ruleReview?: ScreenTimeResponse; setRuleReview: (review: ScreenTimeResponse | undefined) => void;
  unlockDraft: UnlockDraft; setUnlockDraft: (draft: UnlockDraft) => void;
  unlockReview?: ScreenTimeResponse; setUnlockReview: (review: ScreenTimeResponse | undefined) => void;
  resetUnlock: () => void;
  canExitRule: () => boolean; canExitUnlock: () => boolean;
  setRuleExitAllowed: (value: boolean) => void; setUnlockExitAllowed: (value: boolean) => void;
  ruleExitAllowed: boolean; unlockExitAllowed: boolean;
};
const Context = createContext<State | undefined>(undefined);
const time = (minute: number) => `${Math.floor(minute / 60).toString().padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;
// Application labels depend on saved identities/authorization, not countdowns or OS observation times.
const labelIdentity = (s: ScreenTimeSnapshot) => JSON.stringify([s.availability, s.storage, s.authorization, s.needsSelectionReview,
  s.selections.map(value => `${value.ref}:${value.count}`).sort(), s.targets.map(value => `${value.ref}:${value.selectionRef}`).sort()]);

/** View drafts live only in RAM; accepted commands live in native storage, beyond view lifetime. */
export function ScreenTimeProvider({ children, client = screenTime }: { children: ReactNode; client?: Client }) {
  const orderedClient = withControlSnapshots(client);
  const [snapshot, setSnapshot] = useState<ScreenTimeSnapshot | undefined>(controlSnapshots.getSnapshot);
  const latest = useRef<ScreenTimeSnapshot | undefined>(snapshot);
  const [error, setError] = useState<ScreenTimeCode>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ScreenTimeAction>();
  const [legacyActive, setLegacyActive] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [historyChange, setHistoryChange] = useState<{ epoch: number; origin: HistoryChangeOrigin }>({ epoch: 0, origin: 'external' });
  const { epoch: historyEpoch, origin: historyChangeOrigin } = historyChange;
  const invalidateHistory = useCallback((origin: HistoryChangeOrigin = 'external') => setHistoryChange(value => ({ epoch: value.epoch + 1, origin })), []);
  const mutation = useRef(false);
  const read = useRef<{ epoch: number; promise: Promise<ScreenTimeResponse> } | undefined>(undefined);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft>();
  // Preview ownership survives draft edits/review invalidation until explicit cancellation.
  const [rulePreviewRef, setRulePreviewRef] = useState<string>();
  const [ruleReview, setRuleReview] = useState<ScreenTimeResponse>();
  const [unlockDraft, setUnlockDraft] = useState<UnlockDraft>({ reason: '', minutes: '5' });
  const [unlockReview, setUnlockReview] = useState<ScreenTimeResponse>();
  const ruleExitRef = useRef(false), unlockExitRef = useRef(false);
  const [ruleExitAllowed, setRuleExit] = useState(false), [unlockExitAllowed, setUnlockExit] = useState(false);
  const setRuleExitAllowed = useCallback((value: boolean) => { ruleExitRef.current = value; setRuleExit(value); }, []);
  const setUnlockExitAllowed = useCallback((value: boolean) => { unlockExitRef.current = value; setUnlockExit(value); }, []);
  const run = useCallback(async (action: ScreenTimeAction, request: ScreenTimeRequest = {}) => {
    if (action === 'snapshot' && read.current?.epoch === controlSnapshots.getEpoch()) return read.current.promise;
    if (action !== 'snapshot' && mutation.current) return { status: 'error', code: 'busy', impacts: [] } as ScreenTimeResponse;
    if (action !== 'snapshot') { mutation.current = true; setBusy(action); setError(undefined); }
    let operation!: Promise<ScreenTimeResponse>;
    operation = (async () => {
      try {
        const result = await orderedClient.run(action, request);
        if (action === 'deleteReasons' && result.status === 'ok') invalidateHistory('settings');
        if (result.status === 'ok' && (action === 'authorize' || action === 'pickApplications' || action === 'reconcile')) setRefreshKey(value => value + 1);
        if (result.legacyActive !== undefined) setLegacyActive(result.legacyActive);
        if (result.status === 'error' && !(result.snapshot && result.snapshot.availability !== 'device')) setError(result.code ?? 'unavailable');
        else if (result.status !== 'cancelled') setError(undefined);
        return result;
      } finally {
        setLoading(false);
        if (action !== 'snapshot') { mutation.current = false; setBusy(undefined); }
        else if (read.current?.promise === operation) read.current = undefined;
      }
    })();
    if (action === 'snapshot') read.current = { epoch: controlSnapshots.getEpoch(), promise: operation };
    return operation;
  }, [orderedClient, invalidateHistory]);
  const refresh = useCallback(() => run('snapshot'), [run]);
  useEffect(() => {
    const accept = () => {
      const chosen = controlSnapshots.getSnapshot(), previous = latest.current;
      if (!chosen) return;
      // Even identical visible fields can carry a newer availability generation.
      latest.current = chosen;
      setSnapshot(chosen);
      if (!previous || labelIdentity(previous) !== labelIdentity(chosen)) setRefreshKey(value => value + 1);
    };
    const unsubscribe = controlSnapshots.subscribe(accept);
    accept();
    return unsubscribe;
  }, []);
  useEffect(() => {
    const release = retainControlSnapshotLifecycle(() => { void refresh(); });
    queueMicrotask(() => { void refresh(); });
    return release;
  }, [refresh]);
  const beginRule = useCallback((rule?: ScreenTimeRule) => {
    setRuleExitAllowed(false);
    setRuleReview(undefined); setRulePreviewRef(undefined); setError(undefined);
    setRuleDraft(rule ? { ...rule, start: time(rule.startMinute), end: time(rule.endMinute), dirty: false }
      : { selectionRef: '', weekdays: [1, 2, 3, 4, 5], start: '21:00', end: '23:00', nextDay: false, enabled: true, dirty: false });
  }, [setRuleExitAllowed]);
  return <Context.Provider value={{ snapshot, error, loading, busy, legacyActive, refreshKey, historyEpoch, historyChangeOrigin, invalidateHistory, run, refresh, clearError: () => setError(undefined),
    ruleDraft, setRuleDraft, beginRule, rulePreviewRef, setRulePreviewRef, ruleReview, setRuleReview, unlockDraft, setUnlockDraft, unlockReview, setUnlockReview,
    ruleExitAllowed, unlockExitAllowed, canExitRule: () => ruleExitRef.current, canExitUnlock: () => unlockExitRef.current,
    setRuleExitAllowed, setUnlockExitAllowed,
    resetUnlock: () => { setUnlockExitAllowed(false); setUnlockDraft({ reason: '', minutes: String(latest.current?.defaultMinutes ?? 5) }); setUnlockReview(undefined); setError(undefined); } }}>{children}</Context.Provider>;
}

export function useScreenTime() { const value = useContext(Context); if (!value) throw new Error('ScreenTimeProvider missing'); return value; }
export function ruleInput(draft: RuleDraft, revision: string): RuleInput | undefined {
  const range = timeRange(draft.start, draft.end);
  if (!draft.selectionRef || !draft.weekdays.length || !range) return undefined;
  return { id: draft.id, selectionRef: draft.selectionRef, weekdays: draft.weekdays, startMinute: range.startMinute, endMinute: range.endMinute, nextDay: range.nextDay, enabled: draft.enabled, expectedRevision: revision, remove: draft.remove };
}
