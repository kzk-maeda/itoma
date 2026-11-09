import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { _testing: plugin } = require('../plugins/with-itoma-screen-time.cjs');
const xcode = require('xcode');
const plist = require('@expo/plist').default;
const root = path.resolve(import.meta.dirname, '..');
const group = 'group.com.example.itoma';
const limits = { historyWarningBytes: 80 * 1024 * 1024, historyMaximumBytes: 100 * 1024 * 1024, pendingEventLimit: 10_000 };

test('invalid or absent shared identities fail rather than silently selecting signing configuration', () => {
  for (const value of [undefined, '', 'com.example.itoma', 'group.bad\n', 'group.$(id).app']) {
    assert.throws(() => plugin.validateOptions({ ...limits, appGroup: value }, 'com.example.itoma'));
  }
  assert.throws(() => plugin.validateOptions({ appGroup: group }, undefined));
  plugin.validateOptions({ ...limits, appGroup: group }, 'com.example.itoma');
  assert.throws(() => plugin.validateOptions({ appGroup: group }, 'com.example.itoma'));
});

test('fresh CNG and repeated regeneration embed one isolated Extension and preserve private signing choices', { timeout: 120_000 }, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'itoma-cng-'));
  try {
    for (const file of ['app.json', 'app.config.ts', 'package.json', 'plugins', 'extensions']) {
      cpSync(path.join(root, file), path.join(directory, file), { recursive: true });
    }
    for (const file of ['node_modules', 'assets']) symlinkSync(path.join(root, file), path.join(directory, file));
    const prebuild = () => execFileSync(process.execPath, [path.join(root, 'node_modules/expo/bin/cli'), 'prebuild', '--platform', 'ios', '--no-install', '--no-clean'], {
      cwd: directory, env: { ...process.env, EXPO_OFFLINE: '1', CI: '1', ITOMA_SCREEN_TIME: '1', ITOMA_APP_GROUP: group,
        ITOMA_HISTORY_WARNING_BYTES: String(limits.historyWarningBytes), ITOMA_HISTORY_MAXIMUM_BYTES: String(limits.historyMaximumBytes), ITOMA_PENDING_EVENT_LIMIT: String(limits.pendingEventLimit) },
      stdio: 'pipe', timeout: 60_000,
    });
    prebuild();
    const file = path.join(directory, 'ios/itoma.xcodeproj/project.pbxproj');
    const parse = () => { const p = xcode.project(file); p.parseSync(); return p; };
    const first = parse();
    const targets = (p) => Object.entries(p.pbxNativeTargetSection()).filter(([key]) => !key.endsWith('_comment'));
    const monitor = targets(first).find(([, value]) => value.name.replaceAll('"', '') === 'ItomaActivityMonitor');
    assert.ok(monitor);
    const configs = first.pbxXCConfigurationList()[monitor[1].buildConfigurationList].buildConfigurations;
    for (const { value } of configs) first.pbxXCBuildConfigurationSection()[value].buildSettings.DEVELOPMENT_TEAM = 'PRIVATE_TEAM';
    writeFileSync(file, first.writeSync());
    prebuild();
    const second = parse();
    assert.equal(targets(second).length, targets(first).length);
    assert.ok(targets(second).some(([id]) => id === monitor[0]));
    const host = second.getTarget('com.apple.product-type.application');
    const dependencies = second.hash.project.objects.PBXTargetDependency;
    assert.equal(host.target.dependencies.filter((entry) => dependencies[entry.value]?.target === monitor[0]).length, 1);
    for (const { value } of configs) assert.equal(second.pbxXCBuildConfigurationSection()[value].buildSettings.DEVELOPMENT_TEAM, 'PRIVATE_TEAM');
    const sources = Object.values(second.pbxFileReferenceSection()).filter((v) => v.path?.includes('ItomaActivityMonitor.swift'));
    assert.equal(sources.length, 1);
    const copy = Object.values(second.hash.project.objects.PBXCopyFilesBuildPhase).filter((v) => v.isa === 'PBXCopyFilesBuildPhase');
    assert.equal(copy.reduce((count, phase) => count + phase.files.filter((v) => v.comment?.includes('ItomaActivityMonitor.appex')).length, 0), 1);
    const podfile = readFileSync(path.join(directory, 'ios/Podfile'), 'utf8');
    assert.equal(podfile.match(/target 'ItomaActivityMonitor' do/g)?.length, 1);
    const isolated = podfile.split('# ITOMA activity monitor pods')[1];
    assert.match(isolated, /pod 'ItomaControl'/);
    assert.doesNotMatch(isolated, /ItomaHistory|Expo|React|use_expo_modules/);
    const base = path.join(directory, 'ios/ItomaActivityMonitor');
    const info = plist.parse(readFileSync(path.join(base, 'Info.plist'), 'utf8'));
    assert.equal(info.NSExtension.NSExtensionPointIdentifier, 'com.apple.deviceactivity.monitor-extension');
    assert.equal(info.ITOMAAppGroup, group);
    const entitlements = plist.parse(readFileSync(path.join(base, 'ItomaActivityMonitor.entitlements'), 'utf8'));
    assert.deepEqual(entitlements['com.apple.security.application-groups'], [group]);
    const hostEntitlements = plist.parse(readFileSync(path.join(directory, 'ios/itoma/itoma.entitlements'), 'utf8'));
    assert.ok(hostEntitlements['com.apple.security.application-groups'].includes(group));
    assert.equal(hostEntitlements['com.apple.developer.family-controls'], true);
    assert.ok(existsSync(path.join(base, 'ItomaActivityMonitor.swift')));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
