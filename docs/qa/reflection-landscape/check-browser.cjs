const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { writeFileSync } = require('node:fs');
const path = require('node:path');

const assert = (test, message) => { if (!test) throw Error(message); };
const output = __dirname;
const button = (page, name) => page.getByRole('button', { name, exact: true });
const shot = (page, name) => page.screenshot({ path: path.join(output, name + '.png') });
const total = (page, value) => page.getByTestId('reflection-total').filter({ hasText: value });
async function drag(page, vertical = false) {
  const plot = page.getByTestId('reflection-plot');
  await plot.scrollIntoViewIfNeeded();
  const box = await plot.boundingBox();
  const session = await page.context().newCDPSession(page);
  const x = box.x + box.width * 0.82, y = box.y + box.height * (vertical ? 0.85 : 0.5);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
      x: x - (vertical ? 0 : box.width * 0.38 * i / 10), y: y - (vertical ? 100 * i / 10 : 0),
    }] });
    await page.waitForTimeout(15);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.ITOMA_QA_CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const result = { browser: browser.version(), evidence: 'Synthetic responses through the normal product providers and Expo Router', cases: [] };
  try {
    for (const [name, width, height, colorScheme, fixture, scale] of [
      ['light', 390, 844, 'light', 'month', 1], ['dark', 390, 844, 'dark', 'month', 1],
      ['large', 320, 750, 'dark', 'month', 1.75], ['long', 390, 844, 'light', 'long', 1],
    ]) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, colorScheme, reducedMotion: 'reduce', timezoneId: 'UTC' });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const start = Date.now();
      await page.goto('http://localhost:8087/?fixture=' + fixture, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.getByText('この環境では制限機能を利用できません。対応するiPhone版をご利用ください。').waitFor();
      await page.getByRole('tab', { name: '振り返り', exact: true }).click();
      await page.getByText('全期間', { exact: true }).waitFor({ timeout: 90000 });
      const loadedMs = Date.now() - start;
      const expected = fixture === 'long' ? /約.*1.*年分.*73日/ : /1.*日分.*6時間/;
      await total(page, expected).waitFor();
      if (scale > 1) {
        await page.evaluate(scale => {
          const nodes = [...document.querySelectorAll('[dir="auto"]')].map(node => [node, parseFloat(getComputedStyle(node).fontSize), parseFloat(getComputedStyle(node).lineHeight)]);
          for (const [node, size, line] of nodes) {
            node.style.fontSize = size * scale + 'px';
            if (Number.isFinite(line)) node.style.lineHeight = line * scale + 'px';
          }
        }, scale);
      }
      await shot(page, name);
      const size = await button(page, '前日').boundingBox();
      assert(size.width >= 44 && size.height >= 44, 'previous day target too small');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert(!overflow, 'horizontal page overflow');
      if (name === 'light' || name === 'long') {
        const reads = () => page.evaluate(() => window.landscapeReads.filter(r => r.action === 'readWeek').length);
        assert(await reads() === 0, 'latest did not use the seeded week');
        const scroll = page.getByTestId('product-tab-scene-reflection').getByTestId('flow-scroll');
        await page.getByTestId('reflection-plot').scrollIntoViewIfNeeded();
        const before = await scroll.evaluate(el => el.scrollTop);
        await drag(page, true);
        await page.waitForFunction(before => document.querySelector('[data-testid=product-tab-scene-reflection] [data-testid=flow-scroll]').scrollTop > before, before);
        assert(await page.getByText('全期間', { exact: true }).count() === 1, 'vertical touch changed date');
        const anchor = await page.getByRole('heading', { name: /からの週/ }).innerText();
        await drag(page);
        await page.getByText('この日までの累計', { exact: true }).waitFor();
        await page.getByTestId('reflection-total').waitFor();
        assert(await page.getByRole('heading', { name: /からの週/ }).innerText() === anchor, 'scrub changed period');
        await scroll.evaluate(el => { el.scrollTop = 0; });
        await shot(page, name + '-history');
        const label = await page.getByTestId('reflection-total').innerText();
        await button(page, '月次').click();
        await page.getByRole('heading', { name: '2026年11月', exact: true }).waitFor();
        assert(await page.getByTestId('reflection-total').innerText() === label, 'period changed date');
        await button(page, '最新に戻す').click();
        await total(page, expected).waitFor();
        await button(page, '集計について').click();
        await page.getByText(/24時間を1日分/).waitFor();
      }
      assert(errors.length === 0, errors.join('\n'));
      result.cases.push({ name, width, height, colorScheme, domTextScale: scale, loadedMs, actionSize: size, reads: await page.evaluate(() => window.landscapeReads), errors });
      await context.close();
    }
    result.passed = true;
  } catch (error) { result.passed = false; result.error = error.stack; throw error; }
  finally { writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n'); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
