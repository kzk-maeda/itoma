import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? '/tmp/itoma-offhours-browser/node_modules/playwright');
const root = process.env.DEMO_QA_URL ?? 'http://127.0.0.1:8804/demos/demo-reflection-time-layers-ba4f82e7f7ad/';
const output = process.env.DEMO_QA_OUTPUT ?? '/tmp/itoma-time-layers-evidence';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const configurations = [
  { name: 'light-390', width: 390, colorScheme: 'light', scale: 1, reducedMotion: 'no-preference' },
  { name: 'dark-390', width: 390, colorScheme: 'dark', scale: 1, reducedMotion: 'reduce' },
  { name: 'light-320', width: 320, colorScheme: 'light', scale: 1, reducedMotion: 'reduce' },
  { name: 'large-dark-320', width: 320, colorScheme: 'dark', scale: 2, reducedMotion: 'reduce' },
];
const results = [];
try {
  for (const config of configurations) {
    const context = await browser.newContext({ viewport: { width: config.width, height: 844 }, colorScheme: config.colorScheme, reducedMotion: config.reducedMotion });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const visible = id => page.locator(`[data-testid="${id}"]:visible`);
    const drawn = unit => visible('growth-ring').locator(`[data-testid="time-layer-${unit}"]`);
    const check = async () => {
      if (config.scale > 1) await page.evaluate(scale => {
        for (const el of document.querySelectorAll('*')) {
          if (!(el instanceof HTMLElement) || el.dataset.layersQaScaled || ![...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue;
          const css = getComputedStyle(el), line = parseFloat(css.lineHeight);
          el.style.fontSize = `${parseFloat(css.fontSize) * scale}px`;
          if (Number.isFinite(line)) el.style.lineHeight = `${line * scale}px`;
          el.dataset.layersQaScaled = 'true';
        }
      }, config.scale);
      await page.waitForTimeout(420);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'document overflow');
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-testid="demo-scroll"]')].filter(el => el.getBoundingClientRect().width > 0).some(el => el.scrollWidth > el.clientWidth + 1)), false, 'content overflow');
    };
    const choose = async name => { await page.getByRole('button', { name: 'デモの時間を切り替える', exact: true }).click(); await page.getByRole('button', { name, exact: true }).click(); await check(); };
    const shot = async name => {
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); for (const el of document.querySelectorAll('*')) if (el instanceof HTMLElement && el.scrollTop) el.scrollTo({ top: 0, behavior: 'instant' }); });
      await page.waitForTimeout(250); await page.screenshot({ path: `${output}/${config.name}-${name}.png` });
    };
    await page.goto(root + 'reflection?look=layers'); await visible('growth-visual-layers').waitFor();
    await page.waitForFunction(dark => getComputedStyle(document.querySelector('[data-testid="growth-whole"]')).color === (dark ? 'rgb(240, 240, 233)' : 'rgb(48, 49, 47)'), config.colorScheme === 'dark');
    await check();
    assert.equal(await drawn('day').count(), 1); assert.equal(await drawn('hour').count(), 6);
    await shot('initial');
    await page.getByRole('button', { name: '1時間を重ねる', exact: true }).click(); await check();
    assert.equal(await visible('growth-tail').innerText(), '＋7時間'); assert.equal(await drawn('hour').count(), 7);
    await page.getByRole('button', { name: '1回戻す', exact: true }).click(); await check();
    assert.equal(await visible('growth-tail').innerText(), '＋6時間'); assert.equal(await drawn('hour').count(), 6);
    await page.getByRole('button', { name: '前の期間', exact: true }).click();
    assert.equal(await visible('growth-unit').innerText(), '日分');
    await page.getByRole('button', { name: '月次', exact: true }).click(); assert.equal(await visible('growth-unit').innerText(), '日分');
    await page.getByRole('button', { name: '週次', exact: true }).click();
    for (const [name, unit, beforeHour, beforeDay, beforeMonth] of [
      ['1日分になる直前', '日分', 23, 0, 0],
      ['1か月分になる直前', 'か月分', 23, 29, 0],
      ['1年分になる直前', '年分', 23, 4, 12],
    ]) {
      await choose(name);
      assert.equal(await drawn('hour').count(), beforeHour); assert.equal(await drawn('day').count(), beforeDay); assert.equal(await drawn('month').count(), beforeMonth);
      await shot(unit + '-before');
      const step = page.getByRole('button', { name: unit === '年分' ? '1日分を重ねる' : '1時間を重ねる', exact: true });
      await step.click(); await check();
      assert.equal(await visible('growth-whole').innerText(), '1'); assert.equal(await visible('growth-unit').innerText(), unit);
      assert.match(await visible('layer-action-status').innerText(), /束になりました/);
      assert.equal(await drawn(unit === '日分' ? 'day' : unit === 'か月分' ? 'month' : 'year').count(), 1);
      if (config.reducedMotion === 'reduce') {
        const transform = await visible('layer-motion').evaluate(el => getComputedStyle(el).transform);
        assert.equal(await visible('layer-motion').evaluate(el => { const value = getComputedStyle(el).transform; return value === 'none' || new DOMMatrixReadOnly(value).m22 === 1; }), true);
      }
      await shot(unit + '-after');
    }
    await choose('年分 · 438日');
    assert.equal(await drawn('year').count(), 1); assert.equal(await drawn('month').count(), 2); assert.equal(await drawn('day').count(), 13);
    await shot('year-detail');
    if (config.name === 'light-390') { await visible('time-layer-summary').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/year-breakdown.png` }); }
    await choose('一部未記録 · 既知30時間'); assert.match(await visible('growth-partial').innerText(), /確認できた時間だけ/);
    await choose('記録あり · 0分'); assert.equal(await visible('growth-whole').innerText(), '0'); assert.equal(await drawn('hour').count(), 0);
    await page.getByRole('button', { name: '1時間を重ねる', exact: true }).click(); await check(); assert.equal(await drawn('hour').count(), 1);
    await choose('まだ記録なし');
    assert.equal(await visible('growth-whole').innerText(), '—'); assert(await page.getByRole('button', { name: '1時間を重ねる', exact: true }).isDisabled());
    await choose('1日分になる直前');
    for (let n = 0; n < 3; n++) await page.getByRole('button', { name: '1時間を重ねる', exact: true }).click();
    await check(); assert.equal(await visible('growth-tail').innerText(), '＋2時間50分'); assert.equal(await drawn('hour').count(), 2);
    await page.getByRole('tab', { name: 'ホーム', exact: true }).click();
    await page.getByRole('button', { name: '新しい振り返りを見る', exact: true }).click(); await visible('growth-visual-layers').waitFor(); await check();
    assert.equal(await visible('growth-tail').innerText(), '＋2時間50分');
    await page.getByRole('tab', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: '振り返りに戻る', exact: true }).click(); await visible('growth-visual-layers').waitFor();
    await page.getByRole('button', { name: '1時間を重ねる', exact: true }).focus(); await page.keyboard.press('Space'); await check();
    assert.equal(await visible('growth-tail').innerText(), '＋3時間50分');
    if (config.scale > 1) { await visible('growth-readout').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/large-readout.png` }); }
    await choose('1日分になる直前'); await page.getByRole('button', { name: '1時間を重ねる', exact: true }).click();
    await page.getByRole('button', { name: 'デモの時間を切り替える', exact: true }).click(); await page.getByRole('button', { name: 'まだ記録なし', exact: true }).click(); await check();
    assert.equal(await visible('growth-whole').innerText(), '—'); assert.equal(await drawn('day').count(), 0); assert.equal(await drawn('hour').count(), 0);
    assert.deepEqual(errors, []);
    results.push({ ...config, hourAddsRealLayer: true, undoExact: true, dayMonthYearBundle: true, remainderFullyRepresented: true, rapidInputAndSceneCancellation: true, noUnknownAddition: true, tabState: 'PASS', keyboard: 'PASS', noHorizontalOverflow: true, pageErrors: errors });
    await context.close();
  }
  writeFileSync(`${output}/results.json`, JSON.stringify({ url: root, browser: browser.version(), scope: 'synthetic Web only; DOM scaling is not Dynamic Type; no native verification', results }, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
