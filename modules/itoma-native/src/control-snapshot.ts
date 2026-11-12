import type { ScreenTimeResponse, ScreenTimeSnapshot } from './screen-time';

export type SnapshotRequest = Readonly<{ epoch: number; generation: number }>;
type PrivateState = SnapshotRequest & {
  status: ScreenTimeSnapshot['ruleDetailsStatus']; revision?: string;
  details: Map<string, { title?: string; goal?: string }>;
};
type Parts = { control: SnapshotRequest; private: PrivateState };
const parts = new WeakMap<ScreenTimeSnapshot, Parts>();
const atLeast = (a: string, b: string) => a.length > b.length || (a.length === b.length && a >= b);
const after = (a: SnapshotRequest, b: SnapshotRequest) => a.epoch > b.epoch || (a.epoch === b.epoch && a.generation >= b.generation);
const privateState = (s: ScreenTimeSnapshot, order: SnapshotRequest): PrivateState => ({ ...order,
  status: s.ruleDetailsStatus, revision: s.ruleDetailsRevision,
  details: new Map(s.ruleDetailsStatus === 'unavailable' ? [] : s.rules.map(r => [r.id, { title: r.title, goal: r.goal }])),
});
const describe = (s: ScreenTimeSnapshot, fallback: SnapshotRequest): Parts => parts.get(s) ?? { control: fallback, private: privateState(s, fallback) };
/** A durable revision is evidence even when availability/body from that request is
 * ineligible. Keep its floor without assigning a new request or displaying its text. */
function retainPrivateRevision(state: PrivateState, revision: string | undefined): PrivateState {
  if (revision === undefined || (state.revision !== undefined && atLeast(state.revision, revision))) return state;
  return { ...state, revision, status: 'unavailable', details: new Map() };
}

function compose(control: ScreenTimeSnapshot, state: Parts): ScreenTimeSnapshot {
  const result = { ...control, ruleDetailsStatus: state.private.status, ruleDetailsRevision: state.private.revision,
    rules: control.rules.map(rule => ({ ...rule, title: state.private.details.get(rule.id)?.title, goal: state.private.details.get(rule.id)?.goal })) };
  parts.set(result, state);
  return result;
}

/** Production inputs enter the ordered port first. Retained screen result snapshots
 * carry both orderings so render-time merging cannot restore stale saved text. */
export function currentControlSnapshot(previous: ScreenTimeSnapshot | undefined, incoming: ScreenTimeSnapshot): ScreenTimeSnapshot {
  if (!previous) return compose(incoming, describe(incoming, { epoch: 0, generation: 0 }));
  const before = describe(previous, { epoch: 0, generation: 0 });
  const next = describe(incoming, { epoch: 0, generation: 0 });
  const controlNewer = incoming.storage === 'ready' && previous.storage === 'ready'
    ? incoming.sequence !== previous.sequence ? atLeast(incoming.sequence, previous.sequence) : after(next.control, before.control)
    : after(next.control, before.control);
  const control = controlNewer ? incoming : previous;
  // Only ordered inputs can contribute new revision evidence to ordered state.
  // A higher revision invalidates an older visible body, even from a late request.
  let metadata = retainPrivateRevision(before.private, next.private.generation > 0 ? next.private.revision : undefined);
  // A copied/raw snapshot has no request-start proof. It may advance control by
  // sequence, but cannot replace ordered private state merely by arriving later.
  const privateNewer = next.private.generation > 0 ? after(next.private, before.private)
    : before.private.generation === 0 && (incoming.ruleDetailsStatus === 'unavailable'
      || (previous.ruleDetailsStatus !== 'unavailable' && (incoming.ruleDetailsStatus === 'ready' || previous.ruleDetailsStatus === undefined)));
  if (privateNewer) {
    const revision = next.private.revision === undefined || (metadata.revision !== undefined && !atLeast(next.private.revision, metadata.revision))
      ? metadata.revision : next.private.revision;
    const regressed = next.private.status === 'ready' && metadata.revision !== undefined
      && (next.private.revision === undefined || !atLeast(next.private.revision, metadata.revision));
    metadata = regressed ? { ...metadata, epoch: next.private.epoch, generation: next.private.generation }
      : { ...next.private, revision };
  }
  return compose(control, { control: controlNewer ? next.control : before.control, private: metadata });
}

/** One owner across clients/consumers for the JS runtime. Native revisions remain
 * durable truth; request generations only order overlapping JS operations. */
export function createControlSnapshotSession() {
  let epoch = 0, generation = 0, readable = true;
  let current: ScreenTimeSnapshot | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: ScreenTimeSnapshot) => {
    current = next;
    for (const listener of listeners) listener();
    return next;
  };
  const invalidatePrivate = () => {
    epoch += 1;
    if (current) {
      const old = describe(current, { epoch, generation });
      publish(compose(current, { control: old.control, private: { epoch, generation, status: 'unavailable', revision: old.private.revision, details: new Map() } }));
    }
  };
  return {
    beginRequest: (): SnapshotRequest => ({ epoch, generation: ++generation }),
    getEpoch: () => epoch,
    getSnapshot: () => current,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    invalidatePrivate,
    setActive(active: boolean) { if (readable !== active) { readable = active; invalidatePrivate(); } },
    integrate(incoming: ScreenTimeSnapshot, request: SnapshotRequest) {
      const metadata = request.epoch === epoch && readable ? privateState(incoming, request)
        : { epoch, generation, status: 'unavailable' as const, revision: incoming.ruleDetailsRevision, details: new Map() };
      // Old epochs can advance control, but cannot supply private availability/text.
      const existing = current && request.epoch !== epoch
        ? retainPrivateRevision(describe(current, { epoch, generation }).private, incoming.ruleDetailsRevision) : metadata;
      const stamped = compose(incoming, { control: request, private: existing });
      return publish(currentControlSnapshot(current, stamped));
    },
    /** Test fixture isolation only. Runtime remounts keep this session. */
    reset() { epoch = 0; generation = 0; readable = true; current = undefined; },
  };
}
export const controlSnapshots = createControlSnapshotSession();

/** Providers also wrap injected ports. Idempotence avoids double generations for
 * official clients; onboarding and Screen Time always use the same owner. */
const wrapped = new WeakMap<object, object>();
export function withControlSnapshots<Args extends unknown[], Result extends ScreenTimeResponse>(client: { run: (...args: Args) => Promise<Result> }) {
  const existing = wrapped.get(client);
  if (existing) return existing as typeof client;
  const ordered = { ...client, async run(...args: Args): Promise<Result> {
    const request = controlSnapshots.beginRequest();
    const result = await client.run(...args);
    return result.snapshot ? { ...result, snapshot: controlSnapshots.integrate(result.snapshot, request) } : result;
  } };
  wrapped.set(client, ordered); wrapped.set(ordered, ordered);
  return ordered;
}
