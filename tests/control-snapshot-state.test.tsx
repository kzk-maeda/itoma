import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Text, type AppStateStatus } from 'react-native';
import { ScreenTimeProvider, useScreenTime } from '../src/state/screen-time';
import { OnboardingProvider, useOnboarding } from '../src/state/onboarding';
import { RuleDetailsScreen } from '../src/components/flow/rule-details';
import { controlSnapshots, currentControlSnapshot } from '../src/state/control-snapshot';
import { unavailableSnapshot, type ScreenTimeAction, type ScreenTimeResponse, type ScreenTimeSnapshot } from '../modules/itoma-native/src/screen-time';
import type { OnboardingResponse } from '../modules/itoma-native/src/onboarding';
import { onboardingFixture } from './fixtures/onboarding';
jest.mock('../src/global.css', () => ({}));
jest.mock('../modules/itoma-native', () => ({ screenTime: { run: jest.fn() }, onboardingRecords: { run: jest.fn() } }));
jest.mock('../src/components/flow/navigation', () => ({ back: jest.fn(), useDraftGuard: jest.fn() }));
const ref = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ready = (revision = '10', title = 'saved synthetic title', sequence = '9'): ScreenTimeSnapshot => ({ ...unavailableSnapshot('device'), storage: 'ready', sequence,
  ruleDetailsStatus: 'ready', ruleDetailsRevision: revision, authorization: 'approved',
  rules: [{ id: ref, selectionRef: ref, weekdays: [1], startMinute: 0, endMinute: 1, nextDay: false, enabled: true, title, goal: 'saved synthetic goal' }] });
const hidden = (): ScreenTimeSnapshot => ({ ...ready(), ruleDetailsStatus: 'unavailable', ruleDetailsRevision: undefined });
const response = (snapshot: ScreenTimeSnapshot): ScreenTimeResponse => ({ status: 'ok', impacts: [], snapshot });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const states = new Map<string, ReturnType<typeof useScreenTime>>();
let setup: ReturnType<typeof useOnboarding>;
function Probe({ id = 'a' }: { id?: string }) {
  const state = useScreenTime(); states.set(id, state);
  return <Text testID={id}>{state.snapshot?.rules[0]?.title ?? state.snapshot?.ruleDetailsStatus ?? 'loading'}</Text>;
}
function SetupProbe() { setup = useOnboarding(); return null; }

test('read and mutation from different Providers share state and sanitize returned snapshots while retaining drafts', async () => {
  const old = deferred<ScreenTimeResponse>(); let hold = false;
  const a = { run: async (): Promise<ScreenTimeResponse> => hold ? old.promise : response(ready()) };
  const b = { run: async (action: ScreenTimeAction): Promise<ScreenTimeResponse> => action === 'snapshot' ? response(ready()) : { status: 'error', code: 'storage-failed', impacts: [], snapshot: hidden() } };
  await render(<><ScreenTimeProvider client={a}><Probe /></ScreenTimeProvider><ScreenTimeProvider client={b}><Probe id="b" /></ScreenTimeProvider></>);
  await waitFor(() => expect(screen.getByTestId('a').props.children).toBe('saved synthetic title'));
  await act(async () => { states.get('a')!.setUnlockDraft({ reason: 'unsaved synthetic reason', minutes: '7' }); states.get('a')!.beginRule(ready().rules[0]); });
  hold = true;
  let pending!: Promise<ScreenTimeResponse>;
  await act(async () => { pending = states.get('a')!.refresh(); });
  await act(async () => { await states.get('b')!.run('saveRuleDetails'); });
  expect(screen.getByTestId('a').props.children).toBe('unavailable'); expect(screen.getByTestId('b').props.children).toBe('unavailable');
  let returned!: ScreenTimeResponse;
  await act(async () => { old.resolve(response(ready('10', 'old synthetic title', '10'))); returned = await pending; });
  expect(returned.snapshot?.ruleDetailsStatus).toBe('unavailable'); expect(returned.snapshot?.rules[0].title).toBeUndefined();
  expect(states.get('a')!.snapshot?.sequence).toBe('10'); expect(states.get('b')!.snapshot?.sequence).toBe('10');
  expect(states.get('a')!.unlockDraft).toEqual({ reason: 'unsaved synthetic reason', minutes: '7' }); expect(states.get('a')!.ruleDraft?.id).toBe(ref);
});

