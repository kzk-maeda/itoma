export type UnavailableReason =
  | 'unsupported-platform'
  | 'module-missing'
  | 'incompatible-module'
  | 'native-error';

export type BridgeAvailability =
  | { status: 'available'; apiVersion: 1; osRestrictions: 'unconnected' }
  | { status: 'unavailable'; reason: UnavailableReason };

export type DurationValidation =
  | { status: 'valid'; minutes: number }
  | { status: 'invalid'; code: 'invalid-duration' }
  | { status: 'error'; code: 'native-error' | 'invalid-response' }
  | Extract<BridgeAvailability, { status: 'unavailable' }>;

type NativePort = { apiVersion: 1; validateDuration(minutes: number): unknown };
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const absent = (value: unknown) => value === null || value === undefined;

/** Validates transport shape only. Swift Core owns duration and every restriction rule. */
export function createNativeClient(platform: string, load: () => unknown) {
  function resolve(): { port: NativePort } | Extract<BridgeAvailability, { status: 'unavailable' }> {
    if (platform !== 'ios') return { status: 'unavailable', reason: 'unsupported-platform' };
    try {
      const port = load();
      if (port === null || port === undefined) return { status: 'unavailable', reason: 'module-missing' };
      if (!object(port) || port.apiVersion !== 1 || typeof port.validateDuration !== 'function') {
        return { status: 'unavailable', reason: 'incompatible-module' };
      }
      return { port: port as NativePort };
    } catch {
      return { status: 'unavailable', reason: 'native-error' };
    }
  }

  return {
    getAvailability(): BridgeAvailability {
      const resolved = resolve();
      return 'port' in resolved
        ? { status: 'available', apiVersion: 1, osRestrictions: 'unconnected' }
        : resolved;
    },
    validateDuration(minutes: number): DurationValidation {
      const resolved = resolve();
      if (!('port' in resolved)) return resolved;
      try {
        const result: unknown = resolved.port.validateDuration(minutes);
        if (object(result)) {
          if (result.status === 'valid' && Number.isInteger(result.minutes) && result.minutes === minutes && absent(result.code)) {
            return { status: 'valid', minutes };
          }
          if (result.status === 'invalid' && result.code === 'invalid-duration' && absent(result.minutes)) {
            return { status: 'invalid', code: 'invalid-duration' };
          }
          if (result.status === 'error' && result.code === 'native-error') return { status: 'error', code: 'native-error' };
        }
        return { status: 'error', code: 'invalid-response' };
      } catch {
        // Safe code only. Never expose a raw native error or infer a successful OS operation.
        return { status: 'error', code: 'native-error' };
      }
    },
  };
}
