export type DirectProbeAction = 'snapshot' | 'pick' | 'arm' | 'stop';
export type DirectProbeSnapshot = {
  phase: 'idle' | 'prepared' | 'registering' | 'armed' | 'stopped'; id?: string;
  startsAt?: number; endsAt?: number; selectedCount: number; storeCount: number;
  observation: 'none' | 'applied' | 'cleared' | 'uncertain'; origin: 'none' | 'monitor' | 'manual' | 'expiry'; observedAt?: number;
};
export type DirectProbeResponse = {
  status: 'ok' | 'error' | 'cancelled'; code?: 'busy' | 'unavailable' | 'invalid' | 'changed' | 'normal-rules-active' | 'authorization-required';
  authorization: 'approved' | 'denied' | 'unknown'; snapshot?: DirectProbeSnapshot;
};
type Port = { apiVersion: number; directShieldProbeVersion: number; directShieldProbe(action: string, id: string | null): Promise<string> };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
function parse(v: unknown): DirectProbeResponse | undefined {
  if (!object(v) || !['ok', 'error', 'cancelled'].includes(String(v.status)) || !['approved', 'denied', 'unknown'].includes(String(v.authorization))) return;
  if (v.code !== undefined && !['busy', 'unavailable', 'invalid', 'changed', 'normal-rules-active', 'authorization-required'].includes(String(v.code))) return;
  if (v.snapshot !== undefined) {
    const s = v.snapshot;
    if (!object(s) || !['idle', 'prepared', 'registering', 'armed', 'stopped'].includes(String(s.phase))
      || !['none', 'applied', 'cleared', 'uncertain'].includes(String(s.observation)) || !['none', 'monitor', 'manual', 'expiry'].includes(String(s.origin))
      || ![0, 1].includes(s.selectedCount as number) || ![0, 1].includes(s.storeCount as number)
      || (s.observedAt !== undefined && !number(s.observedAt))) return;
    if (s.phase !== 'idle' && !uuid(s.id)) return;
    if ((s.phase !== 'idle' && s.phase !== 'stopped') || s.startsAt !== undefined || s.endsAt !== undefined) {
      if (!number(s.startsAt) || !number(s.endsAt) || (s.endsAt as number) - (s.startsAt as number) !== 1200) return;
    }
  } else if (v.status === 'ok') return;
  return v as DirectProbeResponse;
}
export function createDirectProbeClient(platform: string, load: () => unknown) {
  function port(): Port | undefined {
    if (platform !== 'ios') return;
    try {
      const value = load();
      if (object(value) && value.apiVersion === 1 && value.directShieldProbeVersion === 1 && typeof value.directShieldProbe === 'function') return value as unknown as Port;
    } catch { /* Optional native build unavailable. */ }
  }
  return {
    available: () => !!port(),
    async run(action: DirectProbeAction, id?: string): Promise<DirectProbeResponse> {
      const value = port();
      if (!value) return { status: 'error', authorization: 'unknown', code: 'unavailable' };
      if (action === 'arm' && !uuid(id)) return { status: 'error', authorization: 'unknown', code: 'invalid' };
      try { return parse(JSON.parse(await value.directShieldProbe(action, id ?? null))) ?? { status: 'error', authorization: 'unknown', code: 'unavailable' }; }
      catch { return { status: 'error', authorization: 'unknown', code: 'unavailable' }; }
    },
  };
}
