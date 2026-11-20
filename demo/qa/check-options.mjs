import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? '/tmp/itoma-offhours-browser/node_modules/playwright');
const root = process.env.DEMO_QA_URL ?? 'http://127.0.0.1:8801/demos/demo-reflection-visual-options-99c0f4050111/';
const output = process.env.DEMO_QA_OUTPUT ?? '/tmp/itoma-four-evidence';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const cases = [
  { name: 'light-390', width: 390, colorScheme: 'light', scale: 1, reducedMotion: 'no-preference' },
  { name: 'dark-390', width: 390, colorScheme: 'dark', scale: 1, reducedMotion: 'reduce' },
  { name: 'light-320', width: 320, colorScheme: 'light', scale: 1, reducedMotion: 'reduce' },
  { name: 'large-dark-320', width: 320, colorScheme: 'dark', scale: 2, reducedMotion: 'reduce' },
];
const results = [];
try {
  for (const config of cases) {
    const context = await browser.newContext({ viewport: { width: config.width, height: 844 }, colorScheme: config.colorScheme, reducedMotion: config.reducedMotion });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const visible = id => page.locator(`[data-testid="${id}"]:visible`);
    const check = async () => {
      if (config.scale > 1) await page.evaluate(scale => {
        for (const el of document.querySelectorAll('*')) {
          if (!(el instanceof HTMLElement) || el.dataset.demoQaScale || ![...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) continue;
          const style = getComputedStyle(el), line = parseFloat(style.lineHeight);
          el.style.fontSize = `${parseFloat(style.fontSize) * scale}px`;
          if (Number.isFinite(line)) el.style.lineHeight = `${line * scale}px`;
          el.dataset.demoQaScale = 'true';
        }
      }, config.scale);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'document overflow');
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-testid="demo-scroll"]')].filter(el => el.getBoundingClientRect().width > 0).some(el => el.scrollWidth > el.clientWidth + 1)), false, 'content overflow');
    };
    const choose = async name => { await page.getByRole('button', { name: 'デモの記録を切り替える', exact: true }).click(); await page.getByRole('button', { name, exact: true }).click(); await check(); };
    const mode = async name => { await page.getByRole('button', { name: '表示案を切り替える', exact: true }).click(); await page.getByRole('button', { name, exact: true }).click(); await check(); };
    const shot = async name => {
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); for (const el of document.querySelectorAll('*')) if (el instanceof HTMLElement && el.scrollTop) el.scrollTo({ top: 0, behavior: 'instant' }); });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${output}/${config.name}-${name}.png` });
    };
    await page.goto(root + 'blocks');
    await visible('visual-total').waitFor();
    await page.waitForFunction(dark => getComputedStyle([...document.querySelectorAll('[data-testid="visual-total"]')].find(el => el.getBoundingClientRect().width > 0)).color === (dark ? 'rgb(240, 240, 233)' : 'rgb(48, 49, 47)'), config.colorScheme === 'dark');
    assert.equal(await visible('visual-total').innerText(), '4時間13分');
    assert.equal(await visible('full-block').count(), 4); assert.equal(await visible('partial-block').count(), 1);
    await check(); await shot('blocks');
    await page.getByRole('button', { name: '月次', exact: true }).click();
    assert.equal(await visible('visual-total').innerText(), '4時間13分'); assert.equal(await visible('visual-period-total').innerText(), '4時間13分');
    await page.getByRole('button', { name: '週次', exact: true }).click();
    await page.getByRole('button', { name: '前の期間', exact: true }).click();
    assert.equal(await visible('visual-period-total').innerText(), '45分');
    assert.equal(await visible('visual-total').innerText(), '4時間13分');
    await mode('02 週ごとの積み上げ');
    await page.getByRole('button', { name: '11/2からの週を見る', exact: true }).click();
    assert.match(await visible('selected-week-days').innerText(), /25分/);
    assert.equal(await visible('visual-total').innerText(), '4時間13分');
    await check(); await shot('weeks');
    await mode('03 カレンダー');
    await page.getByRole('button', { name: '月次', exact: true }).click();
    assert.equal(await visible('calendar-period-total').innerText(), '4時間13分');
    assert.equal(await visible('calendar-2026-11-21').isDisabled(), true);
    await visible('calendar-2026-11-02').click();
    assert.equal(await visible('calendar-day-total').innerText(), '25分');
    const size = await visible('calendar-2026-11-02').boundingBox();
    assert(size.width >= 44 && size.height >= 44, `calendar hit target ${size.width}x${size.height}`);
    await check(); await shot('calendar');
    if (config.name === 'light-390') { await visible('calendar-detail').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/calendar-detail.png` }); }
    await page.getByRole('button', { name: '時間帯を見る', exact: true }).click();
    assert.equal(await visible('timeline-date').innerText(), '11/2');
    assert.equal(await visible('timeline-total').innerText(), '25分');
    await page.getByRole('button', { name: '1日全体', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '1日全体', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: '記録した時間帯', exact: true }).click();
    await page.getByRole('button', { name: '次の日', exact: true }).click();
    assert.equal(await visible('timeline-total').innerText(), '0分');
    await page.getByRole('button', { name: '前の日', exact: true }).click();
    assert.equal(await visible('timeline-total').innerText(), '25分');
    await check(); await shot('day');
    if (config.name === 'light-390') { await visible('day-timeline').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/day-detail.png` }); }
    await page.getByRole('button', { name: 'カレンダーに戻る', exact: true }).click();
    assert.equal(await visible('calendar-day-total').innerText(), '25分');
    assert.equal(await page.getByRole('button', { name: '月次', exact: true }).getAttribute('aria-selected'), 'true');
    for (const [name, path] of [['01 時間のブロック', 'blocks'], ['02 週ごとの積み上げ', 'weeks'], ['03 カレンダー', 'calendar'], ['04 1日の時間帯', 'day']]) {
      await mode(name);
      for (const [dataset, expected] of [['一部の記録なし', '4時間'], ['まだ記録なし', '—'], ['記録あり · 0分', '0分'], ['長期間の積み上げ', '85時間13分'], ['通常 · 4時間13分', '4時間13分'], ['複数週 · 4時間13分', '4時間13分']]) {
        await choose(dataset);
        assert.equal(await visible('visual-total').innerText(), expected, `${path} ${dataset}`);
        if (['—', '0分'].includes(expected) && path === 'blocks') assert.equal(await visible('time-blocks').count(), 0);
        if (['—', '0分'].includes(expected) && path === 'weeks') assert.equal(await visible('weekly-stack').count(), 0);
        if (expected === '—' && path === 'day') { assert.equal(await visible('timeline-total').innerText(), '—'); assert.match(await visible('day-timeline').getAttribute('aria-label'), /未記録/); }
      }
    }
    await mode('03 カレンダー'); await choose('一部の記録なし');
    await visible('calendar-2026-11-18').click();
    assert.equal(await visible('calendar-day-total').innerText(), '未記録');
    await page.getByRole('button', { name: '時間帯を見る', exact: true }).click();
    assert.equal(await visible('timeline-total').innerText(), '—');
    assert.match(await visible('day-timeline').getAttribute('aria-label'), /未記録/);
    await mode('比較：累積グラフ');
    assert.equal(await visible('reflection-total').innerText(), '4時間');
    await choose('複数週 · 4時間13分'); assert.equal(await visible('reflection-total').innerText(), '4時間13分');
    await page.getByRole('button', { name: '表示案を切り替える', exact: true }).focus(); await page.keyboard.press('Enter');
    await page.getByRole('button', { name: '01 時間のブロック', exact: true }).focus(); await page.keyboard.press('Space');
    assert.equal(await visible('visual-total').innerText(), '4時間13分');
    await page.getByRole('tab', { name: 'ホーム', exact: true }).click();
    await page.getByRole('button', { name: '03 カレンダー', exact: true }).click();
    assert.equal(await visible('calendar-day-total').innerText(), '40分');
    await check(); assert.deepEqual(errors, []);
    results.push({ ...config, routes: 5, datasetsPerOption: 6, stableGlobalTotal: true, calendarHitTarget: size, calendarToDayAndBack: true, zeroVersusUnknown: true, keyboard: 'PASS', noHorizontalOverflow: true, pageErrors: errors });
    await context.close();
  }
  writeFileSync(`${output}/results.json`, JSON.stringify({ url: root, browser: browser.version(), scope: 'synthetic Web; DOM text scaling is not iOS Dynamic Type; no native verification', results }, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
