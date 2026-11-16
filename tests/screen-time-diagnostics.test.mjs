import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { sanitizeScreenTimeDiagnostic } from '../scripts/lib/screen-time-diagnostics.mjs';

const sample = (overrides = {}) => ({
  subsystem: 'com.itoma.screentime', category: 'lifecycle', timestamp: '2026-11-16 22:30:03.209090+0900',
  eventMessage: 'v=1 role=extension stage=authorizationRead activity=none ended=0 auth=notDetermined result=enabled failure=none main=0 count=-1 revision=-1 minute=-1 elapsed_ms=-1',
  processID: 123, ...overrides,
});
test('separates cold unknown, explicit denial, approval and callback milestones', () => {
  for (const auth of ['notDetermined', 'denied', 'approved', 'unrecognized']) {
    const raw = sample(); raw.eventMessage = raw.eventMessage.replace('auth=notDetermined', `auth=${auth}`);
    assert.equal(sanitizeScreenTimeDiagnostic(raw).auth, auth);
  }
  for (const stage of ['callbackEntry', 'actorEntry', 'runtimeOpen', 'serviceReady', 'reconciliationResult', 'callbackError', 'callbackExit']) {
    const raw = sample(); raw.eventMessage = raw.eventMessage.replace('stage=authorizationRead', `stage=${stage}`);
    assert.equal(sanitizeScreenTimeDiagnostic(raw).stage, stage);
  }
  assert.equal(sanitizeScreenTimeDiagnostic(sample()).timestamp, '2026-11-16T13:30:03.209Z');
});
test('never exports incidental private metadata, text or paths from an OS entry', () => {
  const raw = sample({ reason: 'PRIVATE_REASON', formatString: 'PRIVATE_TOKEN', processImagePath: '/private/path', senderImageUUID: 'not-a-uuid' });
  const safe = sanitizeScreenTimeDiagnostic(raw);
  assert.equal(safe.main, false);
  assert.equal(safe.processID, 123);
  assert.doesNotMatch(JSON.stringify(safe), /PRIVATE|private|uuid/);
});
test('rejects unrelated entries, extra text, unknown enums and malformed numeric fields', () => {
  assert.equal(sanitizeScreenTimeDiagnostic(sample({ subsystem: 'other' })), null);
  assert.equal(sanitizeScreenTimeDiagnostic(sample({ timestamp: 'bad' })), null);
  for (const suffix of [' secret=PRIVATE_REASON', '\nPRIVATE_TOKEN', ' ']) {
    assert.equal(sanitizeScreenTimeDiagnostic(sample({ eventMessage: sample().eventMessage + suffix })), null);
  }
  for (const [before, after] of [['auth=notDetermined', 'auth=PRIVATE_REASON'], ['count=-1', 'count=NaN'], ['minute=-1', 'minute=1440'], ['revision=-1', 'revision=9999999999999999']]) {
    assert.equal(sanitizeScreenTimeDiagnostic(sample({ eventMessage: sample().eventMessage.replace(before, after) })), null);
  }
});
test('CLI ignores malformed input and outputs only approved entries', () => {
  const result = spawnSync(process.execPath, ['scripts/sanitize-screen-time-log.mjs'], {
    input: `invalid\n${JSON.stringify(sample({ subsystem: 'other' }))}\n${JSON.stringify(sample({ reason: 'PRIVATE_REASON' }))}\n`, encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim().split('\n').length, 1);
  assert.doesNotMatch(result.stdout, /PRIVATE_REASON|eventMessage/);
});
