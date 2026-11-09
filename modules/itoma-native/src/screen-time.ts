export type ScreenTimeAction = 'snapshot' | 'initialize' | 'authorize' | 'pickApplications' | 'previewRule' | 'commitRule' | 'cancelCandidate' | 'previewUnlock' | 'unlock' | 'stop' | 'endGrant' | 'resume' | 'reconcile' | 'deleteReasons' | 'stopLegacy';
export type ScreenTimeCode = 'unavailable' | 'busy' | 'invalid-input' | 'changed' | 'authorization-required' | 'selection-required' | 'schedule-failed' | 'storage-failed' | 'reason-storage-full' | 'reason-required' | 'application-uncertain' | 'legacy-active';
export interface ScreenTimeRule {
  id: string; selectionRef: string; weekdays: number[]; startMinute: number; endMinute: number; nextDay: boolean; enabled: boolean;
}
export interface RuleInput extends Omit<ScreenTimeRule, 'id'> { id?: string; expectedRevision: string; remove?: boolean }
export interface ScreenTimeTarget { ref: string; selectionRef: string; restricted: boolean; unlockable: boolean; grantEndsAt?: number; grantCommandID?: string; ruleID?: string }
export interface ScreenTimePeriod { ruleID: string; startsAt: number; endsAt: number }
export interface ScreenTimeSnapshot {
  availability: 'device' | 'simulator' | 'unsupported-os' | 'unconfigured' | 'native-missing' | 'unsupported-platform';
  storage: 'ready' | 'not-created'; authorization: 'unknown' | 'denied' | 'approved';
  activation: 'enabled' | 'paused' | 'awaitingReauthorizationConfirmation'; revision: string; sequence: string;
  rules: ScreenTimeRule[]; selections: { ref: string; count: number }[]; targets: ScreenTimeTarget[];
  period?: ScreenTimePeriod; periods: ScreenTimePeriod[]; nextPeriod?: ScreenTimePeriod; observation: 'unknown' | 'applying' | 'applied' | 'failed' | 'uncertain';
  validUntil?: number; evaluatedAt?: number; schedulesReady: boolean; needsSelectionReview: boolean; defaultMinutes: number; historyIncomplete: boolean;
}
export interface ScreenTimeResponse {
  status: 'ok' | 'error' | 'cancelled' | 'confirmation-required'; code?: ScreenTimeCode; ref?: string;
  impacts: { kind: 'shorten' | 'invalidate' | 'expire' | 'uncertain'; endsAt?: number }[]; minutes?: number; previewEndsAt?: number; shortened?: boolean;
  snapshot?: ScreenTimeSnapshot; legacyActive?: boolean;
}
export interface ScreenTimeRequest { rule?: RuleInput; ref?: string; targetRef?: string; reason?: string; minutes?: number }
interface NativePort { readonly apiVersion?: number; readonly screenTimeVersion?: number; screenTime?: (action: string, payload: string) => Promise<string> }

const codes: ScreenTimeCode[] = ['unavailable', 'busy', 'invalid-input', 'changed', 'authorization-required', 'selection-required', 'schedule-failed', 'storage-failed', 'reason-storage-full', 'reason-required', 'application-uncertain', 'legacy-active'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (v: unknown): Record<string, unknown> => { if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(); return v as Record<string, unknown>; };
const text = (v: unknown): string => { if (typeof v !== 'string') throw new Error(); return v; };
const id = (v: unknown): string => { const s = text(v); if (!uuid.test(s)) throw new Error(); return s.toLowerCase(); };
const numeric = (v: unknown): number => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(); return v; };
const integer = (v: unknown, min: number, max: number): number => { const n = numeric(v); if (!Number.isInteger(n) || n < min || n > max) throw new Error(); return n; };
const bool = (v: unknown): boolean => { if (typeof v !== 'boolean') throw new Error(); return v; };
const choice = <T extends string>(v: unknown, choices: readonly T[]): T => { if (!choices.includes(v as T)) throw new Error(); return v as T; };
const list = <T>(v: unknown, parse: (value: unknown) => T): T[] => { if (!Array.isArray(v)) throw new Error(); return v.map(parse); };
const optional = <T>(v: unknown, parse: (value: unknown) => T): T | undefined => v == null ? undefined : parse(v);
const counter = (v: unknown) => { const s = text(v); if (!/^(0|[1-9][0-9]*)$/.test(s)) throw new Error(); return s; };
const period = (v: unknown): ScreenTimePeriod => { const p = object(v); const startsAt = numeric(p.startsAt), endsAt = numeric(p.endsAt); if (startsAt >= endsAt) throw new Error(); return { ruleID: id(p.ruleID), startsAt, endsAt }; };