test('a late unavailable mutation cannot hide a newer successful read, including its direct return', async () => {
  const old = deferred<ScreenTimeResponse>(); let reads = 0;
  const client = { run: async (action: ScreenTimeAction): Promise<ScreenTimeResponse> => action !== 'snapshot' ? old.promise : response(++reads === 1 ? ready() : ready('11', 'new synthetic title')) };
  await render(<ScreenTimeProvider client={client}><Probe /></ScreenTimeProvider>);
  await waitFor(() => expect(screen.getByTestId('a').props.children).toBe('saved synthetic title'));
  let pending!: Promise<ScreenTimeResponse>;
  await act(async () => { pending = states.get('a')!.run('saveRuleDetails'); });
  await act(async () => { await states.get('a')!.refresh(); });
  let returned!: ScreenTimeResponse;
  await act(async () => { old.resolve({ status: 'error', code: 'storage-failed', impacts: [], snapshot: hidden() }); returned = await pending; });
  expect(returned.snapshot?.rules[0].title).toBe('new synthetic title'); expect(screen.getByTestId('a').props.children).toBe('new synthetic title');
});

test('one lifecycle epoch invalidates all consumers immediately and foreground starts a fresh read without joining an old one', async () => {
  let emit!: (state: AppStateStatus) => void;
  const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { emit = callback; return { remove: jest.fn() }; });
  listener.mockClear();
  const old = deferred<ScreenTimeResponse>(), fresh = deferred<ScreenTimeResponse>(); let reads = 0;
  const client = { run: async (): Promise<ScreenTimeResponse> => ++reads === 1 ? response(ready()) : reads === 2 ? old.promise : fresh.promise };
  const fixture = onboardingFixture();
  const onboarding = { run: async (): Promise<OnboardingResponse> => ({ ...(await fixture.setup.run('onboardingRead')), snapshot: ready() }) };
  await render(<ScreenTimeProvider client={client}><OnboardingProvider client={onboarding}><Probe /><SetupProbe /></OnboardingProvider></ScreenTimeProvider>);
  await waitFor(() => expect(screen.getByTestId('a').props.children).toBe('saved synthetic title'));
  const savedResult = states.get('a')!.snapshot!;
  let pending!: Promise<ScreenTimeResponse>;
  await act(async () => { pending = states.get('a')!.refresh(); });
  const before = controlSnapshots.getEpoch();
  await act(async () => { emit('inactive'); });
  expect(controlSnapshots.getEpoch()).toBe(before + 1); expect(screen.getByTestId('a').props.children).toBe('unavailable');
  expect(currentControlSnapshot(states.get('a')!.snapshot, savedResult).rules[0].title).toBeUndefined();
  await act(async () => { emit('active'); });
  expect(reads).toBe(3); expect(controlSnapshots.getEpoch()).toBe(before + 2);
  await act(async () => { fresh.resolve(response(ready('11', 'recovered synthetic title'))); });
  await waitFor(() => expect(screen.getByTestId('a').props.children).toBe('recovered synthetic title'));
  await act(async () => { old.resolve(response(ready('10', 'old title', '10'))); await pending; });
  expect(screen.getByTestId('a').props.children).toBe('recovered synthetic title'); expect(states.get('a')!.snapshot?.sequence).toBe('10');
  expect(listener).toHaveBeenCalledTimes(1);
  listener.mockRestore();
});

test('onboarding returned resultSnapshots use the shared private ordering with Screen Time', async () => {
  const old = deferred<OnboardingResponse>(), fixture = onboardingFixture(); let hold = false;
  const onboarding = { run: async (): Promise<OnboardingResponse> => hold ? old.promise : { ...(await fixture.setup.run('onboardingRead')), snapshot: ready() } };
  const control = { run: async (): Promise<ScreenTimeResponse> => response(hidden()) };
  await render(<ScreenTimeProvider client={control}><OnboardingProvider client={onboarding}><Probe /><SetupProbe /></OnboardingProvider></ScreenTimeProvider>);
  await waitFor(() => expect(setup.loading).toBe(false));
  hold = true; let pending!: Promise<OnboardingResponse>;
  await act(async () => { pending = setup.refresh(); });
  await act(async () => { await states.get('a')!.refresh(); });
  let returned!: OnboardingResponse;
  await act(async () => { old.resolve({ status: 'ok', impacts: [], snapshot: ready() }); returned = await pending; });
  expect(returned.snapshot?.ruleDetailsStatus).toBe('unavailable'); expect(returned.snapshot?.rules[0].goal).toBeUndefined();
});

