import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? '/tmp/itoma-offhours-browser/node_modules/playwright');
const base = process.env.DEMO_QA_URL ?? 'http://127.0.0.1:8811/demos/demo-reflection-time-landscape-052ffc2ff06f/';
const output = process.env.DEMO_QA_OUTPUT ?? '/tmp/itoma-landscape-evidence';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  for (const [name, width, colorScheme, large] of [['light', 390, 'light', false], ['dark', 390, 'dark', false], ['large', 320, 'light', true]]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, colorScheme, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + 'reflection');
    if (large) await page.addStyleTag({ content: 'html {font-size:200%!important}' });
    const total = page.getByTestId('print-total'), slider = page.getByRole('slider');
    await slider.waitFor();
    const text = async () => (await total.innerText()).replace(/\s+/g, '');
    assert.equal(await text(), '1日分と6時間');
    await page.screenshot({ path: output + '/' + name + '.png' });
    await slider.focus();
    await slider.press('Home');
    assert.equal(await text(), '20分');
    assert.equal(await slider.getAttribute('aria-valuenow') ?? await slider.inputValue(), '0');
    await slider.press('ArrowRight');
    assert.equal(await text(), '45分');
    await page.getByRole('button', { name: '前日の記録' }).click();
    assert.equal(await text(), '20分');
    await page.getByRole('button', { name: '最新に戻す' }).click();
    assert.equal(await text(), '1日分と6時間');
    assert.equal(await page.getByRole('button', { name: '翌日の記録' }).isDisabled(), true);
    const box = await slider.boundingBox();
    await page.mouse.move(box.x + box.width - 7, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    assert.notEqual(await text(), '1日分と6時間');
    await page.screenshot({ path: output + '/' + name + '-history.png' });
    await page.getByRole('button', { name: '最新に戻す' }).click();
    await page.getByRole('button', { name: '月', exact: true }).click();
    await page.getByRole('button', { name: '前の期間' }).click();
    assert.equal(await text(), '1日分と6時間');
    assert.match(await page.locator('.leaf-period-nav').innerText(), /2026年10月/);
    await page.getByText('集計について', { exact: true }).click();
    assert.match(await page.locator('.leaf-details').innerText(), /30時間/);
    for (const [label, expected] of [['4時間13分','4時間13分'], ['40日分','約1か月分と10日'], ['438日分','約1年分と73日'], ['一部未記録','1日分と6時間'], ['記録あり・0分','0分'], ['まだ記録なし','—']]) {
      await page.getByRole('button', { name: /デモ設定/ }).click();
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.waitForFunction(expected => document.querySelector('[data-testid="print-total"]')?.textContent?.replace(/\s+/g, '') === expected, expected);
      if (label === '一部未記録') {
        await slider.focus();
        await slider.press('Home');
        for (let i = 0; i < 7; i++) await slider.press('ArrowRight');
        assert.equal(await text(), '—');
        assert.match(await page.locator('.leaf-day-value').innerText(), /未記録/);
        await slider.press('ArrowRight');
        assert.match(await page.locator('.print-caveat').innerText(), /確認できた分/);
      }
      assert(await page.evaluate(() => {
        const scroll = document.querySelector('.leaf-scroll');
        return scroll.scrollWidth <= scroll.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1;
      }), label + ' horizontal overflow');
    }
    assert.equal(await slider.count(), 0);
    await page.getByRole('tab', { name: 'ホーム' }).click();
    await page.getByRole('button', { name: '新しい振り返りを見る' }).click();
    await slider.waitFor();
    await page.getByRole('tab', { name: '設定' }).click();
    await page.getByRole('button', { name: '振り返りに戻る' }).click();
    await slider.waitFor();
    await page.goto(base + 'reflection?look=layers');
    await page.getByTestId('growth-visual-layers').waitFor();
    assert.deepEqual(errors, []);
    console.log(name + ' — total, scrub, return, period, seven datasets, missing day, overflow, navigation and previous design passed');
    await page.close();
  }
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await touch.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + 'reflection?scene=years');
  await page.waitForFunction(() => document.querySelector('[data-testid="print-total"]')?.textContent.includes('73日'));
  const slider = page.getByRole('slider');
  const box = await slider.boundingBox(), x = box.x + box.width * .92, y = box.y + box.height / 2;
  const session = await touch.newCDPSession(page);
  const finger = (type, touchPoints) => session.send('Input.dispatchTouchEvent', { type, touchPoints });
  await finger('touchStart', [{ x, y }]);
  for (let i = 1; i <= 8; i++) await finger('touchMove', [{ x: x - i * box.width / 11, y }]);
  await finger('touchEnd', []);
  await page.getByRole('button', { name: '最新に戻す' }).waitFor();
  const value = Number(await slider.inputValue()), max = Number(await slider.getAttribute('max'));
  assert(value < max * .4 && value > max * .1, 'touch drag selects a past date');
  await page.getByRole('button', { name: '最新に戻す' }).tap();
  assert.equal(Number(await slider.inputValue()), max);
  assert.deepEqual(errors, []);
  console.log('touch drag and return on a direct multi-year link passed (Chromium emulation)');
  await touch.close();
} finally { await browser.close(); }
