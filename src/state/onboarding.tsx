import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { onboardingRecords, type OnboardingAction, type OnboardingDraft, type OnboardingProgress, type OnboardingResponse, type ScreenTimeCode } from '../../modules/itoma-native';

type Client = Pick<typeof onboardingRecords, 'run'>;
type State = {
  progress?: OnboardingProgress; draft?: OnboardingDraft; loading: boolean; saving: boolean; busy: boolean; dirty: boolean; error?: ScreenTimeCode;
  update: (patch: Partial<OnboardingDraft>) => void; flush: () => Promise<boolean>; refresh: () => Promise<OnboardingResponse>;
  run: (action: Exclude<OnboardingAction, 'onboardingRead' | 'onboardingSave'>) => Promise<OnboardingResponse>;
};
const Context = createContext<State | undefined>(undefined);
/** A single coalescing writer lives above routes. No subscriptions/timers accumulate per step.
 * Step/defer/submit await persistence; a force-kill before a save acknowledgement can lose only
 * those last unsaved keystrokes. A failed save keeps local input and blocks forward navigation.
 */
export function OnboardingProvider({ children, client = onboardingRecords }: { children: ReactNode; client?: Client }) {
  const [progress, setProgress] = useState<OnboardingProgress>(), current = useRef<OnboardingProgress | undefined>(undefined);
  const [draft, setDraft] = useState<OnboardingDraft>(), local = useRef<OnboardingDraft | undefined>(undefined);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false), pending = useRef(false), version = useRef(0), mutation = useRef(false);
  const [error, setError] = useState<ScreenTimeCode>();
  const writer = useRef<Promise<boolean> | undefined>(undefined), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reading = useRef<Promise<OnboardingResponse> | undefined>(undefined);
  const accept = useCallback((p: OnboardingProgress, keepLocal = false) => {
    current.current = p; setProgress(p);
    if (!keepLocal || p.completed) { local.current = p.draft; setDraft(p.draft); pending.current = false; setDirty(false); }
  }, []);
  const flush = useCallback((): Promise<boolean> => {
    clearTimeout(timer.current);
    if (writer.current) return writer.current;
    if (!pending.current) return Promise.resolve(true);
    const operation = Promise.resolve().then(async () => {
      setSaving(true);
      try {
        while (pending.current) {
          const p = current.current, d = local.current, captured = version.current;
          if (!p || !d || d.commandID) return false;
          // Explicit projection excludes command/completion fields from editable input.
          const { id, step, title, goal, weekdays, start, end, nextDay, selectionRef, returnToReview } = d;
          const result = await client.run('onboardingSave', { expectedRevision: p.revision, draft: { id, step, title, goal, weekdays, start, end, nextDay, selectionRef, returnToReview } });
          if (result.status !== 'ok' || !result.onboarding) { setError(result.code ?? 'storage-failed'); return false; }
          const changed = version.current !== captured;
          accept(result.onboarding, changed);
          if (!changed) pending.current = false;
          setError(undefined);
        }
        return true;
      } finally { setSaving(false); writer.current = undefined; }
    });
    writer.current = operation;
    return operation;
  }, [accept, client]);
  const update = useCallback((patch: Partial<OnboardingDraft>) => {
    if (!local.current || local.current.commandID || mutation.current) return;
    local.current = { ...local.current, ...patch }; setDraft(local.current); pending.current = true; version.current += 1; setDirty(true);
    clearTimeout(timer.current); timer.current = setTimeout(() => { void flush(); }, 250);
  }, [flush]);
  const refresh = useCallback(async (): Promise<OnboardingResponse> => {
    if (reading.current) return reading.current;
    if (mutation.current) return { status: 'error', code: 'busy', impacts: [] };
    const operation = (async () => {
      if (pending.current) await flush();
      const result = await client.run('onboardingRead');
      if (result.onboarding && (!current.current || BigInt(result.onboarding.revision) >= BigInt(current.current.revision))) {
        const compatible = pending.current && result.onboarding.draft?.id === local.current?.id && !result.onboarding.draft?.commandID;
        accept(result.onboarding, compatible);
      }
      setError(result.status === 'error' ? result.code ?? 'storage-failed' : undefined); setLoading(false);
      return result;
    })();
    reading.current = operation;
    try { return await operation; } finally { reading.current = undefined; }
  }, [accept, client, flush]);
  const run = useCallback(async (action: Exclude<OnboardingAction, 'onboardingRead' | 'onboardingSave'>): Promise<OnboardingResponse> => {
    if (mutation.current || reading.current) return { status: 'error', code: 'busy', impacts: [] };
    mutation.current = true; setBusy(true);
    try {
      if (action === 'onboardingDiscard') { clearTimeout(timer.current); if (writer.current) await writer.current; }
      else if (!(await flush())) return { status: 'error', code: 'storage-failed', impacts: [] };
      if (!current.current) return { status: 'error', code: 'storage-failed', impacts: [] };
      const result = await client.run(action, { expectedRevision: current.current.revision });
      if (result.onboarding) accept(result.onboarding);
      setError(result.status === 'error' ? result.code ?? 'unavailable' : undefined);
      return result;
    } finally { mutation.current = false; setBusy(false); }
  }, [accept, client, flush]);
  useEffect(() => {
    queueMicrotask(() => { void refresh(); });
    const listener = AppState.addEventListener('change', value => { if (value === 'active') void refresh(); else void flush(); });
    return () => { listener.remove(); clearTimeout(timer.current); };
  }, [refresh, flush]);
  return <Context.Provider value={{ progress, draft, loading, saving, busy, dirty, error, update, flush, refresh, run }}>{children}</Context.Provider>;
}
export function useOnboarding() { const value = useContext(Context); if (!value) throw new Error('OnboardingProvider missing'); return value; }
export function useOptionalOnboarding() { return useContext(Context); }
