import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? '/tmp/itoma-offhours-browser/node_modules/playwright');
const root = process.env.DEMO_QA_URL ?? 'http://127.0.0.1:8802/demos/demo-reflection-time-growth-6298931a0a49/';
const output = process.env.DEMO_QA_OUTPUT ?? '/tmp/itoma-growth-evidence';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const configurations = [
  { name: 'light-390', width: 390, colorScheme: 'light', reducedMotion: 'no-preference', scale: 1 },
  { name: 'dark-390', width: 390, colorScheme: 'dark', reducedMotion: 'reduce', scale: 1 },
  { name: 'light-320', width: 320, colorScheme: 'light', reducedMotion: 'reduce', scale: 1 },
  { name: 'large-dark-320', width: 320, colorScheme: 'dark', reducedMotion: 'reduce', scale: 2 },
];
const results = [];
try {
  for (const config of configurations) {
    const context = await browser.newContext({ viewport: { width: config.width, height: 844 }, colorScheme: config.colorScheme, reducedMotion: config.reducedMotion });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const visible = id => page.locator(`[data-testid="${id}"]:visible`);
    const check = async () => {
      if (config.scale > 1) await page.evaluate(scale => {
        for (const el of document.querySelectorAll('*')) {
          if (!(el instanceof HTMLElement) || el.dataset.growthQaScaled || ![...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) continue;
          const css = getComputedStyle(el), line = parseFloat(css.lineHeight);
          el.style.fontSize = `${parseFloat(css.fontSize) * scale}px`;
          if (Number.isFinite(line)) el.style.lineHeight = `${line * scale}px`;
          el.dataset.growthQaScaled = 'true';
        }
      }, config.scale);
      await page.waitForTimeout(270);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'document overflow');
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-testid="demo-scroll"]')].filter(el => el.getBoundingClientRect().width > 0).some(el => el.scrollWidth > el.clientWidth + 1)), false, 'content overflow');
    };
    const top = async () => { await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); for (const el of document.querySelectorAll('*')) if (el instanceof HTMLElement && el.scrollTop) el.scrollTo({ top: 0, behavior: 'instant' }); }); await page.waitForTimeout(300); };
    const choose = async name => { await page.getByRole('button', { name: 'デモの時間を切り替える', exact: true }).click(); await page.getByRole('button', { name, exact: true }).click(); await check(); };
    const shot = async name => { await top(); await page.screenshot({ path: `${output}/${config.name}-${name}.png` }); };
    await page.goto(root + 'reflection?look=original');
    await visible('growth-whole').waitFor();
    await page.waitForFunction(dark => getComputedStyle(document.querySelector('[data-testid="growth-whole"]')).color === (dark ? 'rgb(240, 240, 233)' : 'rgb(48, 49, 47)'), config.colorScheme === 'dark');
    await check();
    assert.equal(await visible('growth-whole').innerText(), '1');
    assert.equal(await visible('growth-unit').innerText(), '日分');
    assert.equal(await visible('growth-tail').innerText(), '＋6時間');
    await shot('days');
    await page.getByRole('button', { name: '時間の内訳と換算方法', exact: true }).click();
    assert.equal(await visible('growth-exact-total').innerText(), '30時間');
    assert.match(await visible('growth-details').innerText(), /30日.*365日/);
    await check();
    await page.getByRole('button', { name: '月次', exact: true }).click();
    assert.equal(await visible('growth-exact-total').innerText(), '30時間');
    await page.getByRole('button', { name: '週次', exact: true }).click();
    await page.getByRole('button', { name: '前の期間', exact: true }).click();
    assert.equal(await visible('growth-period-total').innerText(), '12時間');
    assert.equal(await visible('growth-whole').innerText(), '1');
    await page.getByRole('button', { name: '次の期間', exact: true }).click();
    await page.getByRole('button', { name: '時間の内訳と換算方法', exact: true }).click();
    for (const [label, whole, unit, tail, name] of [
      ['時間分 · 4時間13分', '4', '時間分', '＋13分', 'hours'],
      ['か月分 · 40日', '1', 'か月分', '＋10日', 'months'],
      ['年分 · 438日', '1', '年分', '＋73日', 'years'],
    ]) {
      await choose(label);
      assert.equal(await visible('growth-whole').innerText(), whole);
      assert.equal(await visible('growth-unit').innerText(), unit);
      assert.equal(await visible('growth-tail').innerText(), tail);
      if (name !== 'hours') assert.match(await visible('growth-ring').getAttribute('aria-label'), /^約/);
      await shot(name);
    }
    if (config.name === 'light-390') { await visible('growth-milestones').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/year-milestones.png` }); }
    const boundaries = [];
    for (const [before, after, unit] of [['1日分になる直前', '1日分になったところ', '日分'], ['1か月分になる直前', '1か月分になったところ', 'か月分'], ['1年分になる直前', '1年分になったところ', '年分']]) {
      await choose(before);
      assert.notEqual(await visible('growth-unit').innerText(), unit);
      if (config.name === 'light-390') await shot(unit + '-before');
      await page.getByRole('button', { name: '20分を重ねる', exact: true }).click(); await check();
      assert.equal(await visible('growth-unit').innerText(), unit);
      assert.equal(await visible('growth-whole').innerText(), '1');
      assert.equal(await visible('growth-tail').innerText(), '＋10分');
      assert.match(await page.getByRole('button', { name: 'デモの時間を切り替える', exact: true }).innerText(), new RegExp(after));
      if (config.name === 'light-390') await shot(unit + '-after');
      boundaries.push(unit);
    }
    await choose('一部未記録 · 既知30時間');
    assert.equal(await visible('growth-whole').innerText(), '1');
    assert.match(await visible('growth-partial').innerText(), /確認できた時間だけ/);
    await choose('記録あり · 0分');
    assert.equal(await visible('growth-whole').innerText(), '0');
    assert.equal(await visible('growth-unit').innerText(), '分');
    assert.equal(await visible('growth-arc').count(), 0);
    assert.equal(await visible('growth-milestones').count(), 0);
    await shot('zero');
    await choose('まだ記録なし');
    assert.equal(await visible('growth-whole').innerText(), '—');
    assert.equal(await visible('growth-ring').locator('[data-testid="growth-unit"]').innerText(), '');
    assert.match(await visible('growth-ring').getAttribute('aria-label'), /まだ記録がありません/);
    assert(await page.getByRole('button', { name: '週次', exact: true }).isDisabled());
    await shot('empty');
    await page.getByRole('button', { name: 'デモの時間を切り替える', exact: true }).focus(); await page.keyboard.press('Enter');
    await page.getByRole('button', { name: '年分 · 438日', exact: true }).focus(); await page.keyboard.press('Space');
    await check();
    await page.getByRole('tab', { name: 'ホーム', exact: true }).click();
    await page.getByRole('button', { name: '新しい振り返りを見る', exact: true }).click();
    assert.equal(await visible('growth-unit').innerText(), '年分');
    await page.getByRole('tab', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: '振り返りに戻る', exact: true }).click();
    assert.equal(await visible('growth-tail').innerText(), '＋73日');
    await check(); assert.deepEqual(errors, []);
    results.push({ ...config, stages: 4, boundaries, exactSecondsConserved: 'model tests', unknownVersusZero: true, periodDoesNotChangeGlobal: true, keyboard: 'PASS', tabReturnState: 'PASS', pageErrors: errors, noHorizontalOverflow: true });
    await context.close();
  }
  const page = await browser.newPage();
  const legacy = [];
  for (const route of ['blocks', 'weeks', 'calendar', 'day', 'cumulative']) {
    assert.equal((await page.goto(root + route)).status(), 200);
    await page.locator(`[data-testid="${route === 'cumulative' ? 'reflection-total' : 'visual-total'}"]:visible`).waitFor();
    legacy.push(route);
  }
  await page.close();
  writeFileSync(`${output}/results.json`, JSON.stringify({ url: root, browser: browser.version(), scope: 'synthetic Web; DOM scaling is not Dynamic Type; no native verification', results, legacyDirectRoutes: legacy }, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
