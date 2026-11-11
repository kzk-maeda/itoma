import { createOnboardingClient, parseOnboardingResponse } from '../modules/itoma-native/src/onboarding';
const draft = { id: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', step: 'purpose', title: '', goal: '', weekdays: [], start: '', end: '', nextDay: false, submitted: false };
const response = { status: 'ok', onboarding: { revision: '18446744073709551615', seenIntro: true, completed: false, draft, selectionReady: false, canEdit: true } };
test('bounded allowlist preserves the full counter and drops native extras', () => {
  const parsed = parseOnboardingResponse(JSON.stringify({ ...response, rawToken: 'synthetic', onboarding: { ...response.onboarding, path: '/synthetic', draft: { ...draft, token: 'synthetic' } } }));
  expect(parsed.onboarding?.revision).toBe('18446744073709551615'); expect(parsed.onboarding?.draft?.id).toBe(draft.id.toLowerCase());
  expect(JSON.stringify(parsed)).not.toContain('synthetic');
  for (const change of [{ completed: true }, { revision: '18446744073709551616' }, { seenIntro: false }, { selectionReady: true }, { draft: { ...draft, goal: '🌙'.repeat(501) } }, { draft: { ...draft, weekdays: [1, 1] } }]) {
    expect(() => parseOnboardingResponse(JSON.stringify({ ...response, onboarding: { ...response.onboarding, ...change } }))).toThrow();
  }
});
test('older native builds and unsupported platforms cannot receive new onboarding actions', async () => {
  const screenTime = jest.fn(async () => JSON.stringify(response));
  const old = createOnboardingClient('ios', () => ({ apiVersion: 1, screenTime }));
  expect((await old.run('onboardingRead')).code).toBe('unavailable'); expect(screenTime).not.toHaveBeenCalled();
  expect((await createOnboardingClient('web', () => ({ apiVersion: 1, onboardingVersion: 1, screenTime })).run('onboardingRead')).code).toBe('unavailable');
  const client = createOnboardingClient('ios', () => ({ apiVersion: 1, onboardingVersion: 1, screenTime }));
  await client.run('onboardingDefer', { expectedRevision: '42' });
  expect(screenTime).toHaveBeenCalledWith('onboardingDefer', JSON.stringify({ onboarding: { expectedRevision: '42' } }));
});
