export function validatedCommit(value) {
  if (typeof value !== 'string' || value.length !== 40 || !/^[0-9a-f]{40}$/.test(value)) throw new Error('A full lowercase commit SHA is required');
  return value;
}

export function validatedSimulatorID(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$/.test(id)) throw new Error('Invalid created Simulator identity');
  return id;
}

export function assertCleanSource(root, commit) {
  validatedCommit(commit);
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  if (git(['rev-parse', 'HEAD']) !== commit) throw new Error('Checkout does not match requested source commit');
  if (git(['status', '--porcelain'])) throw new Error('Tracked and nonignored untracked source must be clean');
  return commit;
}

/** Atomic claim: never append a new run to an old result/log directory, even in another worktree. */
export function claimOutputDirectory(directory) {
  if (/[\r\n\0]/.test(directory)) throw new Error('Invalid QA output path');
  mkdirSync(path.dirname(directory), { recursive: true });
  mkdirSync(directory); // EEXIST also refuses empty/symlink paths and simultaneous reuse.
}

/** Discover a compatible type/runtime, then create a NEW device. Never use an existing UDID. */
export function simulatorSpec(payload) {
  if (!payload || typeof payload.devices !== 'object' || !payload.devices) throw new Error('Invalid Simulator inventory');
  const runtimes = Object.keys(payload.devices)
    .filter((id) => /^com\.apple\.CoreSimulator\.SimRuntime\.iOS-\d+(?:-\d+)*$/.test(id))
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  for (const runtime of runtimes) {
    const devices = payload.devices[runtime];
    if (!Array.isArray(devices)) continue;
    const device = devices.find((candidate) => candidate?.isAvailable === true
      && typeof candidate.deviceTypeIdentifier === 'string'
      && /^com\.apple\.CoreSimulator\.SimDeviceType\.iPhone-[A-Za-z0-9-]+$/.test(candidate.deviceTypeIdentifier));
    if (device) return { runtime, deviceType: device.deviceTypeIdentifier };
  }
  throw new Error('Install an iOS Simulator runtime with an available iPhone type in Xcode');
}

export function smokeOutcome(log, commit) {
  validatedCommit(commit);
  if (new RegExp(`(?:^|\\s)ITOMA_NATIVE_SMOKE_FAIL:${commit}(?=\\s|$)`).test(log)) return 'fail';
  if (new RegExp(`(?:^|\\s)ITOMA_NATIVE_SMOKE_PASS:${commit}(?=\\s|$)`).test(log)) return 'pass';
  return 'pending';
}

/** Small compiler/test/Simulator diagnostics, with URL capabilities omitted from API-visible annotations. */
export function compilerDiagnostics(log) {
  return log.split(/\r?\n/)
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, ''))
    .filter((line) => /error:|^✘|^\*\* .*FAILED|^Error:|\[!\]|^An error was encountered|^Underlying error|^Timed out|^Failed to|^Error Domain=/i.test(line))
    .slice(-8)
    .map((line) => omitURLs(line).slice(0, 1_200));
}

function omitURLs(value) {
  return String(value).replace(/https?:\/\/\S+/gi, (url) => {
    try { return `${new URL(url).origin}/[url omitted]`; } catch { return '[url omitted]'; }
  });
}

/** One final notice per run; stage count and future result fields cannot exhaust runner limits. */
export function createQAReporter(result, { record, log = console.log }) {
  return {
    checkpoint(stage) {
      result.stages[stage] = 'pass'; record();
      log(`iOS QA stage ${JSON.stringify(stage)}: pass`);
    },
    fail(error, toolLog = '') {
      result.status = 'fail'; result.error = omitURLs(error.message).slice(0, 1_200);
      if (error.tool) result.failedTool = error.tool;
      log(annotationCommand('error', 'iOS QA', result.error));
      for (const line of compilerDiagnostics(toolLog)) {
        log(annotationCommand('error', 'Compiler/test diagnostic', line));
      }
    },
    finish(cleanup) {
      if (cleanup !== undefined) result.cleanup = cleanup;
      if (cleanup === 'failed') {
        result.status = 'fail'; result.error ??= 'Created Simulator cleanup failed';
      }
      result.completedAt = new Date().toISOString(); record();
      log(annotationCommand('notice', 'iOS QA result', JSON.stringify(qaResultSummary(result))));
    },
  };
}

/** Fixed field/length budget keeps the decoded message below the runner's 4096-character cap.
 * Complete metadata and stage history remain in result.json, including fields added later.
 */
function qaResultSummary(result) {
  const summary = {};
  const bounded = (value, limit) => {
    if (value == null) return null;
    const text = omitURLs(value);
    let end = Math.min(text.length, limit);
    // JSON escaping of control characters must fit the same budget as ordinary text.
    while (JSON.stringify(text.slice(0, end)).length > limit + 2) end--;
    return text.slice(0, end);
  };
  const fields = {
    requestedCommit: 40, sourceCommit: 40, nativeSourceCommit: 40, jsSourceCommit: 40,
    buildID: 100, workflowCommit: 40, status: 16, cleanup: 16,
    configuration: 32, sdk: 32, signing: 16, architecture: 16, sdkVersion: 32,
    nativeConfigurationSHA256: 64, jsBundleSHA256: 64,
    xcode: 160, swift: 240, cocoaPods: 32,
  };
  for (const [field, limit] of Object.entries(fields)) {
    summary[field] = bounded(result[field], limit);
  }
  summary.passedStages = Object.values(result.stages).filter((status) => status === 'pass').length;
  summary.sharedSwiftTests = Object.fromEntries(['core', 'storage', 'control'].map((name) => [
    name, Number.isSafeInteger(result.sharedSwiftTests?.[name]) ? result.sharedSwiftTests[name] : null,
  ]));
  summary.error = bounded(result.error, 600);
  summary.details = 'Full stages, tool context and metadata: artifact result.json';
  return summary;
}

export function annotationCommand(level, title, message) {
  if (!['notice', 'error'].includes(level)) throw new Error('Invalid annotation level');
  const escape = (value) => String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  return `::${level} title=${escape(title)}::${escape(message)}`;
}

export function passedSwiftTestCount(log) {
  const summaries = [...log.replace(/\u001b\[[0-9;]*m/g, '').matchAll(/Test run with (\d+) tests[^\n]*?\b(passed|failed)\b/g)];
  const last = summaries.at(-1);
  if (!last || Number(last[1]) < 1 || last[2] !== 'passed') throw new Error('A nonzero passing Swift Testing run is required');
  return Number(last[1]);
}
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

