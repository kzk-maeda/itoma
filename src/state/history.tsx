import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { historyRecords, type HistoryAction, type HistoryCode, type HistoryCursor, type HistoryKind, type HistoryPage, type HistoryReason, type HistoryRow, type HistoryResponse } from '../../modules/itoma-native';
import { useScreenTime } from './screen-time';

type Query = { kind: HistoryKind; day: string };
type ReflectionReference = { revision: string; asOf: number; timeZone: string };
type State = { kind: HistoryKind; day: string; page?: HistoryPage; pages: HistoryPage[]; rows: HistoryRow[]; viewGeneration: number; restart: () => void; next?: HistoryCursor; loadingOlder: boolean; olderError?: HistoryCode; loadOlder: (retry?: boolean) => Promise<void>; pauseOlder: () => void; ensureLoaded: () => void; reason?: HistoryReason; selectedCommandID?: string; selectedRow?: HistoryRow; openRecord: (row: HistoryRow) => void; storage: HistoryResponse['storage']; busy: boolean; error?: HistoryCode;
  choose: (kind: HistoryKind, day: string) => void; refresh: () => void; move: (cursor: HistoryCursor, direction: 'older' | 'newer') => void;
  reference?: ReflectionReference; chooseReflectionDay: (day: string, reference: ReflectionReference) => void;
  readReason: (commandID: string) => void; closeReason: () => void; mutate: (action: 'import' | 'deleteReasons' | 'deleteHistory') => Promise<HistoryResponse | undefined> };
const Context = createContext<State | undefined>(undefined);
type Client = Pick<typeof historyRecords, 'run'>;

