import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { reflectionRecords, type ReflectionResponse } from '../../modules/itoma-native';
import { ReflectionReadError, type ReflectionSource } from '../../modules/itoma-native/src/reflection-model';
import type { ReflectionMemory } from '@/components/flow/reflection-content';
import { useScreenTime } from './screen-time';

type Client = Pick<typeof reflectionRecords, 'run'>;
type State = { source: ReflectionSource; memory: ReflectionMemory; remember: (value: ReflectionMemory) => void;
  refresh: () => void; mutate: (action: 'import' | 'deleteAll') => Promise<ReflectionResponse | undefined>; busy: boolean; response?: ReflectionResponse };
const Context = createContext<State | undefined>(undefined);
const emptyMemory: ReflectionMemory = { request: { period: 'week', day: '' }, positions: { week: { period: 'week', day: '' }, month: { period: 'month', day: '' } } };

/** Retains queries only, never a full ledger or reason. One lifetime AppState subscription. */
export function ReflectionProvider({ children, client = reflectionRecords }: { children: ReactNode; client?: Client }) {
  const { historyEpoch, invalidateHistory } = useScreenTime();
  const [memory, remember] = useState<ReflectionMemory>(emptyMemory);
  const [epoch, setEpoch] = useState(0), [busy, setBusy] = useState(false);
  const [ownedResponse, setResponse] = useState<{ client: Client; value: ReflectionResponse }>();
  const writing = useRef(false), sequence = useRef(0);
  const refresh = useCallback(() => setEpoch(n => n + 1), []);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { sequence.current += 1; if (state === 'active') refresh(); });
    return () => listener.remove();
  }, [refresh]);
  const source = useMemo<ReflectionSource>(() => ({
    identity: String(epoch) + ':' + String(historyEpoch),
    async read(request) {
      if (writing.current) throw new ReflectionReadError('busy');
      const ticket = sequence.current;
      const result = await client.run('read', request);
      if (ticket !== sequence.current || writing.current) throw new ReflectionReadError('changed');
      if (result.status === 'error') throw new ReflectionReadError(result.code ?? 'unavailable');
      if (result.storage === 'not-created') throw new ReflectionReadError('not-created');
      if (!result.snapshot) throw new ReflectionReadError('unavailable');
      return JSON.stringify({ ...result.snapshot, transfer: result.transfer, sharedIncomplete: result.sharedIncomplete });
    },
  // A new source identity hides every old snapshot synchronously on deletion/foreground refresh.
  }), [client, epoch, historyEpoch]);
  const mutate = useCallback((action: 'import' | 'deleteAll') => {
    if (writing.current) return Promise.resolve(undefined);
    writing.current = true; sequence.current += 1; setBusy(true); setResponse(undefined); invalidateHistory('reflection');
    return Promise.resolve().then(() => client.run(action, {})).then(result => { setResponse({ client, value: result }); return result; }).catch(() => {
      const result: ReflectionResponse = { status: 'error', code: 'unavailable', storage: 'unknown', transfer: 'unavailable' };
      setResponse({ client, value: result }); return result;
    }).finally(() => {
      writing.current = false; sequence.current += 1; setBusy(false); invalidateHistory('reflection'); refresh();
    });
  }, [client, invalidateHistory, refresh]);
  return <Context.Provider value={{ source, memory, remember, refresh, mutate, busy, response: ownedResponse?.client === client ? ownedResponse.value : undefined }}>{children}</Context.Provider>;
}
export function useReflection() { const value = useContext(Context); if (!value) throw new Error('ReflectionProvider missing'); return value; }
