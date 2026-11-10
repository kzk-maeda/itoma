import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { Applications } from '../src/components/flow/applications';
import { useVisibleClock } from '../src/hooks/use-visible-clock';
import { ScreenTimeProvider, useScreenTime } from '../src/state/screen-time';
import { unavailableSnapshot } from '../modules/itoma-native/src/screen-time';
import type { ScreenTimeAction, ScreenTimeResponse, ScreenTimeSnapshot } from '../modules/itoma-native';

jest.mock('../src/global.css', () => ({}));
jest.mock('../modules/itoma-native', () => ({ screenTime: { run: jest.fn() } }));
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }));
const mockNativeView = jest.fn(({ refreshKey }: { refreshKey: number }) => <Text testID="native-label-generation">{refreshKey}</Text>);
jest.mock('expo-modules-core', () => ({ requireNativeViewManager: () => mockNativeView }));
const selection = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', app = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const start = Date.parse('2026-11-09T21:30:00Z');

function Probe() {
  useVisibleClock();
  const state = useScreenTime(), target = state.snapshot?.targets[0];
  return <>
    {state.snapshot?.authorization === 'approved' && target && <Applications selectionRef={target.selectionRef} targetRef={target.ref} refreshKey={state.refreshKey} />}
    <Text testID="observed-at">{state.snapshot?.evaluatedAt}</Text>
    <Text testID="grant-deadline">{target?.grantEndsAt}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="read" onPress={() => { void state.refresh(); }} />
    <Pressable accessibilityRole="button" accessibilityLabel="reconcile" onPress={() => { void state.run('reconcile'); }} />
  </>;
}
function backend() {
  let snapshot: ScreenTimeSnapshot = { ...unavailableSnapshot('device'), storage: 'ready', authorization: 'approved', sequence: '1',
    selections: [{ ref: selection, count: 1 }], targets: [{ ref: app, selectionRef: selection, restricted: false, unlockable: false,
      grantStatus: 'active', grantCommandID: 'cccccccc-cccc-cccc-cccc-cccccccccccc', grantEndsAt: start / 1000 + 300 }] };
  const run = jest.fn(async (_action: ScreenTimeAction): Promise<ScreenTimeResponse> => ({ status: 'ok', impacts: [], snapshot: {
    ...snapshot, evaluatedAt: Date.now() / 1000, validUntil: Date.now() / 1000 + 120,
  } }));
  return { client: { run }, replace: (next: Partial<ScreenTimeSnapshot>) => { snapshot = { ...snapshot, ...next }; } };
}
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(start); mockNativeView.mockClear(); });
afterEach(() => { jest.useRealTimers(); });

test('15-second state checks continue without reloading unchanged native labels or extending the grant', async () => {
  const b = backend(), view = await render(<ScreenTimeProvider client={b.client}><Probe /></ScreenTimeProvider>);
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  const generation = screen.getByTestId('native-label-generation').props.children;
  const nativeRenders = mockNativeView.mock.calls.length;
  const initialReads = b.client.run.mock.calls.length;
  await act(async () => { await jest.advanceTimersByTimeAsync(45_000); });
  expect(b.client.run.mock.calls.length).toBeGreaterThanOrEqual(initialReads + 3);
  expect(b.client.run.mock.calls.every(([action]) => action === 'snapshot')).toBe(true);
  expect(screen.getByTestId('observed-at').props.children).toBe((start + 45_000) / 1000);
  expect(screen.getByTestId('native-label-generation').props.children).toBe(generation);
  expect(mockNativeView).toHaveBeenCalledTimes(nativeRenders);
  expect(screen.getByTestId('grant-deadline').props.children).toBe(start / 1000 + 300);
  await view.unmount();
  const readsAfterUnmount = b.client.run.mock.calls.length;
  await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
  expect(b.client.run).toHaveBeenCalledTimes(readsAfterUnmount);
});

test('changed selections and explicit reconciliation refresh labels; revoked authorization hides them', async () => {
  const b = backend(); await render(<ScreenTimeProvider client={b.client}><Probe /></ScreenTimeProvider>);
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  const generation = screen.getByTestId('native-label-generation').props.children;
  const next = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  b.replace({ selections: [{ ref: next, count: 1 }], targets: [{ ref: app, selectionRef: next, restricted: true, unlockable: true }] });
  await fireEvent.press(screen.getByRole('button', { name: 'read' }));
  expect(screen.getByTestId('native-label-generation').props.children).toBe(generation + 1);
  await fireEvent.press(screen.getByRole('button', { name: 'reconcile' }));
  expect(screen.getByTestId('native-label-generation').props.children).toBe(generation + 2);
  b.replace({ authorization: 'denied' });
  await fireEvent.press(screen.getByRole('button', { name: 'read' }));
  expect(screen.queryByTestId('native-label-generation')).toBeNull();
});
