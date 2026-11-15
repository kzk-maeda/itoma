import type { ProductClients } from '@/runtime/product-providers';
import { parseScreenTimeResponse, type ScreenTimeAction, type ScreenTimeRequest, type ScreenTimeResponse, type ScreenTimeSnapshot } from '../../modules/itoma-native/src/screen-time';
import { parseHistoryResponse, type HistoryRequest, type HistoryResponse, type HistoryRow } from '../../modules/itoma-native/src/history';
import { parseOnboardingResponse } from '../../modules/itoma-native/src/onboarding';

export const demoScenarios = ['normal', 'uncertain', 'paused', 'denied'] as const;
export type DemoScenario = typeof demoScenarios[number];
export type DemoOutcome = 'success' | 'schedule-failed' | 'uncertain';
export function readDemoScenario(value: string | null): DemoScenario {
  return demoScenarios.includes(value as DemoScenario) ? value as DemoScenario : 'normal';
}
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ruleID = uuid(1), selectionID = uuid(2);
export const demoApplications = [{ ref: uuid(3), name: 'X', symbol: '𝕏' }, { ref: uuid(4), name: 'YouTube', symbol: '▶' }, { ref: uuid(5), name: 'Instagram', symbol: '◎' }];

type Options = { scenario?: DemoScenario; now?: () => number };
/** Contract-shaped in-memory port. A UI simulator, never a Screen Time/OS emulator. */
export function createDemoSession({ scenario = 'normal', now = Date.now }: Options = {}) {
  const started = now() / 1000, endsAt = started + 90 * 60;
  let sequence = 0, nextID = 20, revision = 1;
  let activation: ScreenTimeSnapshot['activation'] = scenario === 'paused' ? 'paused' : 'enabled';
  let authorization: ScreenTimeSnapshot['authorization'] = scenario === 'denied' ? 'denied' : 'approved';
  let observation: ScreenTimeSnapshot['observation'] = scenario === 'uncertain' ? 'uncertain' : 'applied';
  let outcome: DemoOutcome = 'success';
  let title = '自分の時間', goal = '本を読んで、ゆっくり過ごす。';
  const rows: HistoryRow[] = [], reasons = new Map<string, string>();
  const grants = new Map<string, { command: string; until: number; status: 'active' | 'uncertain' | 'reblockPending' }>();
  const previews = new Map<string, { target: string; until: number; reason: string; revision: number }>();
  const commands = new Map<string, { command: string; outcome: DemoOutcome }>();
  const at = () => now() / 1000;
  function expire() {
    for (const [target, grant] of grants) if (grant.until <= at() && grant.status !== 'reblockPending') {
      grants.set(target, { ...grant, status: 'reblockPending' }); observation = 'uncertain';
      rows.unshift({ key: uuid(nextID++), at: at(), action: 'requestTemporaryGrant', status: 'expired', commandID: grant.command, expiresAt: grant.until, grantStatus: 'reblockPending' });
      revision++;
    }
  }
  function snapshot(): ScreenTimeSnapshot {
    expire();
    const available = authorization === 'approved' && activation === 'enabled' && endsAt > at();
    const period = { ruleID, startsAt: started - 30 * 60, endsAt };
    const minute = (seconds: number) => { const date = new Date(seconds * 1000); return date.getHours() * 60 + date.getMinutes(); };
    return { availability: 'device', storage: 'ready', authorization, activation, revision: String(revision), sequence: String(++sequence),
      rules: [{ id: ruleID, selectionRef: selectionID, weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: minute(period.startsAt), endMinute: minute(endsAt), nextDay: new Date(endsAt * 1000).getDate() !== new Date(period.startsAt * 1000).getDate(), enabled: true, title, goal }],
      selections: [{ ref: selectionID, count: demoApplications.length }],
      targets: demoApplications.map(app => { const grant = grants.get(app.ref); return { ref: app.ref, selectionRef: selectionID, ruleID,
        restricted: available && (!grant || grant.status === 'reblockPending'), unlockable: available && observation === 'applied' && !grant,
        ...(grant ? { grantCommandID: grant.command, grantEndsAt: grant.until, grantStatus: grant.status } : {}) }; }),
      periods: endsAt > at() ? [period] : [], observation, validUntil: at() + 60, evaluatedAt: at(), schedulesReady: true,
      needsSelectionReview: authorization !== 'approved', defaultMinutes: 5, historyIncomplete: false, ruleDetailsStatus: 'ready', ruleDetailsRevision: String(revision) };
  }
  const response = (extra: Partial<ScreenTimeResponse> = {}): ScreenTimeResponse => parseScreenTimeResponse(JSON.stringify({ status: 'ok', impacts: [], snapshot: snapshot(), ...extra }));
  const fail = (code: ScreenTimeResponse['code']) => response({ status: 'error', code });
  function page(request: HistoryRequest = {}): HistoryResponse {
    let chosen = rows.filter(row => request.kind !== 'reason' || reasons.has(row.commandID ?? ''));
    if (request.day) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(request.day)) return { status: 'error', storage: 'ready', code: 'invalid-input' };
      chosen = chosen.filter(row => new Date(row.at * 1000).toISOString().slice(0, 10) === request.day);
    }
    const index = request.afterKey ? chosen.findIndex(row => row.key === request.afterKey) : -1;
    const start = index < 0 ? 0 : request.direction === 'newer' ? Math.max(0, index - 40) : index + 1;
    const visible = chosen.slice(start, start + 40);
    return parseHistoryResponse(JSON.stringify({ status: 'ok', storage: 'ready', page: { revision: String(revision), asOf: at(), timeZone: 'UTC', rows: visible,
      next: chosen.length > start + 40 ? { at: visible[visible.length - 1].at, key: visible[visible.length - 1].key } : undefined,
      previous: start > 0 && visible.length ? { at: visible[0].at, key: visible[0].key } : undefined,
      logicalBytes: '4096', warningBytes: '83886080', maximumBytes: '104857600', warningReached: false, limitReached: false, incomplete: false, transfer: 'current' } }));
  }
  const clients: ProductClients = {
    screenTime: { async run(action: ScreenTimeAction, request: ScreenTimeRequest = {}) {
      expire();
      switch (action) {
        case 'snapshot': case 'initialize': return response();
        case 'authorize': authorization = 'approved'; revision++; return response();
        case 'pickApplications': return fail('unavailable');
        case 'previewUnlock': {
          if (!request.reason?.trim()) return fail('reason-required');
          if (!Number.isInteger(request.minutes) || request.minutes! < 1 || request.minutes! > 30) return fail('invalid-input');
          const target = snapshot().targets.find(target => target.ref === request.targetRef);
          if (!target?.unlockable) return fail('changed');
          const ref = uuid(nextID++), until = Math.min(endsAt, at() + request.minutes! * 60);
          previews.set(ref, { target: target.ref, until, reason: request.reason, revision });
          return response({ status: 'confirmation-required', ref, minutes: Math.max(1, Math.ceil((until - at()) / 60)), previewEndsAt: until, shortened: until < at() + request.minutes! * 60 });
        }
        case 'cancelUnlock': previews.clear(); return response();
        case 'unlock': {
          if (request.ref && commands.has(request.ref)) {
            const accepted = commands.get(request.ref)!;
            return response({ status: accepted.outcome === 'success' ? 'ok' : 'error', code: accepted.outcome === 'schedule-failed' ? 'schedule-failed' : accepted.outcome === 'uncertain' ? 'application-uncertain' : undefined, ...(accepted.outcome !== 'schedule-failed' ? { ref: accepted.command } : {}) });
          }
          const preview = previews.get(request.ref ?? '');
          if (!preview || preview.revision !== revision || preview.until <= at() || preview.reason !== request.reason) return fail('changed');
          const command = uuid(nextID++); previews.delete(request.ref!); commands.set(request.ref!, { command, outcome });
          reasons.set(command, preview.reason); revision++;
          const failed = outcome === 'schedule-failed', uncertain = outcome === 'uncertain';
          if (!failed) grants.set(preview.target, { command, until: preview.until, status: uncertain ? 'uncertain' : 'active' });
          if (uncertain) observation = 'uncertain';
          rows.unshift({ key: uuid(nextID++), commandID: command, at: at(), action: failed ? 'reason' : 'requestTemporaryGrant', status: failed ? 'prepared' : uncertain ? 'uncertain' : 'succeeded', ...(!failed ? { expiresAt: preview.until, grantStatus: uncertain ? 'uncertain' : 'active' } : {}) });
          return response({ status: failed || uncertain ? 'error' : 'ok', code: failed ? 'schedule-failed' : uncertain ? 'application-uncertain' : undefined, ...(!failed ? { ref: command } : {}) });
        }
        case 'retryGrant': {
          const grant = [...grants.values()].find(grant => grant.command === request.ref);
          if (!grant || grant.until <= at()) return fail('changed');
          grant.status = 'active'; observation = 'applied'; return response({ ref: grant.command });
        }
        case 'endGrant': {
          const target = [...grants].find(([, grant]) => grant.command === request.ref);
          if (!target) return fail('changed');
          target[1].status = 'reblockPending'; observation = 'uncertain'; revision++;
          rows.unshift({ key: uuid(nextID++), commandID: target[1].command, at: at(), action: 'requestTemporaryGrant', status: 'pending', expiresAt: target[1].until, grantStatus: 'reblockPending' });
          return response();
        }
        case 'reconcile': {
          observation = 'applied';
          for (const [target, grant] of grants) if (grant.status === 'reblockPending') grants.delete(target);
          revision++; return response();
        }
        case 'stop': activation = 'paused'; observation = 'uncertain'; revision++; return response();
        case 'resume': activation = 'enabled'; observation = 'applied'; revision++; return response();
        case 'saveRuleDetails': {
          if (!request.details || request.details.ruleID !== ruleID || request.details.expectedRevision !== String(revision) || request.details.expectedPolicyRevision !== String(revision)) return fail('changed');
          title = request.details.title; goal = request.details.goal; revision++; return response();
        }
        // Unsupported writes deliberately fail; never claim a rule edit/delete was saved.
        default: return fail('unavailable');
      }
    } },
    history: { async run(action, request = {}) {
      expire();
      if (action === 'reason') {
        const row = rows.find(row => row.commandID === request.commandID), body = reasons.get(request.commandID ?? '');
        return parseHistoryResponse(JSON.stringify({ status: 'ok', storage: 'ready', reason: { revision: String(revision), state: row?.reasonDeleted ? 'deleted' : body === undefined ? 'missing' : row?.status === 'prepared' ? 'prepared-only' : 'shared-accepted', body } }));
      }
      if (action === 'deleteHistory') { rows.length = 0; reasons.clear(); revision++; }
      if (action === 'deleteReasons') { reasons.clear(); rows.forEach(row => { row.reasonDeleted = true; }); revision++; }
      return page(request);
    } },
    reflection: { async run(action) {
      if (action === 'deleteAll') { rows.length = 0; reasons.clear(); revision++; }
      return { status: 'ok', storage: 'not-created', transfer: 'current' };
    } },
    onboarding: { async run(action) {
      if (action !== 'onboardingRead' && action !== 'onboardingAdopt') return response({ status: 'error', code: 'unavailable' });
      return parseOnboardingResponse(JSON.stringify({ ...response(), onboarding: { revision: String(revision), seenIntro: true, completed: true, selectionReady: false, canEdit: true } }));
    } },
  };
  return { clients,
    applicationLabel: (selection: string, target: string) => selection !== selectionID ? undefined : target ? demoApplications.find(app => app.ref === target)?.name : demoApplications.map(app => app.name).join('・'),
    applicationSymbol: (selection: string, target: string) => selection === selectionID ? demoApplications.find(app => app.ref === target)?.symbol : undefined,
    setOutcome(value: DemoOutcome) { outcome = value; },
  };
}
