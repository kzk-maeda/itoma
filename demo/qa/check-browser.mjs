import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? '/tmp/itoma-offhours-browser/node_modules/playwright');
const root = process.env.DEMO_QA_URL ?? 'http://127.0.0.1:8798/demos/demo-reflection-cumulative-chart-72bdc829fcc4/';
const output = process.env.DEMO_QA_OUTPUT ?? '/tmp/itoma-cumulative-evidence';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const cases = [
  { name: 'light-390', width: 390, colorScheme: 'light', reducedMotion: 'no-preference', scale: 1 },
  { name: 'dark-390', width: 390, colorScheme: 'dark', reducedMotion: 'reduce', scale: 1 },
  { name: 'light-320', width: 320, colorScheme: 'light', reducedMotion: 'reduce', scale: 1 },
  { name: 'large-dark-320', width: 320, colorScheme: 'dark', reducedMotion: 'reduce', scale: 2 },
];
const results = [];
try {
  for (const test of cases) {
    const context = await browser.newContext({ viewport: { width: test.width, height: 844 }, colorScheme: test.colorScheme, reducedMotion: test.reducedMotion });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(root + 'cumulative');
    await page.locator('[data-testid="reflection-total"]:visible').waitFor();
    await page.getByRole('button', { name: 'デモの記録を切り替える', exact: true }).click();
    await page.getByRole('button', { name: '通常 · 4時間13分', exact: true }).click();
    await page.waitForFunction(dark => getComputedStyle(document.querySelector('[data-testid="reflection-total"]')).color === (dark ? 'rgb(240, 240, 233)' : 'rgb(48, 49, 47)'), test.colorScheme === 'dark');
    const enlarge = async () => {
      if (test.scale === 1) return;
      await page.evaluate(scale => {
        for (const el of document.querySelectorAll('*')) {
          if (!(el instanceof HTMLElement) || el.dataset.demoQaScale || ![...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) continue;
          const style = getComputedStyle(el); el.style.fontSize = `${parseFloat(style.fontSize) * scale}px`;
          const line = parseFloat(style.lineHeight); if (Number.isFinite(line)) el.style.lineHeight = `${line * scale}px`;
          el.dataset.demoQaScale = 'true';
        }
      }, test.scale);
    };
    const check = async () => {
      await enlarge();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
      assert.equal(await page.locator('[data-testid="reflection-total"]:visible').count(), 1);
      assert(await page.evaluate(() => [...document.querySelectorAll('[data-testid="cumulative-chart"] *')].filter(el => el instanceof HTMLElement && el.childElementCount === 0 && /^\d+(?:\.\d+)?$/.test(el.textContent)).every(el => el.getBoundingClientRect().height <= parseFloat(getComputedStyle(el).lineHeight) + 1)), 'axis number wrapped');
    };
    const select = async name => {
      await page.getByRole('button', { name: 'デモの記録を切り替える', exact: true }).click();
      await page.getByRole('button', { name, exact: true }).click();
      await check();
    };
    const line = () => page.locator('[data-testid="cumulative-chart"]:visible').locator('path[fill="none"]');
    assert.equal(await page.locator('[data-testid="reflection-total"]:visible').innerText(), '4時間13分');
    await check();
    await page.screenshot({ path: `${output}/${test.name}.png`, fullPage: true });
    assert.equal(await line().count(), 1);
    const normalPath = await line().first().getAttribute('d');
    const label = await page.locator('[data-testid="cumulative-chart"]:visible').locator('[role="img"]').getAttribute('aria-label');
    assert.match(label, /累計は4時間13分/);
    assert.match(label, /11\/16/); assert.match(label, /11\/20/);
    await page.getByRole('button', { name: '月次', exact: true }).click();
    assert.equal(await page.locator('[data-testid="reflection-total"]:visible').innerText(), '4時間13分');
    assert.equal(await line().first().getAttribute('d'), normalPath);
    await page.getByRole('button', { name: '週次', exact: true }).click();
    await select('一部の記録なし');
    assert.equal(await page.locator('[data-testid="reflection-total"]:visible').innerText(), '4時間');
    assert.equal(await line().count(), 2);
    await page.getByText('記録の一部がありません', { exact: true }).waitFor();
    if (test.name === 'light-390') { await page.locator('[data-testid="total-card"]:visible').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/gap.png`, fullPage: true }); }
    await select('まだ記録なし');
    assert.equal(await page.locator('[data-testid="reflection-total"]:visible').innerText(), '—');
    assert.equal(await page.locator('[data-testid="cumulative-chart"]:visible').count(), 0);
    assert.equal(await page.locator('[data-testid="cumulative-empty"]:visible').count(), 1);
    assert(await page.getByRole('button', { name: '週次', exact: true }).isDisabled());
    if (test.name === 'light-390') { await page.locator('[data-testid="total-card"]:visible').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/empty.png`, fullPage: true }); }
    await select('記録あり · 0分');
    assert.equal(await page.locator('[data-testid="reflection-total"]:visible').innerText(), '0分');
    assert.equal(await line().count(), 1);
    const flat = await line().first().getAttribute('d');
    const ys = [...flat.matchAll(/[ML][\d.]+,([\d.]+)/g)].map(m => Number(m[1]));
    assert.equal(new Set(ys).size, 1, 'zero must be flat, not absent');
    if (test.name === 'light-390') { await page.locator('[data-testid="total-card"]:visible').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/zero.png`, fullPage: true }); }
    await select('長期間の積み上げ');
    assert.equal(await page.locator('[data-testid="reflection-total"]:visible').innerText(), '85時間13分');
    const longPath = await line().first().getAttribute('d');
    await page.getByRole('button', { name: '前の期間', exact: true }).click();
    assert.match(await page.locator('[data-testid="period-title"]:visible').innerText(), /11\/9/);
    assert.equal(await page.locator('[data-testid="period-total"]:visible').innerText(), '3時間20分');
    assert.equal(await page.locator('[data-testid="reflection-total"]:visible').innerText(), '85時間13分');
    assert.equal(await line().first().getAttribute('d'), longPath);
    await page.getByRole('button', { name: '月次', exact: true }).click();
    await page.getByRole('button', { name: '前の期間', exact: true }).click();
    assert.equal(await page.locator('[data-testid="period-total"]:visible').innerText(), '38時間20分');
    assert.equal(await page.locator('[data-testid="reflection-total"]:visible').innerText(), '85時間13分');
    assert.equal(await line().first().getAttribute('d'), longPath);
    await page.getByRole('button', { name: '週次', exact: true }).click();
    assert.match(await page.locator('[data-testid="period-title"]:visible').innerText(), /11\/9/);
    await check();
    if (['light-390', 'large-dark-320'].includes(test.name)) { await page.locator('[data-testid="cumulative-chart"]:visible').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/long-${test.name}.png`, fullPage: true }); }
    await page.getByRole('tab', { name: 'ホーム', exact: true }).click();
    await page.getByRole('button', { name: '比較：累積グラフ', exact: true }).click();
    assert.equal(await page.locator('[data-testid="reflection-total"]:visible').innerText(), '85時間13分');
    assert.match(await page.locator('[data-testid="period-title"]:visible').innerText(), /11\/9/);
    await page.getByRole('tab', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: '振り返りに戻る', exact: true }).click();
    await page.locator('[data-testid="growth-whole"]:visible').waitFor();
    await page.getByRole('tab', { name: 'ホーム', exact: true }).click();
    await page.getByRole('button', { name: '比較：累積グラフ', exact: true }).click();
    assert.equal(await page.locator('[data-testid="reflection-total"]:visible').innerText(), '85時間13分');
    await page.getByRole('button', { name: '集計を更新', exact: true }).click();
    assert.equal(await page.locator('[data-testid="reflection-total"]:visible').innerText(), '85時間13分');
    await page.getByRole('button', { name: 'デモの記録を切り替える', exact: true }).focus(); await page.keyboard.press('Enter');
    await page.getByRole('button', { name: '通常 · 4時間13分', exact: true }).focus(); await page.keyboard.press('Space');
    assert.equal(await page.locator('[data-testid="reflection-total"]:visible').innerText(), '4時間13分');
    await check();
    assert.deepEqual(errors, []);
    results.push({ ...test, scenarios: 5, gapIsNotZero: true, globalTotalStableAcrossPeriods: true, periodMemory: true, navigation: 'PASS', keyboard: 'PASS', pageErrors: errors, noHorizontalOverflow: true });
    await context.close();
  }
  writeFileSync(`${output}/results.json`, JSON.stringify({ url: root, browser: browser.version(), scope: 'synthetic Web only; DOM text scaling is not Dynamic Type; not iOS/OS data', results }, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
