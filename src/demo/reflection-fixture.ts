import { parseReflectionPrototypeSnapshot, type ReflectionRequest, type ReflectionSnapshot } from '../../modules/itoma-native/src/reflection-model';
import type { ReflectionResponse } from '../../modules/itoma-native/src/reflection';
import samples from './fixtures/reflection.json';

/** Pre-aggregated display samples, never an interval calculator or native producer. */
export function createReflectionFixture() {
  let deleted = false, revision = 1;
  const empty = (bucket: ReflectionSnapshot['total']) => ({ ...bucket, coverage: 'deleted' as const, knownSeconds: undefined });
  return {
    clear() { deleted = true; revision++; },
    read(request: Partial<ReflectionRequest> = {}): ReflectionResponse {
      const period = request.period ?? 'week', day = request.day || (period === 'week' ? '2026-11-09' : '2026-11-01');
      const token = `prototype-v1:reflection-demo:${revision}`;
      if (request.expectedToken && request.expectedToken !== token) return { status: 'error', storage: 'ready', transfer: 'current', code: 'changed' };
      const entry = samples.entries.find(sample => sample.request.period === period && sample.request.day === day
        && sample.request.clippedTo?.from === request.clippedTo?.from && sample.request.clippedTo?.until === request.clippedTo?.until);
      if (!entry) return { status: 'error', storage: 'ready', transfer: 'current', code: 'invalid-input' };
      const snapshot = parseReflectionPrototypeSnapshot(JSON.stringify({ ...entry.response, token }));
      if (deleted) {
        snapshot.total = empty(snapshot.total); snapshot.selected = empty(snapshot.selected);
        snapshot.trend = snapshot.trend.map(empty); snapshot.buckets = snapshot.buckets.map(empty);
      }
      return { status: 'ok', storage: 'ready', transfer: 'current', snapshot };
    },
  };
}
