import { parseReflectionSnapshot, type ReflectionRequest, type ReflectionSnapshot } from './reflection-model';
import type { HistoryCode } from './history';

export type ReflectionAction = 'read' | 'import' | 'deleteAll';
export type ReflectionResponse = { status: 'ok' | 'error'; code?: HistoryCode; storage: 'ready' | 'not-created' | 'unknown'; sharedIncomplete?: boolean;
  transfer: 'current' | 'pending' | 'unavailable'; snapshot?: ReflectionSnapshot };
interface NativePort { readonly apiVersion?: number; readonly reflectionVersion?: number; reflection?: (action: string, payload: string) => Promise<string> }
const object = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('shape'); return v as Record<string, unknown>; };
const choice = <T extends string>(v: unknown, options: readonly T[]): T => { if (!options.includes(v as T)) throw new Error('choice'); return v as T; };

export function parseReflectionResponse(json: string): ReflectionResponse {
  if (json.length > 250_000) throw new Error('bound');
  const r = object(JSON.parse(json));
  const status = choice(r.status, ['ok', 'error']), storage = choice(r.storage, ['ready', 'not-created', 'unknown']);
  const code = r.code == null ? undefined : choice(r.code, ['unavailable', 'storage-failed', 'changed', 'invalid-input', 'capacity-full', 'busy']);
  const transfer = choice(r.transfer, ['current', 'pending', 'unavailable']);
  if (r.sharedIncomplete != null && typeof r.sharedIncomplete !== 'boolean') throw new Error('sample');
  const snapshot = status === 'ok' && r.snapshot != null ? parseReflectionSnapshot(JSON.stringify(r.snapshot)) : undefined;
  if (status === 'ok' && storage === 'ready' && !snapshot) throw new Error('missing');
  if (snapshot && storage !== 'ready') throw new Error('storage');
  return { status, storage, transfer, code, snapshot, sharedIncomplete: r.sharedIncomplete == null ? undefined : r.sharedIncomplete as boolean };
}
export function createReflectionClient(platform: string, load: () => NativePort | null) {
  return { async run(action: ReflectionAction, request: Partial<ReflectionRequest> = {}): Promise<ReflectionResponse> {
    const unavailable: ReflectionResponse = { status: 'error', code: 'unavailable', storage: 'unknown', transfer: 'unavailable' };
    if (platform !== 'ios') return unavailable;
    try {
      const native = load();
      if (native?.apiVersion !== 1 || native.reflectionVersion !== 1 || typeof native.reflection !== 'function') return unavailable;
      // Only query fields reach Swift. A typed-but-untrusted object cannot smuggle a reason/token.
      return parseReflectionResponse(await native.reflection(action, JSON.stringify({
        period: request.period, day: request.day || undefined, expectedToken: request.expectedToken,
        clippedTo: request.clippedTo && { from: request.clippedTo.from, until: request.clippedTo.until },
      })));
    } catch { return unavailable; }
  } };
}
