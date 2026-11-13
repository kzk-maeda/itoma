import { createControlSnapshotSession, currentControlSnapshot, withControlSnapshots } from '../modules/itoma-native/src/control-snapshot';
import { createScreenTimeClient, unavailableSnapshot, type ScreenTimeResponse, type ScreenTimeSnapshot } from '../modules/itoma-native/src/screen-time';
import { createOnboardingClient } from '../modules/itoma-native/src/onboarding';
const ref = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const make = (sequence = '9', revision = '10', title = 'new title'): ScreenTimeSnapshot => ({ ...unavailableSnapshot('device'), storage: 'ready', sequence,
  ruleDetailsStatus: 'ready', ruleDetailsRevision: revision,
  rules: [{ id: ref, selectionRef: ref, weekdays: [1], startMinute: 0, endMinute: 1, nextDay: false, enabled: true, title, goal: 'synthetic goal' }] });
const hidden = (sequence = '9'): ScreenTimeSnapshot => ({ ...make(sequence), ruleDetailsStatus: 'unavailable', ruleDetailsRevision: undefined });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

test.each(['ready', 'unavailable'] as const)('old %s cannot overwrite a newer private availability result', status => {
  const s = createControlSnapshotSession(), a = s.beginRequest(), b = s.beginRequest();
  const newer = status === 'ready' ? hidden() : make();
  s.integrate(newer, b);
  const result = s.integrate(status === 'ready' ? make() : hidden(), a);
  expect(result.ruleDetailsStatus).toBe(newer.ruleDetailsStatus);
  expect(result.rules[0].title).toBe(status === 'ready' ? undefined : 'new title');
});

test('unavailable retains the revision floor and a legitimate new generation recovers', () => {
  const s = createControlSnapshotSession();
  s.integrate(make(), s.beginRequest());
  const unavailable = s.integrate(hidden(), s.beginRequest());
  expect(unavailable.ruleDetailsRevision).toBe('10'); expect(unavailable.rules[0].title).toBeUndefined();
  const regressed = s.integrate(make('10', '9', 'old title'), s.beginRequest());
  expect(regressed.sequence).toBe('10'); expect(regressed.ruleDetailsStatus).toBe('unavailable');
  expect(regressed.ruleDetailsRevision).toBe('10');
  const recovered = s.integrate(make('10', '10', 'current title'), s.beginRequest());
  expect(recovered.ruleDetailsStatus).toBe('ready'); expect(recovered.rules[0].title).toBe('current title');
});

test('private and control are adopted independently in both directions', () => {
  const s = createControlSnapshotSession(), a = s.beginRequest(), b = s.beginRequest();
  s.integrate(make('9', '10'), b);
  const control = s.integrate({ ...make('10', '9', 'old title'), authorization: 'denied', observation: 'uncertain', targets: [{ ref, selectionRef: ref, restricted: true, unlockable: false }] }, a);
  expect(control).toMatchObject({ sequence: '10', authorization: 'denied', observation: 'uncertain', ruleDetailsRevision: '10' });
  expect(control.rules[0].title).toBe('new title'); expect(control.targets[0].restricted).toBe(true);
  const metadata = s.integrate(make('9', '11', 'newer title'), s.beginRequest());
  expect(metadata.sequence).toBe('10'); expect(metadata.observation).toBe('uncertain'); expect(metadata.rules[0].title).toBe('newer title');
});

test.each(['ready', 'unavailable'] as const)('old epoch %s cannot replace a recovered private result, but can advance control', status => {
  const s = createControlSnapshotSession();
  const initial = s.integrate(make(), s.beginRequest()), old = s.beginRequest();
  s.setActive(false);
  expect(s.getSnapshot()?.rules[0].title).toBeUndefined();
  s.setActive(true);
  // No response has arrived in the new epoch: even a late ready must stay hidden.
  const firstLate = s.integrate(make('10'), old);
  expect(firstLate.ruleDetailsStatus).toBe('unavailable'); expect(firstLate.ruleDetailsRevision).toBe('10');
  const recovered = s.integrate(make('10', '11', 'recovered'), s.beginRequest());
  const late = s.integrate(status === 'ready' ? make('12', '10', 'old') : hidden('12'), old);
  expect(late.sequence).toBe('12'); expect(late.rules[0].title).toBe('recovered');
  expect(currentControlSnapshot(late, initial).rules[0].title).toBe('recovered');
  expect(currentControlSnapshot(initial, recovered).rules[0].title).toBe('recovered');
});

