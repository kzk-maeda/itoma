import { parseScreenTimeResponse, type ScreenTimeResponse } from './screen-time';

export type OnboardingStep = 'purpose' | 'schedule' | 'apps' | 'review';
export interface OnboardingDraft {
  id: string; step: OnboardingStep; title: string; goal: string; weekdays: number[];
  start: string; end: string; nextDay: boolean; selectionRef?: string; commandID?: string; submitted: boolean;
}
export interface OnboardingProgress {
  revision: string; seenIntro: boolean; completed: boolean; draft?: OnboardingDraft;
  selectionReady: boolean; commandState?: 'pending' | 'scheduling' | 'applying' | 'succeeded' | 'failed' | 'uncertain' | 'cancelled' | 'expired' | 'superseded'; canEdit: boolean;
}
export type OnboardingAction = 'onboardingRead' | 'onboardingBegin' | 'onboardingSave' | 'onboardingDefer' | 'onboardingDiscard' | 'onboardingPrepare' | 'onboardingCommit' | 'onboardingEdit' | 'onboardingAdopt';
export interface OnboardingRequest { expectedRevision: string; draft?: Omit<OnboardingDraft, 'commandID' | 'submitted'> }
export interface OnboardingResponse extends ScreenTimeResponse { onboarding?: OnboardingProgress }
interface NativePort { readonly apiVersion?: number; readonly onboardingVersion?: number; screenTime?: (action: string, payload: string) => Promise<string> }

const obj = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(); return v as Record<string, unknown>; };
const str = (v: unknown, limit = 1000): string => { if (typeof v !== 'string' || v.length > limit || v.includes('\0')) throw new Error(); return v; };
const bool = (v: unknown): boolean => { if (typeof v !== 'boolean') throw new Error(); return v; };
const id = (v: unknown): string => { const s = str(v, 36); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) throw new Error(); return s.toLowerCase(); };
const choice = <T extends string>(v: unknown, choices: readonly T[]): T => { if (!choices.includes(v as T)) throw new Error(); return v as T; };
const optionalID = (v: unknown) => v == null ? undefined : id(v);
/** Small allowlist: opaque IDs + bounded local text; never app tokens, paths or raw errors. */
export function parseOnboardingResponse(json: string): OnboardingResponse {
  const response = parseScreenTimeResponse(json), raw = obj(JSON.parse(json));
  if (raw.onboarding == null) return response;
  const p = obj(raw.onboarding), revision = str(p.revision, 20);
  if (!/^(0|[1-9][0-9]*)$/.test(revision) || BigInt(revision) > 18446744073709551615n) throw new Error();
  let draft: OnboardingDraft | undefined;
  if (p.draft != null) {
    const d = obj(p.draft);
    if (!Array.isArray(d.weekdays) || d.weekdays.some(v => !Number.isInteger(v) || v < 1 || v > 7) || new Set(d.weekdays).size !== d.weekdays.length) throw new Error();
    draft = { id: id(d.id), step: choice(d.step, ['purpose', 'schedule', 'apps', 'review']), title: str(d.title, 80), goal: str(d.goal),
      weekdays: d.weekdays, start: str(d.start, 16), end: str(d.end, 16), nextDay: bool(d.nextDay), selectionRef: optionalID(d.selectionRef), commandID: optionalID(d.commandID), submitted: bool(d.submitted) };
    if (draft.submitted && !draft.commandID) throw new Error();
  }
  const progress: OnboardingProgress = { revision, seenIntro: bool(p.seenIntro), completed: bool(p.completed), draft, selectionReady: bool(p.selectionReady),
    canEdit: bool(p.canEdit), commandState: p.commandState == null ? undefined : choice(p.commandState, ['pending', 'scheduling', 'applying', 'succeeded', 'failed', 'uncertain', 'cancelled', 'expired', 'superseded'] as const) };
  if (progress.completed && draft || !progress.seenIntro && (draft || progress.completed) || progress.selectionReady && !draft?.selectionRef) throw new Error();
  return { ...response, onboarding: progress };
}
export function createOnboardingClient(platform: string, load: () => NativePort | null) {
  return { async run(action: OnboardingAction, request?: OnboardingRequest): Promise<OnboardingResponse> {
    if (platform !== 'ios') return { status: 'error', code: 'unavailable', impacts: [] };
    try {
      const native = load();
      if (native?.apiVersion !== 1 || native.onboardingVersion !== 1 || typeof native.screenTime !== 'function') return { status: 'error', code: 'unavailable', impacts: [] };
      return parseOnboardingResponse(await native.screenTime(action, JSON.stringify(request ? { onboarding: request } : {})));
    } catch { return { status: 'error', code: 'unavailable', impacts: [] }; }
  } };
}
