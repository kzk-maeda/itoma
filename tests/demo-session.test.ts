import { createDemoSession, demoApplications, readDemoScenario } from '../src/demo/session';

let clock: number;
beforeEach(() => { clock = Date.parse('2026-11-15T12:30:00Z'); });
const make = () => createDemoSession({ now: () => clock });
const preview = (session: ReturnType<typeof make>, target = demoApplications[0].ref) => session.clients.screenTime.run('previewUnlock', { targetRef: target, reason: '連絡を確認するため。', minutes: 5 });

test('scenario parsing is bounded and ports return contract-parsed data', async () => {
  expect(readDemoScenario('arbitrary')).toBe('normal');
  for (const scenario of ['normal', 'uncertain', 'paused', 'denied'] as const) {
    const session = createDemoSession({ scenario, now: () => clock });
    const value = await session.clients.screenTime.run('snapshot');
    expect(value.snapshot?.rules[0].title).toBe('自分の時間');
    expect(value.snapshot?.availability).toBe('device'); // Synthetic device capabilities, always labelled by the host.
    expect(value.snapshot?.targets.every(t => t.unlockable)).toBe(scenario === 'normal');
    expect((await session.clients.onboarding.run('onboardingRead')).onboarding?.completed).toBe(true);
    expect((await session.clients.reflection.run('read', { period: 'week', day: '' })).storage).toBe('not-created');
  }
});

test('confirmation pins expiry, duplicate acceptance is idempotent and apps stay independent', async () => {
  const session = make(), first = await preview(session);
  clock += 60_000;
  const accepted = await session.clients.screenTime.run('unlock', { ref: first.ref, reason: '連絡を確認するため。' });
  expect(accepted.snapshot?.targets[0].grantEndsAt).toBe(first.previewEndsAt);
  expect(accepted.snapshot?.targets[1].restricted).toBe(true);
  expect((await session.clients.screenTime.run('unlock', { ref: first.ref, reason: '連絡を確認するため。' })).ref).toBe(accepted.ref);
  const second = await preview(session, demoApplications[1].ref);
  await session.clients.screenTime.run('unlock', { ref: second.ref, reason: '連絡を確認するため。' });
  const page = await session.clients.history.run('page');
  expect(page.page?.rows).toHaveLength(2);
  const ended = await session.clients.screenTime.run('endGrant', { ref: accepted.ref });
  expect(ended.snapshot?.targets[0].grantStatus).toBe('reblockPending');
  expect(ended.snapshot?.targets[1].grantStatus).toBe('active');
});

test('cancel and expired preview never save a reason; expired grant is not OS success', async () => {
  const session = make(), first = await preview(session);
  expect((await session.clients.screenTime.run('cancelUnlock')).status).toBe('ok');
  expect((await session.clients.history.run('page')).page?.rows).toHaveLength(0);
  expect((await session.clients.screenTime.run('unlock', { ref: first.ref, reason: '連絡を確認するため。' })).code).toBe('changed');
  const second = await preview(session);
  clock += 6 * 60_000;
  expect((await session.clients.screenTime.run('unlock', { ref: second.ref, reason: '連絡を確認するため。' })).code).toBe('changed');
  const third = await preview(session);
  await session.clients.screenTime.run('unlock', { ref: third.ref, reason: '連絡を確認するため。' });
  clock += 6 * 60_000;
  const expired = await session.clients.screenTime.run('snapshot');
  expect(expired.snapshot?.targets[0].grantStatus).toBe('reblockPending');
  expect(expired.snapshot?.observation).toBe('uncertain');
});

test('failed and uncertain commands retain accurate result and private reason state', async () => {
  for (const outcome of ['schedule-failed', 'uncertain'] as const) {
    const session = make(); session.setOutcome(outcome);
    const first = await preview(session), request = { ref: first.ref, reason: '連絡を確認するため。' };
    const result = await session.clients.screenTime.run('unlock', request);
    expect(result.status).toBe('error');
    expect((await session.clients.screenTime.run('unlock', request)).status).toBe('error');
    const row = (await session.clients.history.run('page')).page!.rows[0];
    expect((await session.clients.history.run('reason', { commandID: row.commandID })).reason?.state).toBe(outcome === 'schedule-failed' ? 'prepared-only' : 'shared-accepted');
    expect(result.snapshot?.targets[0].grantStatus).toBe(outcome === 'schedule-failed' ? undefined : 'uncertain');
    await session.clients.history.run('deleteReasons');
    expect((await session.clients.history.run('reason', { commandID: row.commandID })).reason).toMatchObject({ state: 'deleted' });
    expect((await session.clients.history.run('reason', { commandID: row.commandID })).reason?.body).toBeUndefined();
  }
});

test('unsupported writes fail rather than claiming a saved rule; sessions isolate reasons', async () => {
  const session = make();
  expect((await session.clients.screenTime.run('commitRule')).status).toBe('error');
  expect((await session.clients.onboarding.run('onboardingBegin')).status).toBe('error');
  expect((await session.clients.screenTime.run('pickApplications')).status).toBe('error');
  const first = await preview(session);
  await session.clients.screenTime.run('unlock', { ref: first.ref, reason: '連絡を確認するため。' });
  expect((await make().clients.history.run('page')).page?.rows).toHaveLength(0);
  await session.clients.reflection.run('deleteAll');
  expect((await session.clients.history.run('page')).page?.rows).toHaveLength(0);
  expect((await session.clients.screenTime.run('snapshot')).snapshot?.targets[0].grantStatus).toBe('active');
});
