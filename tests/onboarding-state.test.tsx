import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text, TextInput } from 'react-native';
import { OnboardingProvider, useOnboarding } from '../src/state/onboarding';
import { onboardingFixture } from './fixtures/onboarding';
import type { OnboardingAction, OnboardingRequest, OnboardingResponse } from '../modules/itoma-native/src/onboarding';
jest.mock('../modules/itoma-native', () => ({ onboardingRecords: { run: jest.fn() } }));
function Probe() {
  const s = useOnboarding();
  return <><TextInput accessibilityLabel="goal" value={s.draft?.goal ?? ''} onChangeText={goal => s.update({ goal })} />
    <Text testID="saved">{s.progress?.draft?.goal ?? 'none'}</Text><Text testID="saving">{String(s.saving)}</Text><Text testID="dirty">{String(s.dirty)}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="begin" onPress={() => { void s.run('onboardingBegin'); }} />
    <Pressable accessibilityRole="button" accessibilityLabel="flush" onPress={() => { void s.flush(); }} />
    <Pressable accessibilityRole="button" accessibilityLabel="refresh" onPress={() => { void s.refresh(); }} />
    <Pressable accessibilityRole="button" accessibilityLabel="discard" onPress={() => { void s.run('onboardingDiscard'); }} />
  </>;
}
test('a slow writer coalesces edits and its stale response never restores older text', async () => {
  const b = onboardingFixture(); let release!: () => void, writes = 0;
  const client = { run: async (action: OnboardingAction, request?: OnboardingRequest): Promise<OnboardingResponse> => {
    if (action === 'onboardingSave' && ++writes === 1) await new Promise<void>(resolve => { release = resolve; });
    return b.setup.run(action, request);
  } };
  await render(<OnboardingProvider client={client}><Probe /></OnboardingProvider>);
  await fireEvent.press(screen.getByLabelText('begin'));
  await fireEvent.changeText(screen.getByLabelText('goal'), '合成の古い入力'); await fireEvent.press(screen.getByLabelText('flush'));
  await waitFor(() => expect(release).toBeDefined());
  await fireEvent.changeText(screen.getByLabelText('goal'), '合成の新しい入力');
  await fireEvent.changeText(screen.getByLabelText('goal'), '合成の最新入力');
  await act(async () => release());
  await waitFor(() => expect(screen.getByTestId('saving').props.children).toBe('false'));
  expect(screen.getByLabelText('goal')).toHaveDisplayValue('合成の最新入力'); expect(b.progress().draft?.goal).toBe('合成の最新入力'); expect(writes).toBe(2);
});
test('an acknowledgement lost after private commit is recovered by a read before retry', async () => {
  const b = onboardingFixture(); let lost = true;
  const client = { run: async (action: OnboardingAction, request?: OnboardingRequest): Promise<OnboardingResponse> => {
    const result = await b.setup.run(action, request);
    if (action === 'onboardingSave' && lost) { lost = false; return { status: 'error', code: 'unavailable', impacts: [] }; }
    return result;
  } };
  await render(<OnboardingProvider client={client}><Probe /></OnboardingProvider>);
  await fireEvent.press(screen.getByLabelText('begin')); await fireEvent.changeText(screen.getByLabelText('goal'), '合成の入力');
  await fireEvent.press(screen.getByLabelText('flush'));
  await waitFor(() => expect(screen.getByTestId('saving').props.children).toBe('false'));
  await fireEvent.press(screen.getByLabelText('refresh'));
  await waitFor(() => expect(screen.getByTestId('saved').props.children).toBe('合成の入力'));
  await fireEvent.press(screen.getByLabelText('flush'));
  await waitFor(() => expect(screen.getByTestId('dirty').props.children).toBe('false'));
  expect(screen.getByLabelText('goal')).toHaveDisplayValue('合成の入力');
});
test('discard cancels a queued autosave so it cannot resurrect the draft later', async () => {
  const b = onboardingFixture(); await render(<OnboardingProvider client={b.setup}><Probe /></OnboardingProvider>);
  await fireEvent.press(screen.getByLabelText('begin')); await fireEvent.changeText(screen.getByLabelText('goal'), '合成の破棄入力');
  await fireEvent.press(screen.getByLabelText('discard'));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
  expect(b.progress().draft).toBeUndefined(); expect(b.setupActions).not.toContain('onboardingSave');
});