test('explicit clear and deleted control rules cannot be undone by old private bodies', () => {
  const s = createControlSnapshotSession(), old = s.beginRequest();
  s.integrate({ ...make('10', '11'), rules: [{ ...make().rules[0], title: undefined, goal: undefined }] }, s.beginRequest());
  const cleared = s.integrate(make('11', '10', 'old title'), old);
  expect(cleared.rules[0].title).toBeUndefined(); expect(cleared.rules[0].goal).toBeUndefined();
  s.integrate({ ...make('12', '12'), rules: [] }, s.beginRequest());
  expect(s.integrate(make('11', '13'), s.beginRequest()).rules).toEqual([]);
});

test('legacy merge still protects independent revisions and hides unavailable text', () => {
  const result = currentControlSnapshot(make(), make('10', '9', 'old title'));
  expect(result.sequence).toBe('10'); expect(result.rules[0].title).toBe('new title');
  expect(currentControlSnapshot(make(), hidden()).rules[0].title).toBeUndefined();
});

test('Screen Time reads and onboarding mutations share request-start ordering and returned snapshots, including errors', async () => {
  const a = deferred<string>(), b = deferred<string>();
  const read = createScreenTimeClient('ios', () => ({ apiVersion: 1, screenTimeVersion: 1, screenTime: () => a.promise }));
  const mutation = createOnboardingClient('ios', () => ({ apiVersion: 1, onboardingVersion: 1, screenTime: () => b.promise }));
  const older = read.run('snapshot'), newer = mutation.run('onboardingCommit');
  b.resolve(JSON.stringify({ status: 'error', code: 'storage-failed', snapshot: hidden() }));
  expect((await newer).snapshot?.ruleDetailsStatus).toBe('unavailable');
  a.resolve(JSON.stringify({ status: 'ok', snapshot: make() }));
  const returned = await older;
  expect(returned.snapshot?.ruleDetailsStatus).toBe('unavailable'); expect(returned.snapshot?.rules[0].title).toBeUndefined();
});

test('wrapping a native client twice allocates one request, with no completion-order re-tagging', async () => {
  const a = deferred<ScreenTimeResponse>(), b = deferred<ScreenTimeResponse>();
  const raw = { run: jest.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise) };
  const client = withControlSnapshots(raw);
  expect(withControlSnapshots(client)).toBe(client); expect(withControlSnapshots(raw)).toBe(client);
  const old = client.run(), newer = client.run();
  b.resolve({ status: 'ok', impacts: [], snapshot: make() }); await newer;
  a.resolve({ status: 'error', impacts: [], snapshot: hidden() });
  expect((await old).snapshot?.rules[0].title).toBe('new title'); expect(raw.run).toHaveBeenCalledTimes(2);
});


test('same-sequence late control cannot replace newer authorization/observation or grants', () => {
  const s = createControlSnapshotSession(), a = s.beginRequest(), b = s.beginRequest();
  s.integrate({ ...make(), authorization: 'denied', observation: 'uncertain', targets: [] }, b);
  const late = s.integrate({ ...make(), authorization: 'approved', observation: 'applied', targets: [{ ref, selectionRef: ref, restricted: false, unlockable: true }] }, a);
  expect(late.authorization).toBe('denied'); expect(late.observation).toBe('uncertain'); expect(late.targets).toEqual([]);
});

test('even a first malformed unavailable snapshot strips title and goal', () => {
  const s = createControlSnapshotSession();
  const result = s.integrate(hidden(), s.beginRequest());
  expect(result.rules[0].title).toBeUndefined(); expect(result.rules[0].goal).toBeUndefined();
  expect(currentControlSnapshot(undefined, hidden()).rules[0].title).toBeUndefined();
});

test('a copied old ready snapshot has no request-start proof and cannot revive ordered unavailable text', () => {
  const s = createControlSnapshotSession();
  const original = s.integrate(make(), s.beginRequest());
  const unavailable = s.integrate(hidden(), s.beginRequest());
  const cloned = { ...original, sequence: '10', authorization: 'denied' as const };
  const merged = currentControlSnapshot(unavailable, cloned);
  expect(merged.sequence).toBe('10'); expect(merged.authorization).toBe('denied');
  expect(merged.ruleDetailsStatus).toBe('unavailable'); expect(merged.ruleDetailsRevision).toBe('10');
  expect(merged.rules[0].title).toBeUndefined(); expect(merged.rules[0].goal).toBeUndefined();
  expect(currentControlSnapshot(unavailable, original).ruleDetailsStatus).toBe('unavailable');
});

