// Temporarily injected into the real root for local QA. The app has no import of this file.
import type { ReflectionAction, ReflectionResponse } from '../../modules/itoma-native/src/reflection';
import type { ReflectionRequest } from '../../modules/itoma-native/src/reflection-model';
import { dayLength } from '../../src/lib/reflection-landscape';
import { landscapeFixture } from './reflection-landscape';

const reports: { action: string; day: string | undefined; elapsedMs: number; bytes: number }[] = [];
const long = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fixture') === 'long';
const fixture = long ? landscapeFixture(7384, 438 * dayLength) : landscapeFixture();
if (typeof window !== 'undefined') Object.assign(window, { landscapeReads: reports });
export const landscapeClient = {
  async run(action: ReflectionAction, request: Partial<ReflectionRequest> = {}): Promise<ReflectionResponse> {
    const start = performance.now();
    const data = action === 'readWeek'
      ? { inspection: { token: fixture.token, week: fixture.week(request.day!) } }
      : { snapshot: fixture.snapshot(request.period, request.day || undefined, request.includeLandscape ?? true) };
    reports.push({ action, day: request.day, elapsedMs: performance.now() - start, bytes: JSON.stringify(data).length });
    return { status: 'ok', storage: 'ready', transfer: 'current', ...data };
  },
};
