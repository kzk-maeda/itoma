import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { annotationCommand, assertCleanSource, claimOutputDirectory, compilerDiagnostics, passedSwiftTestCount, simulatorSpec, smokeOutcome, validatedCommit, validatedSimulatorID } from './lib/ios-qa.mjs';

if (process.platform !== 'darwin') throw new Error('iOS QA requires macOS/Xcode');
const root = process.cwd();
const commit = validatedCommit(process.env.ITOMA_QA_COMMIT);
const output = path.resolve(process.env.ITOMA_IOS_QA_OUTPUT ?? path.join(tmpdir(), `itoma-ios-qa-${randomUUID()}`));
claimOutputDirectory(output);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `artifact_dir=${output}\n`);
const result = {
  requestedCommit: commit, sourceCommit: null, nativeSourceCommit: null, jsSourceCommit: null,
  buildID: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}` : randomUUID(),
  workflowCommit: process.env.GITHUB_WORKFLOW_SHA ?? null,
  configuration: 'Release', sdk: 'iphonesimulator', signing: 'disabled',
  coverage: 'JS-to-Swift Core bridge; Screen Time and product OS adapters unconnected',
  stages: {}, startedAt: new Date().toISOString(),
};
let simulatorID, launcher, launchLog;
const record = () => writeFileSync(path.join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
function toolFailure(command, args, log, call) {
  // The operation name is fixed by this script; never include paths, UDIDs or complete argv.
  const operation = command === 'xcrun' && args[0] === 'simctl' ? `xcrun simctl ${args[1]}` : command;
  const status = call.error?.code ?? call.signal ?? call.status ?? 'unknown';
  const error = new Error(`${operation} failed (${status}); see ${log}`);
  error.logFile = log;
  error.tool = { operation, exitCode: call.status, signal: call.signal, code: call.error?.code ?? null };
  return error;
}

function run(command, args, { log = 'tools.log', timeout = 180_000, env = process.env, logStdout = true } = {}) {
  const fd = openSync(path.join(output, log), 'a');
  try {
    const call = spawnSync(command, args, { cwd: root, env, timeout, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', fd] });
    if (call.stdout && logStdout) writeFileSync(fd, call.stdout);
    if (call.error || call.status !== 0) throw toolFailure(command, args, log, call);
    return call.stdout.trim();
  } finally { closeSync(fd); }
}

function build(command, args, log, timeout, { cwd = root } = {}) {
  const fd = openSync(path.join(output, log), 'a');
  try {
    const call = spawnSync(command, args, { cwd, env: process.env, timeout, stdio: ['ignore', fd, fd] });
    if (call.error || call.status !== 0) throw toolFailure(command, args, log, call);
  } finally { closeSync(fd); }
}

function checkpoint(stage) {
  result.stages[stage] = 'pass'; record();
  console.log(annotationCommand('notice', 'iOS QA stage', `${stage}: pass`));
}

try {
  result.sourceCommit = assertCleanSource(root, commit);
  if (existsSync(path.join(root, 'ios'))) throw new Error('Use a fresh checkout without ios/; existing native projects are preserved');
  if (process.env.EXPO_PUBLIC_NATIVE_SMOKE !== '1' || process.env.EXPO_PUBLIC_BUILD_SHA !== commit) throw new Error('Native smoke bundle flags must match the source commit');
  result.xcode = run('xcodebuild', ['-version']);
  result.swift = run('xcrun', ['swift', '--version']);
  result.sdkVersion = run('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version']);
  result.cocoaPods = run('pod', ['--version']);
  result.architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  checkpoint('source');
  // Check host readiness before an expensive build; release Simulator memory during compilation.
  const spec = simulatorSpec(JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], { logStdout: false })));
  result.simulator = spec;
  simulatorID = validatedSimulatorID(run('xcrun', ['simctl', 'create', `ITOMA-QA-${result.buildID}`, spec.deviceType, spec.runtime]));
  checkpoint('simulatorCreated');
  run('xcrun', ['simctl', 'boot', simulatorID]);
  checkpoint('simulatorBootRequested');
  run('xcrun', ['simctl', 'bootstatus', simulatorID, '-b'], { timeout: 240_000 });
  checkpoint('simulatorPreflightReady');
  run('xcrun', ['simctl', 'shutdown', simulatorID]);
  checkpoint('simulatorPreflight');
  result.sharedSwiftTests = {};
  for (const name of ['core', 'storage', 'control']) {
    build('xcrun', ['swift', 'test', '--package-path', `packages/itoma-${name}`, '--scratch-path', path.join(output, `swift-${name}-build`), '--jobs', '2'],
      `swift-${name}.log`, 600_000);
    result.sharedSwiftTests[name] = passedSwiftTestCount(readFileSync(path.join(output, `swift-${name}.log`), 'utf8'));
    checkpoint(`sharedSwift-${name}`);
  }
  checkpoint('sharedSwiftOnMac');
  build('npx', ['expo', 'prebuild', '--platform', 'ios', '--no-install'], 'prebuild.log', 300_000);
  assertCleanSource(root, commit);
  checkpoint('cng');
  // SDK58 autolinking reads extraPods from its process cwd, not --project-directory.
  build('pod', ['install'], 'pod-install.log', 900_000, { cwd: path.join(root, 'ios') });
  checkpoint('pods');
  const nativeConfig = createHash('sha256');
  for (const file of ['app.json', 'app.config.ts', 'package-lock.json', 'modules/itoma-native/expo-module.config.json', 'ios/Podfile', 'ios/Podfile.properties.json', 'ios/Podfile.lock']) {
    nativeConfig.update(`${file}\0`); nativeConfig.update(readFileSync(path.join(root, file))); nativeConfig.update('\0');
  }
  result.nativeConfigurationSHA256 = nativeConfig.digest('hex');
  const workspaces = readdirSync(path.join(root, 'ios')).filter((name) => name.endsWith('.xcworkspace'));
  if (workspaces.length !== 1) throw new Error('Expected one generated app workspace');
  const workspace = path.join('ios', workspaces[0]);
  const scheme = path.basename(workspace, '.xcworkspace');
  const derived = path.join(output, 'derived-data');
  build('xcodebuild', ['-workspace', workspace, '-scheme', scheme, '-configuration', 'Release', '-sdk', 'iphonesimulator',
    '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', derived, '-jobs', '2',
    `ARCHS=${result.architecture}`, 'ONLY_ACTIVE_ARCH=YES', 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=', 'build'],
  'xcodebuild.log', 2_100_000);
  assertCleanSource(root, commit);
  result.nativeSourceCommit = commit;
  checkpoint('build');
  const products = path.join(derived, 'Build/Products/Release-iphonesimulator');
  const apps = readdirSync(products).filter((name) => name.endsWith('.app'));
  if (apps.length !== 1) throw new Error('Expected one built app');
  const app = path.join(products, apps[0]);
  const bundleID = run('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(app, 'Info.plist')]);
  result.bundleIdentifier = bundleID;
  result.jsBundleSHA256 = createHash('sha256').update(readFileSync(path.join(app, 'main.jsbundle'))).digest('hex');
  result.jsSourceCommit = commit;
  run('xcrun', ['simctl', 'boot', simulatorID]);
  checkpoint('simulatorRebootRequested');
  run('xcrun', ['simctl', 'bootstatus', simulatorID, '-b'], { timeout: 240_000 });
  checkpoint('simulatorReadyForInstall');
  run('xcrun', ['simctl', 'install', simulatorID, app]);
  checkpoint('install');
  launchLog = openSync(path.join(output, 'app.log'), 'a');
  launcher = spawn('xcrun', ['simctl', 'launch', '--console-pty', '--terminate-running-process', simulatorID, bundleID], {
    cwd: root, env: { ...process.env, SIMCTL_CHILD_ITOMA_NATIVE_QA: '1' }, stdio: ['ignore', launchLog, launchLog],
  });
  let launchError;
  launcher.on('error', () => { launchError = true; });
  const deadline = Date.now() + 120_000;
  let outcome = 'pending';
  while (outcome === 'pending' && Date.now() < deadline) {
    await delay(1_000);
    outcome = smokeOutcome(readFileSync(path.join(output, 'app.log'), 'utf8'), commit);
    if (launchError || (launcher.exitCode !== null && outcome === 'pending')) throw new Error('App console exited before a native smoke result');
  }
  // Capture even a failed smoke for diagnosis; images alone never assert UI acceptance.
  await delay(5_000);
  run('xcrun', ['simctl', 'io', simulatorID, 'screenshot', '--type=png', path.join(output, 'home.png')]);
  checkpoint('imageCaptured');
  outcome = smokeOutcome(readFileSync(path.join(output, 'app.log'), 'utf8'), commit);
  if (outcome !== 'pass') throw new Error(`Native JS-to-Swift smoke ${outcome === 'fail' ? 'failed' : 'timed out'}`);
  checkpoint('nativeBridge');
  result.status = 'pass';
} catch (error) {
  result.status = 'fail'; result.error = error.message;
  if (error.tool) result.failedTool = error.tool;
  console.log(annotationCommand('error', 'iOS QA', result.error));
  if (error.logFile && existsSync(path.join(output, error.logFile))) {
    for (const line of compilerDiagnostics(readFileSync(path.join(output, error.logFile), 'utf8'))) {
      console.log(annotationCommand('error', 'Compiler/test diagnostic', line));
    }
  }
  process.exitCode = 1;
} finally {
  launcher?.kill('SIGTERM');
  if (launchLog !== undefined) closeSync(launchLog);
  if (simulatorID) {
    // Only the UUID returned by OUR create call is ever targeted. Existing devices are untouched.
    try { run('xcrun', ['simctl', 'shutdown', simulatorID]); } catch { /* still attempt own deletion */ }
    try {
      run('xcrun', ['simctl', 'delete', simulatorID]); result.cleanup = 'pass';
    } catch {
      result.cleanup = 'failed'; result.status = 'fail'; result.error ??= 'Created Simulator cleanup failed'; process.exitCode = 1;
    }
  }
  result.completedAt = new Date().toISOString(); record();
  // API-readable status/provenance remains useful even when artifact-host access is unavailable.
  console.log(annotationCommand('notice', 'iOS QA result', JSON.stringify(result)));
  console.log(`iOS QA ${result.status}: ${output}`);
}
