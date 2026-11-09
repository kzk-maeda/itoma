export type HistoryAction = 'page' | 'reason' | 'import' | 'deleteReasons' | 'deleteHistory';
export type HistoryKind = 'event' | 'reason';
export type HistoryCode = 'unavailable' | 'storage-failed' | 'changed' | 'invalid-input' | 'capacity-full' | 'busy';
export type HistoryCursor = { at: number; key: string };
export type HistoryRow = { key: string; at: number; action: 'reason' | 'cancelled' | 'commitPolicy' | 'requestTemporaryGrant' | 'retryCommand' | 'resumeAfterAuthorization' | 'stop'; status: 'prepared' | 'pending' | 'scheduling' | 'applying' | 'succeeded' | 'failed' | 'uncertain' | 'superseded' | 'expired' | 'cancelled'; commandID?: string; grantStatus?: string; expiresAt?: number; reasonDeleted?: boolean };
export type HistoryPage = { revision: string; asOf: number; timeZone: string; rows: HistoryRow[]; next?: HistoryCursor; previous?: HistoryCursor;
  logicalBytes: string; warningBytes: string; maximumBytes: string; warningReached: boolean; limitReached: boolean;
  databaseBytes?: string; walBytes?: string; sharedMemoryBytes?: string; incomplete: boolean; transfer: 'current' | 'pending' | 'unavailable' };
export type HistoryReason = { revision: string; state: 'deleted' | 'missing' | 'prepared-only' | 'shared-accepted' | 'unavailable'; body?: string };
export type HistoryResponse = { status: 'ok' | 'error'; code?: HistoryCode; storage: 'ready' | 'not-created' | 'unknown'; page?: HistoryPage; reason?: HistoryReason };
export type HistoryRequest = { kind?: HistoryKind; day?: string; afterAt?: number; afterKey?: string; direction?: 'older' | 'newer'; revision?: string; commandID?: string };
interface NativePort { readonly apiVersion?: number; readonly historyVersion?: number; history?: (action: string, payload: string) => Promise<string> }
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; };
const text = (value: unknown): string => { if (typeof value !== 'string') throw new Error(); return value; };
const number = (value: unknown): number => { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(); return value; };
const bool = (value: unknown): boolean => { if (typeof value !== 'boolean') throw new Error(); return value; };
const counter = (value: unknown): string => { const s = text(value); if (!/^(0|[1-9][0-9]*)$/.test(s)) throw new Error(); return s; };
const uuid = (value: unknown): string => { const s = text(value); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) throw new Error(); return s.toLowerCase(); };
const optional = <T>(value: unknown, parse: (v: unknown) => T): T | undefined => value == null ? undefined : parse(value);
const choice = <T extends string>(value: unknown, values: readonly T[]): T => { if (!values.includes(value as T)) throw new Error(); return value as T; };
const cursor = (value: unknown): HistoryCursor => { const v = object(value); return { key: uuid(v.key), at: number(v.at) }; };
const statuses = ['prepared', 'pending', 'scheduling', 'applying', 'succeeded', 'failed', 'uncertain', 'superseded', 'expired', 'cancelled'] as const;
const grants = ['pending', 'scheduling', 'applying', 'active', 'expired', 'invalidated', 'reblockPending', 'reconciled', 'uncertain', 'failed'] as const;
function page(value: unknown): HistoryPage {
  const p = object(value);
  if (!Array.isArray(p.rows) || p.rows.length > 40) throw new Error();
  return { revision: counter(p.revision), asOf: number(p.asOf), timeZone: text(p.timeZone),
    rows: p.rows.map((value) => { const r = object(value); return { key: uuid(r.key), at: number(r.at),
      action: choice(r.action, ['reason', 'cancelled', 'commitPolicy', 'requestTemporaryGrant', 'retryCommand', 'resumeAfterAuthorization', 'stop']),
      status: choice(r.status, statuses), commandID: optional(r.commandID, uuid), grantStatus: optional(r.grantStatus, (v) => choice(v, grants)), expiresAt: optional(r.expiresAt, number), reasonDeleted: optional(r.reasonDeleted, bool) }; }),
    next: optional(p.next, cursor), previous: optional(p.previous, cursor), logicalBytes: counter(p.logicalBytes), warningBytes: counter(p.warningBytes), maximumBytes: counter(p.maximumBytes),
    warningReached: bool(p.warningReached), limitReached: bool(p.limitReached), databaseBytes: optional(p.databaseBytes, counter), walBytes: optional(p.walBytes, counter), sharedMemoryBytes: optional(p.sharedMemoryBytes, counter),
    incomplete: bool(p.incomplete), transfer: choice(p.transfer, ['current', 'pending', 'unavailable']) };
}
/** Allowlisted private reads only: accidental tokens/identities/raw errors are discarded. */
export function parseHistoryResponse(json: string): HistoryResponse {
  const r = object(JSON.parse(json));
  const response: HistoryResponse = { status: choice(r.status, ['ok', 'error']), code: optional(r.code, (v) => choice(v, ['unavailable', 'storage-failed', 'changed', 'invalid-input', 'capacity-full', 'busy'])),
    storage: choice(r.storage, ['ready', 'not-created', 'unknown']), page: optional(r.page, page), reason: optional(r.reason, (value) => {
      const v = object(value), state = choice(v.state, ['deleted', 'missing', 'prepared-only', 'shared-accepted', 'unavailable']);
      return { revision: counter(v.revision), state, body: state === 'deleted' || state === 'missing' ? undefined : optional(v.body, text) };
    }) };
  if (response.status === 'ok' && response.storage === 'ready' && !response.page && !response.reason) throw new Error();
  return response;
}
export function createHistoryClient(platform: string, load: () => NativePort | null) {
  return { async run(action: HistoryAction, request: HistoryRequest = {}): Promise<HistoryResponse> {
    const unavailable: HistoryResponse = { status: 'error', code: 'unavailable', storage: 'unknown' };
    if (platform !== 'ios') return unavailable;
    try {
      const native = load();
      if (native?.apiVersion !== 1 || native.historyVersion !== 1 || typeof native.history !== 'function') return unavailable;
      return parseHistoryResponse(await native.history(action, JSON.stringify(request)));
    } catch { return unavailable; }
  } };
}