/** Bounded API pages, lazy metadata continuation, and one explicitly selected reason. */
export function HistoryProvider({ children, client = historyRecords }: { children: ReactNode; client?: Client }) {
  const { historyEpoch, historyChangeOrigin, invalidateHistory } = useScreenTime();
  const query = useRef<Query>({ kind: 'event', day: '' }), sequence = useRef(0), mutation = useRef(false), pendingRefresh = useRef(false), pageRef = useRef<HistoryPage | undefined>(undefined);
  const position = useRef<{ cursor: HistoryCursor; direction: 'older' | 'newer' } | undefined>(undefined);
  const identity = useRef({ historyEpoch, client });
  const reload = useRef<() => void>(() => {});
  const loaded = useRef(false);
  const tails = useRef<HistoryPage[]>([]), olderGeneration = useRef(0), olderPending = useRef(false), reading = useRef(false), continuationError = useRef<HistoryCode | undefined>(undefined);
  const [tailPages, setTailPages] = useState<HistoryPage[]>([]), [loadingOlder, setLoadingOlder] = useState(false), [olderError, setOlderError] = useState<HistoryCode>();
  const [viewGeneration, setViewGeneration] = useState(0);
  const pauseOlder = useCallback(() => { olderGeneration.current++; olderPending.current = false; setLoadingOlder(false); }, []);
  const resetTail = useCallback(() => { pauseOlder(); tails.current = []; setTailPages([]); continuationError.current = undefined; setOlderError(undefined); }, [pauseOlder]);
  const [reference, setReference] = useState<ReflectionReference>();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [seenEpoch, setSeenEpoch] = useState(historyEpoch), [selectedCommandID, setSelectedCommandID] = useState<string>();
  const [selection, setSelection] = useState<Query>({ kind: 'event', day: '' }), [page, setPage] = useState<HistoryPage>(), [reason, setReason] = useState<HistoryReason>();
  const [storage, setStorage] = useState<HistoryResponse['storage']>('unknown'), [busy, setBusy] = useState(false), [error, setError] = useState<HistoryCode>();
  const clear = useCallback(() => { sequence.current += 1; reading.current = false; pageRef.current = undefined; resetTail(); setPage(undefined); setReason(undefined); setSelectedKey(undefined); setSelectedCommandID(undefined); setBusy(false); }, [resetTail]);
  useEffect(() => {
    if (identity.current.historyEpoch === historyEpoch && identity.current.client === client) return;
    if (historyChangeOrigin === 'history' && identity.current.client === client) {
      identity.current = { historyEpoch, client };
      queueMicrotask(() => setSeenEpoch(historyEpoch));
      return; // The local mutation already owns its response and invalidates older tickets.
    }
    identity.current = { historyEpoch, client }; const barrier = ++sequence.current; olderGeneration.current++; olderPending.current = false; reading.current = false; pageRef.current = undefined; tails.current = []; position.current = undefined;
    queueMicrotask(() => {
      if (identity.current.historyEpoch !== historyEpoch || identity.current.client !== client) return;
      setSeenEpoch(historyEpoch);
      if (sequence.current === barrier) { resetTail(); setPage(undefined); setReason(undefined); setSelectedKey(undefined); setSelectedCommandID(undefined); setBusy(mutation.current); }
      if (loaded.current) reload.current();
    });
  }, [historyEpoch, historyChangeOrigin, client, resetTail]);
  const run = useCallback(async (action: HistoryAction, extra: { cursor?: HistoryCursor; direction?: 'older' | 'newer'; commandID?: string } = {}): Promise<HistoryResponse | undefined> => {
    if (mutation.current) { if (action === 'page') pendingRefresh.current = true; return; }
    const writes = action === 'deleteHistory' || action === 'deleteReasons' || action === 'import';
    if (writes) { mutation.current = true; invalidateHistory('history'); }
    loaded.current = true;
    const ticket = ++sequence.current, selected = query.current;
    reading.current = true;
    if (action !== 'reason') { resetTail(); setViewGeneration(value => value + 1); } else pauseOlder();
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
        if (response.code === 'changed') { position.current = undefined; pageRef.current = undefined; resetTail(); setPage(undefined); setSelectedKey(undefined); setSelectedCommandID(undefined); }
      } else if (response.page) { pageRef.current = response.page; setPage(response.page); }
      else if (response.reason) setReason(response.reason);
      else { pageRef.current = undefined; setPage(undefined); }
      return response;
    } catch { if (ticket === sequence.current) setError('unavailable'); }
    finally {
      if (writes) { mutation.current = false; invalidateHistory('history'); if (pendingRefresh.current) { pendingRefresh.current = false; queueMicrotask(() => { reload.current(); }); } }
      if (ticket === sequence.current) { reading.current = false; setBusy(false); }
    }
  }, [client, invalidateHistory, pauseOlder, resetTail]);
  const refresh = useCallback(() => { void run('page', position.current); }, [run]);
  const ensureLoaded = useCallback(() => { if (!pageRef.current && !reading.current) refresh(); }, [refresh]);
  useEffect(() => { reload.current = refresh; }, [refresh]);
  useEffect(() => { const subscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active') { sequence.current += 1; reading.current = false; pauseOlder(); setReason(undefined); setBusy(false); }
    else refresh();
  }); return () => subscription.remove(); }, [refresh, pauseOlder]);
  const loadOlder = useCallback(async (retry = false) => {
    const head = pageRef.current, last = tails.current.at(-1) ?? head, cursor = last?.next;
    if (!head || !cursor || reading.current || mutation.current || olderPending.current || (continuationError.current && !retry)) return;
    olderPending.current = true; setLoadingOlder(true); continuationError.current = undefined; setOlderError(undefined);
    const generation = ++olderGeneration.current, ticket = sequence.current, selected = query.current;
    const fail = (code: HistoryCode) => { continuationError.current = code; setOlderError(code); };
    try {
      const response = await client.run('page', { ...selected, day: selected.day || undefined, afterAt: cursor.at, afterKey: cursor.key, direction: 'older', revision: head.revision, timeZone: head.timeZone });
      if (generation !== olderGeneration.current || ticket !== sequence.current || pageRef.current !== head) return;
      const next = response.page;
      if (response.code === 'changed' || (next && (next.revision !== head.revision || next.timeZone !== head.timeZone))) { clear(); setError('changed'); return; }
      if (response.status !== 'ok' || !next || response.storage !== 'ready') { fail(response.code ?? 'unavailable'); return; }
      const consumed = [head, ...tails.current].some(p => p.next?.key === next.next?.key && p.next?.at === next.next?.at && !!next.next);
      if (consumed || (!next.rows.length && next.next)) { fail('unavailable'); return; }
      tails.current = [...tails.current, next]; setTailPages(tails.current);
    } catch { if (generation === olderGeneration.current && ticket === sequence.current) fail('unavailable'); }
    finally { if (generation === olderGeneration.current) { olderPending.current = false; setLoadingOlder(false); } }
  }, [client, clear]);
  const pages = seenEpoch === historyEpoch && page ? [page, ...tailPages] : [];
  const rows = [...new Map(pages.flatMap(p => p.rows).map(row => [row.key, row])).values()];
  return <Context.Provider value={{ ...selection, reference, page: pages[0], pages, rows, viewGeneration, restart: () => { position.current = undefined; void run('page'); }, next: pages.at(-1)?.next, loadingOlder, olderError, loadOlder, pauseOlder, ensureLoaded, reason: seenEpoch === historyEpoch ? reason : undefined, selectedCommandID, selectedRow: rows.find(row => row.key === selectedKey), storage, busy, error, refresh,
    openRecord: row => {
      const owned = [pageRef.current, ...tails.current].flatMap(p => p?.rows ?? []).find(item => item.key === row.key);
      if (!owned) return;
      sequence.current += 1; reading.current = false; pauseOlder(); setSelectedKey(owned.key); setReason(undefined); setSelectedCommandID(undefined); setBusy(false);
      if (owned.commandID && !owned.reasonDeleted && ['reason', 'requestTemporaryGrant', 'retryCommand'].includes(owned.action)) { setSelectedCommandID(owned.commandID); void run('reason', { commandID: owned.commandID }); }
    },
    choose: (kind, day) => { setReference(undefined); query.current = { kind, day }; setSelection(query.current); position.current = undefined; clear(); void run('page'); },
    chooseReflectionDay: (day, value) => { setReference(value); query.current = { kind: 'event', day }; setSelection(query.current); position.current = undefined; clear(); void run('page'); },
    move: (cursor, direction) => { position.current = { cursor, direction }; void run('page', position.current); },
    readReason: (commandID) => { setSelectedCommandID(commandID); void run('reason', { commandID }); }, closeReason: () => { sequence.current += 1; reading.current = false; setSelectedCommandID(undefined); setSelectedKey(undefined); setReason(undefined); setBusy(false); },
    mutate: (action) => { position.current = undefined; return run(action); },
  }}>{children}</Context.Provider>;
}
export function useHistoryRecords() { const value = useContext(Context); if (!value) throw new Error('HistoryProvider missing'); return value; }
