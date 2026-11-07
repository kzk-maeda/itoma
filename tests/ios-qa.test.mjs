import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertCleanSource, claimOutputDirectory, simulatorSpec, smokeOutcome, validatedCommit, validatedSimulatorID } from '../scripts/lib/ios-qa.mjs';

const commit = 'a'.repeat(40);
test('mutable refs and injected or incomplete identities are refused', () => {
  for (const value of ['main', 'abc123', `${commit}\n`, `$(id)${commit}`, 'A'.repeat(40), null]) {
    assert.throws(() => validatedCommit(value));
  }
  assert.equal(validatedCommit(commit), commit);
  assert.throws(() => validatedSimulatorID('booted'));
  assert.throws(() => validatedSimulatorID('all'));
  assert.throws(() => validatedSimulatorID('00000000-0000-0000-0000-000000000000;other'));
});

test('chooses the latest available iOS/type, never an existing user device identity', () => {
  const device = (type, available = true) => ({ deviceTypeIdentifier: `com.apple.CoreSimulator.SimDeviceType.${type}`, isAvailable: available, udid: 'existing-personal-device' });
  const result = simulatorSpec({ devices: {
    'com.apple.CoreSimulator.SimRuntime.tvOS-27-0': [device('Apple-TV')],
    'com.apple.CoreSimulator.SimRuntime.iOS-27-10': [device('iPhone-18-Pro', false)],
    'com.apple.CoreSimulator.SimRuntime.iOS-27-9': [device('iPad-Pro'), device('iPhone-18-Pro')],
    'com.apple.CoreSimulator.SimRuntime.iOS-26-6': [device('iPhone-17-Pro')],
  } });
  assert.deepEqual(result, { runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-27-9', deviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro' });
  assert.equal('udid' in result, false);
});

test('malformed/unavailable inventory does not fall back to booted or a personal simulator', () => {
  for (const inventory of [null, {}, { devices: [] }, { devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-6': [{ udid: 'existing', isAvailable: true }] } }]) {
    assert.throws(() => simulatorSpec(inventory));
  }
});

test('only this source commit can pass; explicit failure wins over an earlier pass', () => {
  assert.equal(smokeOutcome(`ITOMA_NATIVE_SMOKE_PASS:${'b'.repeat(40)}`, commit), 'pending');
  assert.equal(smokeOutcome(`ITOMA_NATIVE_SMOKE_PASS:${commit}bb`, commit), 'pending');
  assert.equal(smokeOutcome(`ITOMA_NATIVE_SMOKE_PASS:${commit}`, commit), 'pass');
  assert.equal(smokeOutcome(`ITOMA_NATIVE_SMOKE_PASS:${commit}\nITOMA_NATIVE_SMOKE_FAIL:${commit}`, commit), 'fail');
});

test('untracked build source cannot be attributed to a commit, while generated ignored folders are allowed', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'itoma-qa-source-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    git('init', '--quiet');
    writeFileSync(path.join(root, '.gitignore'), '/ios\n/node_modules\n');
    writeFileSync(path.join(root, 'source.swift'), '// synthetic tracked source\n');
    git('add', '.');
    git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=ITOMA QA', '-c', 'user.email=qa@example.invalid', 'commit', '--quiet', '-m', 'fixture');
    const sha = git('rev-parse', 'HEAD');
    mkdirSync(path.join(root, 'ios'));
    writeFileSync(path.join(root, 'ios', 'generated.swift'), '// generated\n');
    assert.equal(assertCleanSource(root, sha), sha);
    writeFileSync(path.join(root, 'extra.swift'), '// untracked compiled source\n');
    assert.throws(() => assertCleanSource(root, sha));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an output directory cannot be reused to pass from a previous run, and old logs are preserved', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'itoma-qa-output-'));
  const output = path.join(root, 'run');
  try {
    claimOutputDirectory(output);
    const marker = `ITOMA_NATIVE_SMOKE_PASS:${commit}`;
    writeFileSync(path.join(output, 'app.log'), marker);
    assert.throws(() => claimOutputDirectory(output));
    assert.equal(readFileSync(path.join(output, 'app.log'), 'utf8'), marker);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
