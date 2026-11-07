import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { annotationCommand, assertCleanSource, claimOutputDirectory, compilerDiagnostics, createQAReporter, passedSwiftTestCount, simulatorSpec, smokeOutcome, validatedCommit, validatedSimulatorID } from '../scripts/lib/ios-qa.mjs';

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

test('API compiler diagnostics are bounded and never publish signed URL queries', () => {
  const lines = compilerDiagnostics(`normal build output\nfile.swift:3: error: missing type\nerror: download https://user:secret@example.invalid/archive?sig=private-token\n${'error: another issue\n'.repeat(12)}`);
  assert.equal(lines.length, 8);
  const sensitive = compilerDiagnostics('error: download https://user:secret@example.invalid/archive?sig=private-token');
  assert.deepEqual(sensitive, ['error: download https://example.invalid/[url omitted]']);
  assert.equal(sensitive.join('').includes('secret'), false);
  assert.equal(sensitive.join('').includes('private-token'), false);
});

test('a compiler message cannot create another workflow annotation via newlines or percent escapes', () => {
  const result = annotationCommand('error', 'Compiler', 'failure%0A\r\n::notice::injected');
  assert.equal(result.includes('\n'), false);
  assert.equal(result.includes('\r'), false);
  assert.equal(result, '::error title=Compiler::failure%250A%0D%0A::notice::injected');
});

test('mixed-case URL schemes and valid URL punctuation cannot leave credential/query fragments', () => {
  for (const url of [
    'HTTPS://user:secret@example.invalid/archive?sig=private-token',
    "hTtPs://user:p'ass@example.invalid/archive?sig=private-token",
    "https://example.invalid/archive?sig=first'second",
    'https://example.invalid/archive?sig=first)second',
  ]) {
    assert.deepEqual(compilerDiagnostics(`error: download ${url}`), ['error: download https://example.invalid/[url omitted]']);
  }
});

test('XCTest zero-test success cannot substitute for a real Swift Testing result', () => {
  assert.throws(() => passedSwiftTestCount('Executed 0 tests, with 0 failures'));
  assert.throws(() => passedSwiftTestCount('Test run with 0 tests in 0 suites passed'));
  assert.throws(() => passedSwiftTestCount('Test run with 62 tests in 0 suites passed\nTest run with 85 tests in 0 suites failed'));
  assert.equal(passedSwiftTestCount('Executed 0 tests\n✔ Test run with 62 tests in 0 suites passed after 0.2 seconds.'), 62);
});

test('Simulator tool failures retain bounded context while signed URLs stay private', () => {
  const result = compilerDiagnostics('An error was encountered processing the command (domain=NSPOSIXErrorDomain, code=149)\nUnderlying error (domain=NSPOSIXErrorDomain, code=60)\nTimed out: https://user:credential@example.invalid/path?signature=private\nordinary tool output');
  assert.equal(result.length, 3);
  assert.match(result[0], /code=149/);
  assert.match(result[1], /code=60/);
  assert.equal(result[2], 'Timed out: https://example.invalid/[url omitted]');
  assert.ok(result.every((line) => !line.includes('credential') && !line.includes('private')));
});

function reportingRun({ failure, cleanup = 'pass', built = true, extras = {} } = {}) {
  const result = {
    requestedCommit: commit, sourceCommit: commit,
    nativeSourceCommit: built ? commit : null, jsSourceCommit: built ? commit : null,
    buildID: '12345-1', status: 'pass', stages: {}, ...extras,
  };
  const lines = [], records = [];
  const reporter = createQAReporter(result, {
    record: () => records.push(structuredClone(result)), log: (line) => lines.push(line),
  });
  for (let i = 0; i < 100; i++) reporter.checkpoint(`stage-${i}`);
  if (failure) reporter.fail(failure, `${'error: download HTTPS://user:secret@example.invalid/path?sig=private-token\n'.repeat(20)}error: ${'x'.repeat(2_000)}`);
  reporter.finish(cleanup);
  // Model the runner's per-step/type cap after decoding workflow command escapes.
  const annotations = { notice: [], error: [] };
  for (const line of lines) {
    assert.equal(line.includes('\n'), false);
    assert.equal(line.includes('\r'), false);
    const match = /^::(notice|error) title=[^\n]*?::(.*)$/.exec(line);
    if (!match) continue;
    const message = match[2].replaceAll('%0D', '\r').replaceAll('%0A', '\n').replaceAll('%25', '%');
    assert.ok(message.length <= 4_096, 'runner message size limit');
    if (annotations[match[1]].length < 10) annotations[match[1]].push(message);
  }
  assert.equal(annotations.notice.length, 1, 'one notice reserved for final result');
  assert.equal(records.length, 101);
  assert.equal(Object.keys(records.at(-1).stages).length, 100);
  assert.ok(records.at(-1).completedAt);
  assert.ok(lines.some((line) => line === 'iOS QA stage "stage-99": pass'));
  return { result, lines, records, annotations, summary: JSON.parse(annotations.notice[0]) };
}

