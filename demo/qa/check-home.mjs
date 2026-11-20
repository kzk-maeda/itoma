import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? '/tmp/itoma-offhours-browser/node_modules/playwright');
const url = process.env.DEMO_QA_URL ?? 'http://127.0.0.1:8788/demos/demo-home-off-hours-circle-86d6764f1fba/';
const output = process.env.DEMO_QA_OUTPUT ?? '/tmp/itoma-offhours-evidence';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const cases = [
  { name: 'light-390', width: 390, colorScheme: 'light', reducedMotion: 'no-preference', scale: 1 },
  { name: 'dark-390', width: 390, colorScheme: 'dark', reducedMotion: 'reduce', scale: 1 },
  { name: 'light-320', width: 320, colorScheme: 'light', reducedMotion: 'reduce', scale: 1 },
  { name: 'large-dark-320', width: 320, colorScheme: 'dark', reducedMotion: 'reduce', scale: 2 },
];
const results = [];
try {
  for (const test of cases) {
    const context = await browser.newContext({ viewport: { width: test.width, height: 844 }, colorScheme: test.colorScheme, reducedMotion: test.reducedMotion, deviceScaleFactor: 1 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.getByText('制限時間外', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'ホーム', exact: true }).waitFor();
    // Wait for React's external-store hydration and web theme update.
    await page.waitForFunction(dark => {
      const label = [...document.querySelectorAll('*')].find(el => el.textContent === '制限時間外');
      return label && getComputedStyle(label).color === (dark ? 'rgb(240, 240, 233)' : 'rgb(48, 49, 47)');
    }, test.colorScheme === 'dark');
    const enlarge = async () => {
      if (test.scale === 1) return;
      await page.evaluate(scale => {
        for (const el of document.querySelectorAll('*')) {
          if (!(el instanceof HTMLElement) || el.dataset.demoQaScale || ![...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) continue;
          const style = getComputedStyle(el), size = parseFloat(style.fontSize), line = parseFloat(style.lineHeight);
          el.style.fontSize = `${size * scale}px`;
          if (Number.isFinite(line)) el.style.lineHeight = `${line * scale}px`;
          el.dataset.demoQaScale = 'true';
        }
      }, test.scale);
    };
    const checkWidth = async () => {
      await enlarge();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
      const box = await page.getByTestId('home-scroll').boundingBox();
      assert(box.width <= test.width, 'home overflow');
    };
    const select = async label => {
      await page.getByRole('button', { name: 'デモの表示条件を切り替える', exact: true }).click();
      await page.getByRole('button', { name: label, exact: true }).click();
      await enlarge();
    };
    assert.equal(await page.getByTestId('off-hours-circle').count(), 1);
    assert.equal(await page.getByTestId('period-ring').count(), 0);
    assert.equal(await page.getByTestId('rule-goal').count(), 1);
    await checkWidth();
    await page.screenshot({ path: `${output}/${test.name}.png`, fullPage: true });
    const circle = page.getByTestId('off-hours-circle').locator('svg circle');
    assert.equal(await circle.getAttribute('stroke-dasharray'), '1 9');
    assert.equal(await circle.getAttribute('stroke-width'), '1.6');
    const first = await circle.getAttribute('style');
    await page.waitForTimeout(120);
    assert.equal(await circle.getAttribute('style'), first, 'idle ring must stay static');
    await select('翌日の予定');
    assert.match(await page.getByTestId('next-rule').innerText(), /明日 07:00〜08:00/);
    await checkWidth();
    if (test.name === 'light-390') await page.screenshot({ path: `${output}/tomorrow.png`, fullPage: true });
    await select('来週の予定');
    assert.match(await page.getByTestId('next-rule').innerText(), /11月27日（金）/);
    await checkWidth();
    await select('目標の登録なし');
    assert.equal(await page.getByTestId('rule-goal').count(), 0);
    assert.equal(await page.getByTestId('off-hours-circle').count(), 1);
    await checkWidth();
    await select('次の予定なし');
    assert.equal(await page.getByTestId('next-rule').count(), 0);
    assert.equal(await page.getByTestId('off-hours-circle').count(), 1);
    await checkWidth();
    if (test.name === 'light-390') await page.screenshot({ path: `${output}/no-next.png`, fullPage: true });
    await page.getByRole('button', { name: 'ルールを確認する', exact: true }).click();
    await page.getByText('編集・保存は行いません。', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'ホームに戻る', exact: true }).click();
    await page.getByTestId('no-next-rule').waitFor();
    await select('制限中と比較');
    assert.equal(await page.getByTestId('off-hours-circle').count(), 0);
    assert.equal(await page.getByTestId('period-ring').count(), 1);
    await page.getByText('1時間30分', { exact: true }).waitFor();
    await checkWidth();
    if (test.name === 'light-390') await page.screenshot({ path: `${output}/active.png`, fullPage: true });
    await page.getByRole('tab', { name: '振り返り', exact: true }).click();
    await page.getByText('このデモはホームの時間外表示を比較するものです。', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'ホーム', exact: true }).click();
    await page.getByTestId('period-ring').waitFor();
    await select('今日の次の予定');
    await page.getByRole('button', { name: 'デモの表示条件を切り替える', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: '翌日の予定', exact: true }).focus();
    await page.keyboard.press('Space');
    await page.getByText('朝のひととき', { exact: true }).waitFor();
    assert.deepEqual(errors, [], 'browser errors');
    results.push({ ...test, scenarios: 6, keyboard: 'PASS', navigation: 'PASS', noHorizontalOverflow: true, pageErrors: errors });
    await context.close();
  }
  writeFileSync(`${output}/results.json`, JSON.stringify({ url, browser: browser.version(), scope: 'synthetic Web; DOM text scaling is not Dynamic Type; not iOS/OS evidence', results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