test.each(['ready', 'unavailable'] as const)('a late save acknowledgment advances the revision floor behind newer %s availability', async status => {
  const save = deferred<string>(), read = deferred<string>();
  const reply = (snapshot: ScreenTimeSnapshot) => JSON.stringify({ status: 'ok', snapshot });
  const native = jest.fn().mockResolvedValueOnce(reply(make('9', '2', 'revision two')))
    .mockReturnValueOnce(save.promise).mockReturnValueOnce(read.promise);
  const client = createScreenTimeClient('ios', () => ({ apiVersion: 1, screenTimeVersion: 1, screenTime: native }));
  await client.run('snapshot');
  // A starts its private mutation, but a later read B completes first.
  const acknowledgment = client.run('saveRuleDetails'), newer = client.run('snapshot');
  const newestControl = { ...(status === 'ready' ? make('10', '2', 'revision two') : hidden('10')), authorization: 'denied' as const, observation: 'uncertain' as const };
  read.resolve(reply(newestControl)); const newerSnapshot = (await newer).snapshot!;
  save.resolve(reply(make('9', '3', 'late revision three')));
  const late = (await acknowledgment).snapshot!;
  expect(late).toMatchObject({ sequence: '10', authorization: 'denied', observation: 'uncertain', ruleDetailsStatus: 'unavailable', ruleDetailsRevision: '3' });
  expect(late.rules[0].title).toBeUndefined(); expect(late.rules[0].goal).toBeUndefined();
  expect(currentControlSnapshot(late, newerSnapshot).ruleDetailsStatus).toBe('unavailable');
  expect(currentControlSnapshot(newerSnapshot, late).ruleDetailsRevision).toBe('3');
  // A new control read still advances control, but its rev2 body cannot cross the rev3 floor.
  native.mockResolvedValueOnce(reply({ ...make('11', '2', 'stale revision two'), targets: [{ ref, selectionRef: ref, restricted: true, unlockable: false }] }));
  const regressed = (await client.run('snapshot')).snapshot!;
  expect(regressed.sequence).toBe('11'); expect(regressed.targets[0].restricted).toBe(true);
  expect(regressed.ruleDetailsRevision).toBe('3'); expect(regressed.ruleDetailsStatus).toBe('unavailable'); expect(regressed.rules[0].title).toBeUndefined();
  // A legitimate current request recovers private rev3 while retaining newer control seq11.
  native.mockResolvedValueOnce(reply(make('10', '3', 'current revision three')));
  const recovered = (await client.run('snapshot')).snapshot!;
  expect(recovered.sequence).toBe('11'); expect(recovered.targets[0].restricted).toBe(true);
  expect(recovered.ruleDetailsStatus).toBe('ready'); expect(recovered.rules[0].title).toBe('current revision three');
});

test('an old epoch can reveal a higher revision without displaying its text or losing the new control half', () => {
  const s = createControlSnapshotSession();
  s.integrate(make('9', '2', 'revision two'), s.beginRequest());
  const old = s.beginRequest();
  s.setActive(false); s.setActive(true);
  s.integrate(make('10', '2', 'new-epoch revision two'), s.beginRequest());
  const late = s.integrate(make('11', '3', 'old-epoch revision three'), old);
  expect(late.sequence).toBe('11'); expect(late.ruleDetailsRevision).toBe('3');
  expect(late.ruleDetailsStatus).toBe('unavailable'); expect(late.rules[0].title).toBeUndefined();
  const regressed = s.integrate(make('12', '2', 'stale revision two'), s.beginRequest());
  expect(regressed.sequence).toBe('12'); expect(regressed.ruleDetailsRevision).toBe('3'); expect(regressed.ruleDetailsStatus).toBe('unavailable');
  const recovered = s.integrate(make('12', '3', 'current revision three'), s.beginRequest());
  expect(recovered.ruleDetailsStatus).toBe('ready'); expect(recovered.rules[0].title).toBe('current revision three');
});

test('a first late response from an invalidated epoch still establishes its durable revision floor', () => {
  const s = createControlSnapshotSession(), old = s.beginRequest();
  s.invalidatePrivate();
  const late = s.integrate(make('9', '3', 'old-epoch text'), old);
  expect(late.ruleDetailsRevision).toBe('3'); expect(late.ruleDetailsStatus).toBe('unavailable'); expect(late.rules[0].title).toBeUndefined();
  const regressed = s.integrate(make('10', '2', 'stale revision two'), s.beginRequest());
  expect(regressed.ruleDetailsRevision).toBe('3'); expect(regressed.ruleDetailsStatus).toBe('unavailable');
});
