const fs = require('node:fs/promises');
const path = require('node:path');
const {
  IOSConfig, withDangerousMod, withEntitlementsPlist, withInfoPlist, withPodfile, withXcodeProject,
} = require('expo/config-plugins');
const plist = require('@expo/plist').default;

const TARGET = 'ItomaActivityMonitor';
const MARKER = '# ITOMA activity monitor pods';
const END = '# End ITOMA activity monitor pods';

function validateOptions(options, bundleID) {
  if (!/^group\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(options?.appGroup ?? '')) {
    throw new Error('ITOMA_SCREEN_TIME requires an explicit ITOMA_APP_GROUP (group.<reverse DNS>).');
  }
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleID ?? '')) {
    throw new Error('ITOMA Screen Time requires an explicit iOS bundleIdentifier.');
  }
}

function extensionInfo(appGroup) {
  return {
    CFBundleDisplayName: 'ITOMA', CFBundleExecutable: '$(EXECUTABLE_NAME)',
    CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)', CFBundleName: '$(PRODUCT_NAME)',
    CFBundlePackageType: 'XPC!', CFBundleShortVersionString: '$(MARKETING_VERSION)',
    CFBundleVersion: '$(CURRENT_PROJECT_VERSION)', ITOMAAppGroup: appGroup,
    NSExtension: {
      NSExtensionPointIdentifier: 'com.apple.deviceactivity.monitor-extension',
      NSExtensionPrincipalClass: `$(PRODUCT_MODULE_NAME).${TARGET}`,
    },
  };
}

function monitorPodfile(contents) {
  const block = [MARKER, `target '${TARGET}' do`,
    "  pod 'ItomaSQLite', :path => '../packages/itoma-storage'",
    "  pod 'ItomaCore', :path => '../packages/itoma-core'",
    "  pod 'ItomaStorage', :path => '../packages/itoma-storage'",
    "  pod 'ItomaControl', :path => '../packages/itoma-control'",
    'end', END].join('\n');
  const existing = new RegExp(`${MARKER}[\\s\\S]*?${END}\\n?`, 'g');
  return `${contents.replace(existing, '').trimEnd()}\n\n${block}\n`;
}

function configureProject(project, bundleID) {
  const unquote = (value) => String(value ?? '').replace(/^"|"$/g, '');
  const existing = Object.entries(project.pbxNativeTargetSection())
    .find(([key, value]) => !key.endsWith('_comment') && unquote(value.name) === TARGET);
  const host = project.getTarget('com.apple.product-type.application');
  if (!host) throw new Error('ITOMA requires a host application target.');
  const targetID = existing?.[0] ?? project.addTarget(TARGET, 'app_extension', TARGET, `${bundleID}.activity-monitor`).uuid;
  const target = project.pbxNativeTargetSection()[targetID];
  if (!existing) {
    for (const [type, name] of [['PBXSourcesBuildPhase', 'Sources'], ['PBXFrameworksBuildPhase', 'Frameworks'], ['PBXResourcesBuildPhase', 'Resources']]) {
      project.addBuildPhase([], type, name, targetID);
    }
  }
  IOSConfig.XcodeUtils.ensureGroupRecursively(project, TARGET);
  IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
    filepath: `${TARGET}/${TARGET}.swift`, groupName: TARGET, project, targetUuid: targetID,
  });
  const configurations = project.pbxXCBuildConfigurationSection();
  const hostList = project.pbxXCConfigurationList()[host.target.buildConfigurationList];
  const targetList = project.pbxXCConfigurationList()[target.buildConfigurationList];
  for (const ref of targetList.buildConfigurations) {
    const configuration = configurations[ref.value];
    const matching = hostList.buildConfigurations.map((entry) => configurations[entry.value])
      .find((entry) => entry.name === configuration.name);
    const hostSettings = matching?.buildSettings ?? {};
    Object.assign(configuration.buildSettings, {
      INFOPLIST_FILE: `${TARGET}/Info.plist`, CODE_SIGN_ENTITLEMENTS: `${TARGET}/${TARGET}.entitlements`,
      PRODUCT_BUNDLE_IDENTIFIER: `"${bundleID}.activity-monitor"`, PRODUCT_NAME: '"$(TARGET_NAME)"',
      SWIFT_VERSION: '6.0', SKIP_INSTALL: 'YES', APPLICATION_EXTENSION_API_ONLY: 'YES',
      IPHONEOS_DEPLOYMENT_TARGET: hostSettings.IPHONEOS_DEPLOYMENT_TARGET ?? '16.0',
      TARGETED_DEVICE_FAMILY: hostSettings.TARGETED_DEVICE_FAMILY ?? '"1,2"',
      CURRENT_PROJECT_VERSION: hostSettings.CURRENT_PROJECT_VERSION ?? '1',
      MARKETING_VERSION: hostSettings.MARKETING_VERSION ?? '1.0',
      GENERATE_INFOPLIST_FILE: 'NO',
    });
    // Preserve an existing extension's signing choices. Inherit a configured host Team;
    // never select a Team, profile, or identity on the user's behalf.
    if (!configuration.buildSettings.DEVELOPMENT_TEAM && hostSettings.DEVELOPMENT_TEAM) {
      configuration.buildSettings.DEVELOPMENT_TEAM = hostSettings.DEVELOPMENT_TEAM;
    }
  }
  return project;
}

function withItomaScreenTime(config, options) {
  const bundleID = config.ios?.bundleIdentifier;
  validateOptions(options, bundleID);
  config = withEntitlementsPlist(config, (mod) => {
    const key = 'com.apple.security.application-groups';
    mod.modResults[key] = [...new Set([...(mod.modResults[key] ?? []), options.appGroup])];
    mod.modResults['com.apple.developer.family-controls'] = true;
    return mod;
  });
  config = withInfoPlist(config, (mod) => {
    mod.modResults.ITOMAAppGroup = options.appGroup;
    mod.modResults.ITOMAScreenTime = true;
    return mod;
  });
  config = withDangerousMod(config, ['ios', async (mod) => {
    const directory = path.join(mod.modRequest.platformProjectRoot, TARGET);
    await fs.mkdir(directory, { recursive: true });
    await fs.copyFile(path.join(mod.modRequest.projectRoot, 'extensions', TARGET, `${TARGET}.swift`), path.join(directory, `${TARGET}.swift`));
    await fs.writeFile(path.join(directory, 'Info.plist'), plist.build(extensionInfo(options.appGroup)));
    await fs.writeFile(path.join(directory, `${TARGET}.entitlements`), plist.build({
      'com.apple.developer.family-controls': true,
      'com.apple.security.application-groups': [options.appGroup],
    }));
    return mod;
  }]);
  config = withPodfile(config, (mod) => {
    mod.modResults.contents = monitorPodfile(mod.modResults.contents);
    return mod;
  });
  return withXcodeProject(config, (mod) => {
    mod.modResults = configureProject(mod.modResults, bundleID);
    return mod;
  });
}

module.exports = withItomaScreenTime;
module.exports._testing = { validateOptions, extensionInfo, monitorPodfile, configureProject };