test('a private save error hides saved text while preserving the person’s RAM editor input', async () => {
  const client = { run: async (action: ScreenTimeAction): Promise<ScreenTimeResponse> => action === 'snapshot' ? response(ready()) : { status: 'error', code: 'storage-failed', impacts: [], snapshot: hidden() } };
  await render(<ScreenTimeProvider client={client}><RuleDetailsScreen ruleID={ref} /><Probe /></ScreenTimeProvider>);
  await waitFor(() => expect(screen.getByLabelText('ルール名（任意）')).toHaveDisplayValue('saved synthetic title'));
  await fireEvent.changeText(screen.getByLabelText('ルール名（任意）'), 'unsaved synthetic title');
  await fireEvent.changeText(screen.getByLabelText('行動目標（任意）'), 'unsaved synthetic goal');
  await fireEvent.press(screen.getByRole('button', { name: '保存する' }));
  await waitFor(() => expect(screen.getByTestId('a').props.children).toBe('unavailable'));
  expect(screen.getByLabelText('ルール名（任意）')).toHaveDisplayValue('unsaved synthetic title');
  expect(screen.getByLabelText('行動目標（任意）')).toHaveDisplayValue('unsaved synthetic goal');
  expect(screen.getByText('保存した内容を読み取れません')).toBeOnTheScreen();
});

test('a Provider remount retains revision protection and rejects the previous lifetime’s pending read', async () => {
  const old = deferred<ScreenTimeResponse>(); let reads = 0;
  const client = { run: async (): Promise<ScreenTimeResponse> => ++reads === 1 ? response(ready()) : reads === 2 ? old.promise : response(ready('10', 'recovered after remount')) };
  const first = await render(<ScreenTimeProvider client={client}><Probe /></ScreenTimeProvider>);
  await waitFor(() => expect(screen.getByTestId('a').props.children).toBe('saved synthetic title'));
  let pending!: Promise<ScreenTimeResponse>;
  await act(async () => { pending = states.get('a')!.refresh(); });
  await first.unmount();
  expect(controlSnapshots.getSnapshot()?.ruleDetailsStatus).toBe('unavailable');
  expect(controlSnapshots.getSnapshot()?.ruleDetailsRevision).toBe('10');
  await render(<ScreenTimeProvider client={client}><Probe /></ScreenTimeProvider>);
  await waitFor(() => expect(screen.getByTestId('a').props.children).toBe('recovered after remount'));
  await act(async () => { old.resolve(response(ready('9', 'old lifetime', '10'))); await pending; });
  expect(screen.getByTestId('a').props.children).toBe('recovered after remount');
  expect(states.get('a')!.snapshot?.sequence).toBe('10');
});

test('the latest saved-content panel hides on unavailability and recovers current text without erasing the editor draft', async () => {
  let next = ready();
  const client = { run: async (): Promise<ScreenTimeResponse> => response(next) };
  await render(<ScreenTimeProvider client={client}><RuleDetailsScreen ruleID={ref} /><Probe /></ScreenTimeProvider>);
  await waitFor(() => expect(screen.getByLabelText('ルール名（任意）')).toHaveDisplayValue('saved synthetic title'));
  await fireEvent.changeText(screen.getByLabelText('ルール名（任意）'), 'unsaved synthetic title');
  await fireEvent.press(screen.getByRole('button', { name: '最新の保存内容を確認する' }));
  expect(screen.getByText('現在保存されている内容')).toBeOnTheScreen();
  next = hidden();
  await act(async () => { await states.get('a')!.refresh(); });
  expect(screen.queryByText('現在保存されている内容')).toBeNull();
  expect(screen.getByLabelText('ルール名（任意）')).toHaveDisplayValue('unsaved synthetic title');
  next = ready('11', 'fresh saved synthetic title');
  await act(async () => { await states.get('a')!.refresh(); });
  expect(screen.getByText('現在保存されている内容')).toBeOnTheScreen();
  expect(screen.getAllByText('fresh saved synthetic title')).toHaveLength(2);
  expect(screen.queryByText('saved synthetic title')).toBeNull();
  expect(screen.getByLabelText('ルール名（任意）')).toHaveDisplayValue('unsaved synthetic title');
});