test('many stages preserve the final successful result and complete stage history', () => {
  const { summary, annotations } = reportingRun();
  assert.equal(summary.status, 'pass');
  assert.equal(summary.cleanup, 'pass');
  assert.equal(summary.passedStages, 100);
  for (const key of ['sourceCommit', 'nativeSourceCommit', 'jsSourceCommit']) assert.equal(summary[key], commit);
  assert.equal(summary.buildID, '12345-1');
  assert.equal(annotations.error.length, 0);
});

test('tool failure retains identity, private URL redaction and eight bounded diagnostics', () => {
  const error = new Error('Tool failed %0A\r\n::notice::injected HTTPS://user:secret@example.invalid/file?sig=private-token');
  error.tool = { operation: 'xcodebuild', exitCode: 1, signal: null, code: null };
  const { summary, annotations, records } = reportingRun({ failure: error, built: false });
  assert.equal(summary.status, 'fail');
  assert.equal(summary.nativeSourceCommit, null);
  assert.equal(summary.jsSourceCommit, null);
  assert.equal(summary.buildID, '12345-1');
  assert.equal(annotations.error.length, 9);
  assert.ok(annotations.error.every((line) => line.length <= 1_200));
  assert.equal(JSON.stringify({ summary, annotations, records }).includes('private-token'), false);
  assert.equal(JSON.stringify({ summary, annotations, records }).includes('secret'), false);
  assert.deepEqual(records.at(-1).failedTool, error.tool);
});

test('cleanup failure overrides successful smoke in the final API result and JSON', () => {
  const { summary, records } = reportingRun({ cleanup: 'failed' });
  assert.equal(summary.status, 'fail');
  assert.equal(summary.cleanup, 'failed');
  assert.equal(summary.error, 'Created Simulator cleanup failed');
  assert.equal(records.at(-1).status, 'fail');
});

test('uncreated Simulator cleanup stays null and cannot promote a preflight failure', () => {
  const { summary } = reportingRun({ failure: new Error('preflight failed'), built: false, cleanup: null });
  assert.equal(summary.status, 'fail');
  assert.equal(summary.cleanup, null);
  assert.equal(summary.nativeSourceCommit, null);
  assert.equal(summary.jsSourceCommit, null);
});

test('future large metadata and escaped tool versions cannot truncate the final annotation', () => {
  const large = '\u0000\r\n%"\\'.repeat(2_000);
  const extras = Object.fromEntries(['xcode', 'swift', 'cocoaPods', 'configuration', 'sdk', 'signing', 'architecture', 'sdkVersion', 'workflowCommit', 'nativeConfigurationSHA256', 'jsBundleSHA256'].map((key) => [key, large]));
  extras.futureMetadata = large.repeat(10);
  extras.sharedSwiftTests = { core: 62, storage: 88, control: 80, future: large };
  const { summary, records } = reportingRun({ extras, failure: new Error(large) });
  assert.equal(summary.status, 'fail');
  assert.equal(summary.sourceCommit, commit);
  assert.equal(summary.buildID, '12345-1');
  assert.deepEqual(summary.sharedSwiftTests, { core: 62, storage: 88, control: 80 });
  assert.equal(summary.futureMetadata, undefined);
  assert.equal(records.at(-1).futureMetadata, extras.futureMetadata);
});