function snapshot(v: unknown): ScreenTimeSnapshot {
  const s = object(v);
  return {
    availability: choice(s.availability, ['device', 'simulator', 'unsupported-os', 'unconfigured', 'native-missing', 'unsupported-platform']),
    storage: choice(s.storage, ['ready', 'not-created']), authorization: choice(s.authorization, ['unknown', 'denied', 'approved']),
    activation: choice(s.activation, ['enabled', 'paused', 'awaitingReauthorizationConfirmation']), revision: counter(s.revision), sequence: counter(s.sequence),
    rules: list(s.rules, (v) => { const r = object(v); return { id: id(r.id), selectionRef: id(r.selectionRef),
      weekdays: list(r.weekdays, (day) => integer(day, 1, 7)), startMinute: integer(r.startMinute, 0, 1439), endMinute: integer(r.endMinute, 0, 1439), nextDay: bool(r.nextDay), enabled: bool(r.enabled) }; }),
    selections: list(s.selections, (v) => { const r = object(v); return { ref: id(r.ref), count: integer(r.count, 1, 50) }; }),
    targets: list(s.targets, (v) => { const r = object(v); return { ref: id(r.ref), selectionRef: id(r.selectionRef), restricted: bool(r.restricted),
      unlockable: bool(r.unlockable), grantEndsAt: optional(r.grantEndsAt, numeric), grantCommandID: optional(r.grantCommandID, id), ruleID: optional(r.ruleID, id) }; }),
    period: optional(s.period, period), periods: list(s.periods, period), nextPeriod: optional(s.nextPeriod, period),
    observation: choice(s.observation, ['unknown', 'applying', 'applied', 'failed', 'uncertain']), validUntil: optional(s.validUntil, numeric), evaluatedAt: optional(s.evaluatedAt, numeric),
    schedulesReady: bool(s.schedulesReady), needsSelectionReview: bool(s.needsSelectionReview), defaultMinutes: integer(s.defaultMinutes, 1, 30), historyIncomplete: bool(s.historyIncomplete),
  };
}

/** Parse a versioned allowlist. Native extras (including accidental identity data) never reach UI. */
export function parseScreenTimeResponse(json: string): ScreenTimeResponse {
  const r = object(JSON.parse(json));
  return { status: choice(r.status, ['ok', 'error', 'cancelled', 'confirmation-required']), code: optional(r.code, (v) => choice(v, codes)),
    ref: optional(r.ref, id), impacts: list(r.impacts ?? [], (v) => { const i = object(v); return { kind: choice(i.kind, ['shorten', 'invalidate', 'expire', 'uncertain']), endsAt: optional(i.endsAt, numeric) }; }),
    previewEndsAt: optional(r.previewEndsAt, numeric), shortened: optional(r.shortened, bool),
    minutes: optional(r.minutes, (v) => integer(v, 1, 30)), snapshot: optional(r.snapshot, snapshot), legacyActive: optional(r.legacyActive, bool) };
}

export function unavailableSnapshot(availability: ScreenTimeSnapshot['availability']): ScreenTimeSnapshot {
  return { availability, storage: 'not-created', authorization: 'unknown', activation: 'enabled', revision: '0', sequence: '0', rules: [], selections: [], targets: [], periods: [], observation: 'unknown', schedulesReady: false, needsSelectionReview: false, defaultMinutes: 5, historyIncomplete: false };
}

export function createScreenTimeClient(platform: string, load: () => NativePort | null) {
  return {
    async run(action: ScreenTimeAction, request: ScreenTimeRequest = {}): Promise<ScreenTimeResponse> {
      if (platform !== 'ios') return { status: 'error', code: 'unavailable', impacts: [], snapshot: unavailableSnapshot('unsupported-platform') };
      try {
        const native = load();
        if (native?.apiVersion !== 1 || native.screenTimeVersion !== 1 || typeof native.screenTime !== 'function') {
          return { status: 'error', code: 'unavailable', impacts: [], snapshot: unavailableSnapshot('native-missing') };
        }
        return parseScreenTimeResponse(await native.screenTime(action, JSON.stringify(request)));
      } catch { return { status: 'error', code: 'unavailable', impacts: [] }; }
    },
  };
}
