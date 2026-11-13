import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { historyRecords, type HistoryAction, type HistoryCode, type HistoryCursor, type HistoryKind, type HistoryPage, type HistoryReason, type HistoryResponse } from '../../modules/itoma-native';
import { useScreenTime } from './screen-time';

type Query = { kind: HistoryKind; day: string };
type ReflectionReference = { revision: string; asOf: number; timeZone: string };
type State = { kind: HistoryKind; day: string; page?: HistoryPage; reason?: HistoryReason; selectedCommandID?: string; storage: HistoryResponse['storage']; busy: boolean; error?: HistoryCode;
  choose: (kind: HistoryKind, day: string) => void; refresh: () => void; move: (cursor: HistoryCursor, direction: 'older' | 'newer') => void;
  reference?: ReflectionReference; chooseReflectionDay: (day: string, reference: ReflectionReference) => void;
  readReason: (commandID: string) => void; closeReason: () => void; mutate: (action: 'import' | 'deleteReasons' | 'deleteHistory') => Promise<HistoryResponse | undefined> };
const Context = createContext<State | undefined>(undefined);
type Client = Pick<typeof historyRecords, 'run'>;

/** One bounded page plus one explicitly selected reason; no full-history cache or timer. */
export function HistoryProvider({ children, client = historyRecords }: { children: ReactNode; client?: Client }) {
  const { historyEpoch, historyChangeOrigin, invalidateHistory } = useScreenTime();
  const query = useRef<Query>({ kind: 'event', day: '' }), sequence = useRef(0), mutation = useRef(false), pendingRefresh = useRef(false), pageRef = useRef<HistoryPage | undefined>(undefined);
  const position = useRef<{ cursor: HistoryCursor; direction: 'older' | 'newer' } | undefined>(undefined);
  const identity = useRef({ historyEpoch, client });
  const reload = useRef<() => void>(() => {});
  const loaded = useRef(false);
  const [reference, setReference] = useState<ReflectionReference>();
  const [seenEpoch, setSeenEpoch] = useState(historyEpoch), [selectedCommandID, setSelectedCommandID] = useState<string>();
  const [selection, setSelection] = useState<Query>({ kind: 'event', day: '' }), [page, setPage] = useState<HistoryPage>(), [reason, setReason] = useState<HistoryReason>();
  const [storage, setStorage] = useState<HistoryResponse['storage']>('unknown'), [busy, setBusy] = useState(false), [error, setError] = useState<HistoryCode>();
  const clear = useCallback(() => { sequence.current += 1; pageRef.current = undefined; setPage(undefined); setReason(undefined); setBusy(false); }, []);
  useEffect(() => {
    if (identity.current.historyEpoch === historyEpoch && identity.current.client === client) return;
    if (historyChangeOrigin === 'history' && identity.current.client === client) {
      identity.current = { historyEpoch, client };
      queueMicrotask(() => setSeenEpoch(historyEpoch));
      return; // The local mutation already owns its response and invalidates older tickets.
    }
    identity.current = { historyEpoch, client }; const barrier = ++sequence.current; pageRef.current = undefined; position.current = undefined;
    queueMicrotask(() => {
      if (identity.current.historyEpoch !== historyEpoch || identity.current.client !== client) return;
      setSeenEpoch(historyEpoch);
      if (sequence.current === barrier) { setPage(undefined); setReason(undefined); setBusy(mutation.current); }
      if (loaded.current) reload.current();
    });
  }, [historyEpoch, historyChangeOrigin, client]);
  const run = useCallback(async (action: HistoryAction, extra: { cursor?: HistoryCursor; direction?: 'older' | 'newer'; commandID?: string } = {}): Promise<HistoryResponse | undefined> => {
    if (mutation.current) { if (action === 'page') pendingRefresh.current = true; return; }
    const writes = action === 'deleteHistory' || action === 'deleteReasons' || action === 'import';
    if (writes) { mutation.current = true; invalidateHistory('history'); }
    loaded.current = true;
    const ticket = ++sequence.current, selected = query.current;
    setBusy(true); setError(undefined); setReason(undefined);
    if (action === 'deleteHistory' || action === 'deleteReasons') { pageRef.current = undefined; setPage(undefined); }
    try {
      const response = await client.run(action, { ...selected, day: selected.day || undefined,
        ...(extra.cursor ? { afterAt: extra.cursor.at, afterKey: extra.cursor.key, direction: extra.direction, revision: pageRef.current?.revision, timeZone: pageRef.current?.timeZone } : {}),
        ...(extra.commandID ? { commandID: extra.commandID, revision: pageRef.current?.revision, timeZone: pageRef.current?.timeZone } : {}) });
      if (ticket !== sequence.current) return;
      setStorage(response.storage);
      if (response.status === 'error') {
        setError(response.code ?? 'unavailable');
        if (response.code === 'changed') { position.current = undefined; pageRef.current = undefined; setPage(undefined); }
      } else if (response.page) { pageRef.current = response.page; setPage(response.page); }
      else if (response.reason) setReason(response.reason);
      else { pageRef.current = undefined; setPage(undefined); }
      return response;
    } catch { if (ticket === sequence.current) setError('unavailable'); }
    finally {
      if (writes) { mutation.current = false; invalidateHistory('history'); if (pendingRefresh.current) { pendingRefresh.current = false; queueMicrotask(() => { reload.current(); }); } }
      if (ticket === sequence.current) setBusy(false);
    }
  }, [client, invalidateHistory]);
  const refresh = useCallback(() => { void run('page', position.current); }, [run]);
  useEffect(() => { reload.current = refresh; }, [refresh]);
  useEffect(() => { const subscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active') { sequence.current += 1; setReason(undefined); setBusy(false); }
    else refresh();
  }); return () => subscription.remove(); }, [refresh]);
  return <Context.Provider value={{ ...selection, reference, page: seenEpoch === historyEpoch ? page : undefined, reason: seenEpoch === historyEpoch ? reason : undefined, selectedCommandID, storage, busy, error, refresh,
    choose: (kind, day) => { setReference(undefined); query.current = { kind, day }; setSelection(query.current); position.current = undefined; clear(); void run('page'); },
    chooseReflectionDay: (day, value) => { setReference(value); query.current = { kind: 'event', day }; setSelection(query.current); position.current = undefined; clear(); void run('page'); },
    move: (cursor, direction) => { position.current = { cursor, direction }; void run('page', position.current); },
    readReason: (commandID) => { setSelectedCommandID(commandID); void run('reason', { commandID }); }, closeReason: () => { sequence.current += 1; setSelectedCommandID(undefined); setReason(undefined); setBusy(false); },
    mutate: (action) => { position.current = undefined; return run(action); },
  }}>{children}</Context.Provider>;
}
export function useHistoryRecords() { const value = useContext(Context); if (!value) throw new Error('HistoryProvider missing'); return value; }