test.each([null, 'unknown', 'extension'] as const)('initial AppState %s accepts control but waits for confirmed active before exposing private text', async initial => {
  const currentState = jest.replaceProperty(AppState, 'currentState', initial as AppStateStatus);
  let emit!: (state: AppStateStatus) => void;
  const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { emit = callback; return { remove: jest.fn() }; });
  let reads = 0;
  const client = { run: async (): Promise<ScreenTimeResponse> => response(++reads === 1 ? ready('10', 'initial private text', '9') : ready('10', 'confirmed active text', '10')) };
  const view = await render(<ScreenTimeProvider client={client}><Probe /></ScreenTimeProvider>);
  try {
    await waitFor(() => expect(states.get('a')!.loading).toBe(false));
    expect(reads).toBe(1);
    expect(states.get('a')!.snapshot).toMatchObject({ sequence: '9', authorization: 'approved', ruleDetailsStatus: 'unavailable', ruleDetailsRevision: '10' });
    expect(states.get('a')!.snapshot?.rules[0].title).toBeUndefined();
    expect(states.get('a')!.snapshot?.rules[0].goal).toBeUndefined();
    expect(screen.getByTestId('a').props.children).toBe('unavailable');
    await act(async () => { emit('active'); });
    await waitFor(() => expect(screen.getByTestId('a').props.children).toBe('confirmed active text'));
    expect(reads).toBe(2); expect(states.get('a')!.snapshot?.sequence).toBe('10');
  } finally {
    await view.unmount(); currentState.restore(); listener.mockRestore();
  }
});

test('an unknown-state remount rejects previous-lifetime text and waits for a fresh active read', async () => {
  const currentState = jest.replaceProperty(AppState, 'currentState', 'active');
  let emit!: (state: AppStateStatus) => void;
  const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { emit = callback; return { remove: jest.fn() }; });
  const old = deferred<ScreenTimeResponse>(); let reads = 0;
  const client = { run: async (): Promise<ScreenTimeResponse> => {
    reads += 1;
    if (reads === 2) return old.promise;
    return response(reads === 1 ? ready() : reads === 3 ? ready('10', 'unconfirmed remount text', '10') : ready('10', 'confirmed remount text', '12'));
  } };
  const first = await render(<ScreenTimeProvider client={client}><Probe /></ScreenTimeProvider>);
  let second: Awaited<ReturnType<typeof render>> | undefined;
  try {
    await waitFor(() => expect(screen.getByTestId('a').props.children).toBe('saved synthetic title'));
    let pending!: Promise<ScreenTimeResponse>;
    await act(async () => { pending = states.get('a')!.refresh(); });
    await first.unmount();
    currentState.replaceValue('unknown');
    second = await render(<ScreenTimeProvider client={client}><Probe /></ScreenTimeProvider>);
    await waitFor(() => expect(states.get('a')!.loading).toBe(false));
    expect(states.get('a')!.snapshot).toMatchObject({ sequence: '10', ruleDetailsStatus: 'unavailable', ruleDetailsRevision: '10' });
    let returned!: ScreenTimeResponse;
    await act(async () => { old.resolve(response(ready('10', 'previous lifetime text', '11'))); returned = await pending; });
    expect(returned.snapshot?.sequence).toBe('11'); expect(returned.snapshot?.rules[0].title).toBeUndefined();
    expect(screen.getByTestId('a').props.children).toBe('unavailable');
    await act(async () => { emit('active'); });
    await waitFor(() => expect(screen.getByTestId('a').props.children).toBe('confirmed remount text'));
    expect(reads).toBe(4); expect(states.get('a')!.snapshot?.sequence).toBe('12');
  } finally {
    await second?.unmount(); await first.unmount(); currentState.restore(); listener.mockRestore();
  }
});
