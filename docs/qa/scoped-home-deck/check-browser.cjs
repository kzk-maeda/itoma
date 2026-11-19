const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { execFileSync } = require('child_process');
const output = __dirname;
const productFiles = ['src/components/flow/home.tsx', 'src/components/flow/unlock.tsx', 'src/components/home/rule-deck.tsx', 'src/components/home/rule-status.ts', 'src/components/home/rule-status-view.tsx', 'src/components/home/period-ring.tsx', 'src/state/screen-time.tsx', 'src/constants/theme.ts'];
const repo = path.resolve(output, '../../..');
const sourceHashes = Object.fromEntries(productFiles.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex')]));
const results = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), sourceHashes, kind: 'product-components-real-router-with-temporary-synthetic-native-client', physicalDevice: false, cases: [], flows: [] };
const assert = (v, m) => { if (!v) throw Error(m); };
const button = (p, name) => p.getByRole('button', { name, exact: true });
const heading = (p, name) => p.getByRole('heading', { name, exact: true });
const snap = async (p, file) => { await p.screenshot({ path: `${output}/${file}.png` }); };
async function candidates(p, expected) { await p.waitForFunction(expected => [...document.querySelectorAll('[role="radio"]')].map(e => e.getAttribute('aria-label')).sort().join('|') === expected.sort().join('|'), expected); }
async function swipe(p, direction, file) {
  const card = p.getByTestId('active-rule-card'); await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox(), session = await p.context().newCDPSession(p);
  const viewport = await card.evaluate(el => { const r = el.closest('[data-testid="flow-scroll"]').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  const x = box.x + box.width * (direction === 'left' ? .8 : .2), delta = box.width * (direction === 'left' ? -.6 : .6);
  const y = Math.max(viewport.top, box.y) + Math.min(110, (Math.min(viewport.bottom, box.y + box.height) - Math.max(viewport.top, box.y)) / 2);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 8; i++) { await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + delta * i / 8, y }] }); await p.waitForTimeout(18); if (i === 6 && file) await snap(p, file); }
  const transform = await card.evaluate(el => getComputedStyle(el).transform);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await session.detach(); return transform;
}
async function enlarge(p, scale = 2) {
  await p.evaluate(scale => { for (const e of document.querySelectorAll('[dir="auto"]')) { if (e.dataset.enlarged) continue; const c = getComputedStyle(e), size = parseFloat(c.fontSize), line = parseFloat(c.lineHeight); e.style.fontSize = size * scale + 'px'; if (Number.isFinite(line)) e.style.lineHeight = line * scale + 'px'; e.dataset.enlarged = '1'; } }, scale);
}
async function scenario(p, name) { await p.evaluate(async name => { globalThis.__itomaQA.scenario(name); await globalThis.__itomaQA.refresh(); }, name); await p.waitForTimeout(1100); }
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.ITOMA_QA_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  results.browser = await browser.version();
  try {
    for (const colorScheme of ['light', 'dark']) for (const width of [320, 375, 390]) {
      const name = `${colorScheme}-${width}`, height = width === 320 ? 568 : width === 375 ? 667 : 844;
      const reducedMotion = width === 390 && colorScheme === 'light' ? 'no-preference' : 'reduce';
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion, hasTouch: true, timezoneId: 'UTC' });
      const p = await ctx.newPage(), errors = [], warnings = [];
      p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (['warning', 'error'].includes(m.type())) warnings.push(m.text()); });
      await p.goto('http://localhost:8086', { waitUntil: 'domcontentloaded', timeout: 120000 }); await heading(p, '夜の時間').waitFor({ timeout: 90000 });
      assert(await heading(p, '今日のスケジュール').count() === 0, 'daily list'); assert(await p.getByText(/つのアプリを制限中/).count() === 0, 'total heading');
      assert(await p.getByText('X', { exact: true }).count() === 0, 'hidden app mounted'); assert(await button(p, '一時解除する').count() === 1, 'common entry remains');
      await snap(p, `${name}-home`);
      const transform = await swipe(p, 'left', name === 'light-390' ? 'drag-left' : undefined); await heading(p, '読書').waitFor();
      if (reducedMotion === 'reduce') assert(transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)', 'reduced motion translated'); else assert(transform !== 'none' && transform !== 'matrix(1, 0, 0, 1, 0, 0)', 'drag not moving');
      assert(await p.getByText('Instagram', { exact: true }).count() === 0, 'inactive card mounted');
      if (name === 'dark-390') await snap(p, 'reading-dark');
      await swipe(p, 'right'); await heading(p, '夜の時間').waitFor({ timeout: 90000 }); await button(p, '次のルール').click(); await heading(p, '読書').waitFor();
      const action = await button(p, '一時解除する').boundingBox(); assert(action.width >= 44 && action.height >= 44, 'action size');
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert(!overflow, 'page overflow');
      const mutationBefore = await p.evaluate(() => __itomaQA.actions.filter(a => a !== 'snapshot')); assert(mutationBefore.length === 0, 'browsing sent mutation');
      await button(p, '一時解除する').click(); await candidates(p, ['X', 'YouTube']); assert(await p.getByText('Instagram', { exact: true }).count() === 0, 'cross rule candidate');
      if (name === 'light-390') {
        await snap(p, 'scoped-unlock');
        await p.getByRole('radio', { name: 'X', exact: true }).click(); await p.getByLabel('いま使う理由', { exact: true }).fill('合成の入力：連絡を確認する'); await p.getByLabel('解除時間（1〜30分）', { exact: true }).fill('7');
        await scenario(p, 'late'); await candidates(p, []); await snap(p, 'ended-rule');
        assert(await p.getByLabel('いま使う理由', { exact: true }).inputValue() === '合成の入力：連絡を確認する', 'reason lost');
        await button(p, 'ホームでルールを選び直す').click(); await heading(p, '夜の時間').waitFor({ timeout: 90000 }); await button(p, '次のルール').click(); await heading(p, 'おやすみ前').waitFor(); await button(p, '一時解除する').click(); await candidates(p, ['X', 'TikTok']);
        assert(await p.getByLabel('解除時間（1〜30分）', { exact: true }).inputValue() === '7', 'minutes lost'); await p.getByRole('radio', { name: 'X', exact: true }).click();
        await button(p, '解除内容を確認する').click(); await heading(p, 'この内容で一時解除しますか').waitFor(); await snap(p, 'confirmation');
        await button(p, '理由を保存して一時解除する').click(); await heading(p, '一時解除の状況').waitFor();
        assert(!await p.evaluate(() => !!__itomaQA.alert), 'root guard double prompt after accepted grant');
        await button(p, 'ホームへ戻る').click(); await heading(p, 'おやすみ前').waitFor(); await button(p, '一時解除する').click(); await candidates(p, ['TikTok']);
        results.flows.push({ flow: 'reading-ends-explicit-bedtime-choice-X-only-grant', passed: true });
        await p.getByLabel('いま使う理由', { exact: true }).fill('合成の破棄確認入力'); await button(p, '制限を続ける').click();
        assert((await p.evaluate(() => __itomaQA.alert.title)).includes('破棄'), 'discard alert missing');
        await p.evaluate(() => { const alert = __itomaQA.alert; __itomaQA.alert = undefined; alert.actions[1].onPress(); }); await heading(p, 'おやすみ前').waitFor();
        assert(!await p.evaluate(() => !!__itomaQA.alert), 'double discard prompt'); results.flows.push({ flow: 'confirmed-discard-through-real-root-guard', passed: true });
        await scenario(p, 'unknown'); await snap(p, 'unconfirmed'); assert(await button(p, '一時解除する').count() === 0, 'unconfirmed unlock entry');
      }
      results.cases.push({ name, width, height, colorScheme, reducedMotion, dragTransform: transform, action, horizontalOverflow: overflow, errors, warningCount: warnings.length, warnings: [...new Set(warnings)] });
      assert(errors.length === 0, errors.join('\n')); await ctx.close();
    }
    for (const width of [320, 375]) {
      const ctx = await browser.newContext({ viewport: { width, height: width === 320 ? 568 : 667 }, reducedMotion: 'reduce', hasTouch: true, timezoneId: 'UTC' });
      const p = await ctx.newPage(); await p.goto('http://localhost:8086', { waitUntil: 'domcontentloaded', timeout: 120000 }); await heading(p, '夜の時間').waitFor({ timeout: 90000 }); await scenario(p, 'long'); await enlarge(p); await snap(p, `large-long-${width}-home`);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert(!overflow, 'long text overflow'); await button(p, '一時解除する').click(); await candidates(p, ['Instagram']); await enlarge(p);
      await p.getByRole('radio', { name: 'Instagram' }).click(); await p.getByLabel('いま使う理由').fill('合成の長い日本語の理由です。'.repeat(12)); await enlarge(p);
      await snap(p, `large-long-${width}-input`); await button(p, '解除内容を確認する').click(); await heading(p, 'この内容で一時解除しますか').waitFor();
      results.cases.push({ name: `large-long-${width}`, width, artificialTextScale: 2, horizontalOverflow: overflow, confirmationReachable: true }); await ctx.close();
    }
    results.passed = true;
  } catch (e) { results.passed = false; results.error = e.stack; throw e; }
  finally { fs.writeFileSync(output + '/browser-results.json', JSON.stringify(results, null, 2) + '\n'); await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
