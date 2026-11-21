import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? '/tmp/itoma-offhours-browser/node_modules/playwright');
const root = process.env.DEMO_QA_URL ?? 'http://127.0.0.1:8803/demos/demo-reflection-circle-styles-54c2ab75f200/';
const output = process.env.DEMO_QA_OUTPUT ?? '/tmp/itoma-circle-styles-evidence';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const styles = [['rings', 'A 重なる輪'], ['ticks', 'B 粒の輪'], ['disc', 'C まるい余白'], ['original', '比較 元のサークル']];
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
    const check = async () => {
      if (config.scale > 1) await page.evaluate(scale => {
        for (const el of document.querySelectorAll('*')) {
          if (!(el instanceof HTMLElement) || el.dataset.circleQaScaled || ![...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue;
          const css = getComputedStyle(el), line = parseFloat(css.lineHeight);
          el.style.fontSize = `${parseFloat(css.fontSize) * scale}px`;
          if (Number.isFinite(line)) el.style.lineHeight = `${line * scale}px`;
          el.dataset.circleQaScaled = 'true';
        }
      }, config.scale);
      await page.waitForTimeout(260);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'document overflow');
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-testid="demo-scroll"]')].filter(el => el.getBoundingClientRect().width > 0).some(el => el.scrollWidth > el.clientWidth + 1)), false, 'content overflow');
    };
    const choose = async name => { await page.getByRole('button', { name: 'デモの時間を切り替える', exact: true }).click(); await page.getByRole('button', { name, exact: true }).click(); await check(); };
    const selectStyle = async name => { await page.getByRole('button', { name: 'サークルのデザインを切り替える', exact: true }).click(); await page.getByRole('button', { name, exact: true }).click(); await check(); };
    const shot = async name => {
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); for (const el of document.querySelectorAll('*')) if (el instanceof HTMLElement && el.scrollTop) el.scrollTo({ top: 0, behavior: 'instant' }); });
      await page.waitForTimeout(300); await page.screenshot({ path: `${output}/${config.name}-${name}.png` });
    };
    await page.goto(root + 'reflection?look=rings'); await visible('growth-visual-rings').waitFor();
    await page.waitForFunction(dark => getComputedStyle(document.querySelector('[data-testid="growth-whole"]')).color === (dark ? 'rgb(240, 240, 233)' : 'rgb(48, 49, 47)'), config.colorScheme === 'dark');
    await page.getByRole('button', { name: '前の期間', exact: true }).click();
    for (const [id, label] of styles) {
      const before = await visible('growth-readout').innerText(), period = await visible('growth-period-title').innerText();
      await selectStyle(label);
      assert.equal(await visible('growth-readout').innerText(), before, 'style changes value');
      assert.equal(await visible('growth-period-title').innerText(), period, 'style changes period');
      assert.equal(new URL(page.url()).searchParams.get('look'), id);
      assert.equal(await visible(`growth-visual-${id}`).count(), 1);
      for (const [scene, whole, unit, tail, layers, key] of [
        ['時間分 · 4時間13分', '4', '時間分', '＋13分', 1, 'hours'],
        ['日分 · 30時間', '1', '日分', '＋6時間', 2, 'days'],
        ['か月分 · 40日', '1', 'か月分', '＋10日', 3, 'months'],
        ['年分 · 438日', '1', '年分', '＋73日', 4, 'years'],
      ]) {
        await choose(scene);
        assert.equal(await visible('growth-whole').innerText(), whole);
        assert.equal(await visible('growth-unit').innerText(), unit);
        assert.equal(await visible('growth-tail').innerText(), tail);
        assert.equal(await visible(`growth-visual-${id}`).count(), 1);
        if (id === 'rings') assert.equal(await visible('growth-layer').count(), layers);
        if (id !== 'original') assert.equal(await visible('growth-arc').count(), 0);
        if (key === 'days' || config.name === 'light-390' && key === 'years') {
          await shot(`${id}-${key}`);
          if (config.scale > 1) { await visible('growth-readout').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/${id}-large-readout.png` }); }
        }
      }
      await page.getByRole('button', { name: '時間の内訳と換算方法', exact: true }).click();
      assert.equal(await visible('growth-exact-total').innerText(), '10512時間');
      const info = await visible('growth-details').innerText();
      if (id === 'rings') assert.match(info, /輪1本が1日分という意味ではありません/);
      if (id === 'ticks') assert.match(info, /固定の模様/);
      if (id === 'disc') assert.match(info, /面積に時間の量を割り当てず/);
      await page.getByRole('button', { name: '時間の内訳と換算方法', exact: true }).click();
      if (config.name === 'light-390') for (const [before, unit] of [['1日分になる直前', '日分'], ['1か月分になる直前', 'か月分'], ['1年分になる直前', '年分']]) {
        await choose(before); await page.getByRole('button', { name: '20分を重ねる', exact: true }).click(); await check();
        assert.equal(await visible('growth-unit').innerText(), unit);
        assert.equal(await visible('growth-tail').innerText(), '＋10分');
        assert.equal(await visible(`growth-visual-${id}`).count(), 1);
      }
      await choose('一部未記録 · 既知30時間'); assert.match(await visible('growth-partial').innerText(), /確認できた時間だけ/);
      await choose('記録あり · 0分'); assert.equal(await visible('growth-whole').innerText(), '0'); assert.equal(await visible('growth-layer').count(), 0);
      await choose('まだ記録なし'); assert.equal(await visible('growth-whole').innerText(), '—'); assert.match(await visible('growth-ring').getAttribute('aria-label'), /まだ記録がありません/);
      await choose('日分 · 30時間');
    }
    await page.getByRole('button', { name: 'サークルのデザインを切り替える', exact: true }).focus(); await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'C まるい余白', exact: true }).focus(); await page.keyboard.press('Space'); await check();
    await page.getByRole('tab', { name: 'ホーム', exact: true }).click();
    await page.getByRole('button', { name: '新しい振り返りを見る', exact: true }).click(); await visible('growth-visual-disc').waitFor();
    await page.getByRole('tab', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: '振り返りに戻る', exact: true }).click(); await visible('growth-visual-disc').waitFor();
    await check(); assert.deepEqual(errors, []);
    results.push({ ...config, styles: 4, stagesPerStyle: 4, partialZeroEmpty: true, stylePreservesValueAndPeriod: true, newStylesHaveNoProgressArc: true, keyboard: 'PASS', tabReturnStyle: 'PASS', noHorizontalOverflow: true, pageErrors: errors });
    await context.close();
  }
  for (const [id] of styles) {
    const page = await browser.newPage(); assert.equal((await page.goto(root + 'reflection?look=' + id)).status(), 200);
    await page.locator(`[data-testid="growth-visual-${id}"]:visible`).waitFor(); await page.close();
  }
  const invalid = await browser.newPage(); await invalid.goto(root + 'reflection?look=unknown'); await invalid.locator('[data-testid="growth-visual-layers"]:visible').waitFor(); await invalid.close();
  writeFileSync(`${output}/results.json`, JSON.stringify({ url: root, browser: browser.version(), scope: 'synthetic Web; DOM scaling is not Dynamic Type; no native verification', results, directLinks: styles.map(([id]) => id), invalidStyleFallback: 'layers' }, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
