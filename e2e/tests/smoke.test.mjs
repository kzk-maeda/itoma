import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { remote } from 'webdriverio';

const target = JSON.parse(readFileSync(new URL('../target.json', import.meta.url), 'utf8'));
const scenarios = JSON.parse(readFileSync(new URL('../scenarios.json', import.meta.url), 'utf8'));
const scenarioName = (id) => {
  const scenario = scenarios.find(item => item.id === id);
  assert.ok(scenario, `Register scenario ${id} in scenarios.json`);
  return `${id}: ${scenario.name}`;
};
const output = process.env.DEVICEFARM_LOG_DIR;
let driver;
let shot = 0;

const element = async (id) => {
  const node = await driver.$(`~${id}`);
  await node.waitForDisplayed({ timeout: 30_000 });
  return node;
};
const text = async (value) => {
  const node = await driver.$(`-ios predicate string:name == ${JSON.stringify(value)}`);
  await node.waitForDisplayed({ timeout: 30_000 });
  return node;
};
const tab = async (name) => {
  await (await element(`product-tab-${name}`)).click();
  await element(`screen-title-${name}`);
};
const noUnlock = async () => assert.equal(await driver.$('~home-unlock-entry').isExisting(), false);

before(async () => {
  assert.equal(process.env.DEVICEFARM_DEVICE_PLATFORM_NAME, 'iOS');
  const major = Number(process.env.DEVICEFARM_DEVICE_OS_VERSION?.split('.')[0]);
  assert.ok(major >= 18, 'The macos_tahoe / Xcode 27 suite requires iOS 18+');
  const wda = process.env.ITOMA_WDA_PATH;
  assert.ok(wda, 'A compatible prebuilt WebDriverAgent is required');
  driver = await remote({
    hostname: '127.0.0.1', port: 4723, path: '/', logLevel: 'warn',
    connectionRetryCount: 0, connectionRetryTimeout: 120_000,
    capabilities: {
      platformName: 'iOS', 'appium:automationName': 'XCUITest',
      'appium:deviceName': process.env.DEVICEFARM_DEVICE_NAME,
      'appium:udid': process.env.DEVICEFARM_DEVICE_UDID,
      'appium:platformVersion': process.env.DEVICEFARM_DEVICE_OS_VERSION,
      'appium:app': process.env.DEVICEFARM_APP_PATH,
      'appium:bundleId': target.bundleId,
      'appium:derivedDataPath': wda, 'appium:usePrebuiltWDA': true,
      'appium:noReset': true, 'appium:newCommandTimeout': 120,
      'appium:autoAcceptAlerts': false,
    },
  });
  writeFileSync(join(output, 'session.json'), JSON.stringify({
    ...target, deviceArn: process.env.DEVICEFARM_DEVICE_ARN,
    deviceName: process.env.DEVICEFARM_DEVICE_NAME, os: process.env.DEVICEFARM_DEVICE_OS_VERSION,
    runArn: process.env.DEVICEFARM_RUN_ARN, node: process.version,
    scope: 'public-device-ui-smoke; Screen Time enforcement is unverified',
  }, null, 2));
}, { timeout: 180_000 });

beforeEach(async () => {
  await driver.terminateApp(target.bundleId);
  await driver.activateApp(target.bundleId);
  await element(`itoma-build-${target.appCommit}`);
  await element('screen-title-home');
}, { timeout: 60_000 });

afterEach(async () => {
  // Only fresh Device Farm installations with no personal data are supported by this suite.
  if (driver) {
    await driver.saveScreenshot(join(output, `scenario-${++shot}.png`));
    writeFileSync(join(output, `scenario-${shot}.xml`), await driver.getPageSource());
  }
}, { timeout: 30_000 });
after(async () => { if (driver) await driver.deleteSession(); }, { timeout: 30_000 });

test(scenarioName('DF01'), { timeout: 60_000 }, async () => {
  await text('自分の時間を、ここから。');
  await element('home-rule-create');
  await noUnlock();
});

test(scenarioName('DF02'), { timeout: 60_000 }, async () => {
  await tab('settings');
  await text('保存したルールはありません。');
  await text('スクリーンタイム：許可の確認が必要です');
  await tab('home');
  await noUnlock();
});

test(scenarioName('DF03'), { timeout: 90_000 }, async () => {
  await tab('reflection');
  const total = await element('reflection-total');
  assert.equal(await total.getText(), '—');
  await text('時間の集計は準備中です');
  const month = await element('reflection-period-month');
  await month.waitForEnabled({ timeout: 30_000 });
  await month.click();
  await driver.waitUntil(() => month.isSelected(), { timeout: 10_000 });
  const week = await element('reflection-period-week');
  await week.waitForEnabled({ timeout: 30_000 });
  await week.click();
  await driver.waitUntil(() => week.isSelected(), { timeout: 10_000 });
  assert.equal(await total.getText(), '—');
  await tab('home');
});

test(scenarioName('DF04'), { timeout: 90_000 }, async () => {
  await tab('settings');
  const history = await driver.$('~settings-history');
  if (!await history.isDisplayed()) {
    await driver.execute('mobile: scroll', { predicateString: 'name == "settings-history"', toVisible: true });
  }
  await history.waitForDisplayed({ timeout: 10_000 });
  await history.click();
  assert.equal(await (await element('screen-title-detail')).getText(), 'あなたの選択の記録');
  await (await element('flow-back')).click();
  await driver.waitUntil(async () => (await driver.$('~product-tab-settings')).isDisplayed(), { timeout: 30_000 });
  await tab('home');
  await noUnlock();
});
