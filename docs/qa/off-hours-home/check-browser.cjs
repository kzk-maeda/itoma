const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
const output = __dirname, repo = path.resolve(__dirname, '../../..');
const productFiles = ['src/components/flow/home.tsx', 'src/components/flow/unlock.tsx', 'src/components/home/rule-deck.tsx', 'src/components/home/rule-status.ts', 'src/components/home/rule-status-view.tsx', 'src/components/home/period-ring.tsx', 'src/state/screen-time.tsx', 'src/constants/theme.ts', 'src/components/home/off-hours-presentation.ts', 'src/components/home/off-hours-circle.tsx', 'src/components/home/off-hours-home.tsx', 'src/hooks/use-home-time-context.ts', 'src/components/flow/applications.tsx'];
// Applications is the temporary Apple-label adapter during Web QA; other product files must match commit exactly.
const sourceHashes = Object.fromEntries(productFiles.filter(f => !f.endsWith('/applications.tsx')).map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, f))).digest('hex')]));
const results = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), sourceHashes, kind: 'product-ui-with-real-router-and-temporary-native-ports', physicalDevice: false, cases: [], flows: [] };
const assert = (v, message) => { if (!v) throw Error(message); };
const button = (p, name) => p.getByRole('button', { name, exact: true });
const heading = (p, name) => p.getByRole('heading', { name, exact: true });
const screenshot = (p, file) => p.screenshot({ path: path.join(output, file + '.png') });
async function scene(p, name) { await p.evaluate(async name => { __itomaQA.scenario(name); await __itomaQA.refresh(); }, name); await p.waitForTimeout(1100); }
async function enlarge(p) {
  await p.evaluate(() => { __itomaQA.fontScale = 2; (window.visualViewport || window).dispatchEvent(new Event('resize'));  }); await p.waitForTimeout(100);
  await p.evaluate(() => { for (const el of document.querySelectorAll('[dir="auto"]')) { if (el.dataset.enlarged) continue; const s = getComputedStyle(el); el.style.fontSize = parseFloat(s.fontSize) * 2 + 'px'; const line = parseFloat(s.lineHeight); if (Number.isFinite(line)) el.style.lineHeight = line * 2 + 'px'; el.dataset.enlarged = '1'; } });
}
(async () => {
 const browser = await chromium.launch({ executablePath: process.env.ITOMA_QA_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] }); results.browser = await browser.version();
 try {
  for (const colorScheme of ['light', 'dark']) for (const width of [320, 375, 390]) {
   const height = width === 320 ? 568 : width === 375 ? 667 : 844, name = `${colorScheme}-${width}`;
   const reducedMotion = colorScheme === 'light' && width === 390 ? 'no-preference' : 'reduce';
   const context = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion, hasTouch: true, timezoneId: 'UTC' });
   const p = await context.newPage(), errors = [], warnings = [];
   p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (['warning', 'error'].includes(m.type())) warnings.push(m.text()); });
   await p.goto('http://localhost:8086', { waitUntil: 'domcontentloaded', timeout: 120000 }); await heading(p, '夜の時間').waitFor({ timeout: 90000 });
   for (const [scenario, text, end] of [['off-today', '今日 21:00', '23:00に終了'], ['off-tomorrow', '明日 07:00', '08:00に終了'], ['off-week', '11月27日(金) 21:00', '23:00に終了'], ['off-overnight', '今日 21:00', '翌日 07:00に終了'], ['off-no-goal', '今日 21:00', '23:00に終了'], ['off-none', '次の予定なし', null]]) {
    await scene(p, scenario); await heading(p, text).waitFor();
    assert(await p.getByTestId('off-hours-circle').count() === 1, 'missing circle'); assert(await p.getByText('制限時間外', { exact: true }).count() === 1, 'status count');
    assert(await button(p, '一時解除する').count() === 0, 'off-hours unlock'); assert(await p.getByText(/次の切替/).count() === 0, 'duplicate start strip');
    if (end) { await p.getByText(end, { exact: true }).waitFor(); assert(await p.getByTestId('next-rule').count() === 1, 'card count'); assert(await p.getByText('選択したアプリ（4件）', { exact: true }).count() === 1, 'wrong saved selection'); }
    else assert(await button(p, 'ルールを確認する').count() === 1, 'missing actual settings entry');
    if (scenario === 'off-no-goal') assert(await p.getByTestId('rule-goal').count() === 0, 'invented goal');
    const svg = p.getByTestId('off-hours-ring').locator('svg');
    const original = await svg.evaluate(e => e.outerHTML); await p.waitForTimeout(100); assert(await svg.evaluate(e => e.outerHTML) === original, 'circle animates');
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert(!overflow, 'horizontal overflow');
    await p.getByTestId('flow-scroll').evaluate(e => { e.scrollTop = 0; });
    if (width === 390 || scenario === 'off-today') await screenshot(p, `${name}-${scenario}`);
    results.cases.push({ name, width, height, colorScheme, reducedMotion, scenario, next: text, end, horizontalOverflow: overflow, staticCircle: true });
   }
   await button(p, 'ルールを確認する').click(); await heading(p, 'スケジュール').waitFor();
   await button(p, '設定に戻る').click(); await heading(p, '設定').waitFor(); await p.getByRole('tab', { name: 'ホーム', exact: true }).click(); await heading(p, '次の予定なし').waitFor(); await p.waitForTimeout(800);
   await p.waitForFunction(() => { const tab = document.querySelector('[role="tab"][aria-label="ホーム"]'); if (!tab) return false; const box = tab.getBoundingClientRect(); for (let e = tab; e; e = e.parentElement) if (getComputedStyle(e).opacity === '0') return false; return box.top >= 0 && box.bottom <= innerHeight; });
   const mutations = await p.evaluate(() => __itomaQA.actions.filter(a => a !== 'snapshot')); assert(mutations.length === 0, 'browsing sent a command');
   for (const scenario of ['off-missing', 'off-unknown', 'off-paused']) { await scene(p, scenario); assert(await p.getByTestId('off-hours-circle').count() === 0, 'unconfirmed/stopped circle'); if (width === 390 && colorScheme === 'light') await screenshot(p, scenario); }
   await scene(p, 'reset'); await heading(p, '夜の時間').waitFor(); assert(await p.getByTestId('off-hours-circle').count() === 0, 'active replaced'); assert(await button(p, '一時解除する').count() === 1, 'active entry regressed');
   results.flows.push({ name, settingsRoundTrip: true, browsingMutations: mutations, unknownStoppedHidden: true, activeUnchanged: true, errors, warnings: [...new Set(warnings)] });
   const unexpectedWarnings = warnings.filter(message => !message.startsWith('Animated: `useNativeDriver` is not supported'));
   assert(errors.length === 0 && unexpectedWarnings.length === 0, [...errors, ...unexpectedWarnings].join('\n')); await context.close();
  }
  for (const [width, colorScheme] of [[320, 'dark'], [375, 'light']]) {
   const context = await browser.newContext({ viewport: { width, height: width === 320 ? 568 : 667 }, colorScheme, reducedMotion: 'reduce', timezoneId: 'UTC' });
   const p = await context.newPage(); await p.goto('http://localhost:8086', { waitUntil: 'domcontentloaded', timeout: 120000 }); await heading(p, '夜の時間').waitFor(); await scene(p, 'off-long'); await enlarge(p);
   const ring = p.getByTestId('off-hours-ring'); assert(await ring.getByText('今日 21:00', { exact: true }).count() === 0, 'large date clipped inside ring');
   await screenshot(p, `large-${colorScheme}-${width}-home`); await p.getByTestId('next-start').scrollIntoViewIfNeeded(); await screenshot(p, `large-${colorScheme}-${width}-date`);
   await p.getByTestId('rule-goal').scrollIntoViewIfNeeded(); const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert(!overflow, 'large text overflow');
   results.cases.push({ name: `large-${colorScheme}-${width}`, width, syntheticFontScale: 2, artificialDOMTextScale: 2, outsideCircle: true, goalReachable: true, horizontalOverflow: overflow }); await context.close();
  }
  results.passed = true;
 } catch (e) { results.passed = false; results.error = e.stack; throw e; }
 finally { fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify(results, null, 2) + '\n'); await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
