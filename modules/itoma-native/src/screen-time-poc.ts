export type PoCAction = 'snapshot' | 'initialize' | 'authorize' | 'pick' | 'apply' | 'stop';
export type PoCCode = 'unavailable' | 'busy' | 'storage-failure' | 'authorization-failed'
  | 'authorization-required' | 'presentation-unavailable' | 'reselection-required'
  | 'empty-selection' | 'applications-only' | 'too-many-applications' | 'invalid-action';
export type PoCSnapshot = {
  availability: 'device-poc' | 'disabled' | 'simulator-unavailable' | 'unsupported-os';
  authorization: 'unknown' | 'denied' | 'approved';
  storage: 'not-created' | 'ready' | 'unavailable';
  selections: { ref: string; applicationCount: number; confirmedThisSession: boolean }[];
  operation: 'idle' | 'saved' | 'cancelled' | 'requested' | 'failed';
  code: PoCCode | null;
  observation: 'unknown' | 'own-store-matches' | 'own-store-empty' | 'uncertain';
};
export type PoCResult = { status: 'snapshot'; snapshot: PoCSnapshot }
  | { status: 'error'; code: 'unsupported-platform' | 'module-missing' | 'incompatible-module' | 'native-error' | 'invalid-response' };

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const codes = ['unavailable', 'busy', 'storage-failure', 'authorization-failed', 'authorization-required',
  'presentation-unavailable', 'reselection-required', 'empty-selection', 'applications-only', 'too-many-applications', 'invalid-action'];
const member = (value: unknown, choices: string[]) => typeof value === 'string' && choices.includes(value);

/** Transport validation only. Tokens and Screen Time decisions stay in Swift. */
export function createScreenTimePoCClient(platform: string, load: () => unknown) {
  return {
    async run(action: PoCAction, ref?: string): Promise<PoCResult> {
      if (platform !== 'ios') return { status: 'error', code: 'unsupported-platform' };
      try {
        const native = load();
        if (native == null) return { status: 'error', code: 'module-missing' };
        if (!object(native) || native.apiVersion !== 1 || typeof native.screenTimePoC !== 'function') {
          return { status: 'error', code: 'incompatible-module' };
        }
        const value: unknown = await native.screenTimePoC(action, ref ?? null);
        if (!object(value) || !member(value.availability, ['device-poc', 'disabled', 'simulator-unavailable', 'unsupported-os'])
          || !member(value.authorization, ['unknown', 'denied', 'approved'])
          || !member(value.storage, ['not-created', 'ready', 'unavailable'])
          || !member(value.operation, ['idle', 'saved', 'cancelled', 'requested', 'failed'])
          || !member(value.observation, ['unknown', 'own-store-matches', 'own-store-empty', 'uncertain'])
          || !(value.code === null || (typeof value.code === 'string' && codes.includes(value.code)))
          || !Array.isArray(value.selections)) return { status: 'error', code: 'invalid-response' };
        const selections: PoCSnapshot['selections'] = [];
        for (const item of value.selections) {
          if (!object(item) || typeof item.ref !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(item.ref)
            || typeof item.applicationCount !== 'number' || !Number.isSafeInteger(item.applicationCount) || item.applicationCount < 0
            || typeof item.confirmedThisSession !== 'boolean' || selections.some((selection) => selection.ref === item.ref)) {
            return { status: 'error', code: 'invalid-response' };
          }
          selections.push({ ref: item.ref, applicationCount: item.applicationCount, confirmedThisSession: item.confirmedThisSession });
        }
        return { status: 'snapshot', snapshot: {
          availability: value.availability as PoCSnapshot['availability'],
          authorization: value.authorization as PoCSnapshot['authorization'],
          storage: value.storage as PoCSnapshot['storage'], selections,
          operation: value.operation as PoCSnapshot['operation'], code: value.code as PoCCode | null,
          observation: value.observation as PoCSnapshot['observation'],
        } };
      } catch { return { status: 'error', code: 'native-error' }; }
    },
  };
}
