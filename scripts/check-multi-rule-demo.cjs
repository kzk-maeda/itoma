// Verify the explicit fictional Web demo, including real touch drags.
const { spawn } = require('node:child_process');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const standalone = process.env.ITOMA_QA_EXPORT;
const meta = standalone ? { basePath: '', commit: 'working-tree' } : JSON.parse(readFileSync('dist/demo-meta.json', 'utf8'));
const output = path.resolve('dist/multi-rule-qa');
mkdirSync(output, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', '8841', '--bind', '127.0.0.1'], { cwd: standalone || 'dist/demo', stdio: 'ignore' });
const root = 'http://127.0.0.1:8841' + meta.basePath + '/';
const results = { commit: meta.commit, kind: 'fictional-native-ports-rule-deck', physicalDevice: false, cases: [], flows: [] };
const assert = (condition, message) => { if (!condition) throw Error(message); };
const button = (p, name) => p.getByRole('button', { name, exact: true });
const heading = (p, name) => p.getByRole('heading', { name, exact: true });
async function showRule(p, name) {
  // The home keeps the card being read when a work flow closes.
  if (await heading(p, name).count()) return;
  const previous = button(p, '前のルール');
  if (await previous.count() && await previous.isEnabled()) await previous.click();
  else await button(p, '次のルール').click();
  await heading(p, name).waitFor();
}
async function scenario(p, name) {
  await button(p, 'デモの状態を切り替える').click(); await button(p, name).click();
  await p.getByText('画面デモ · ' + name, { exact: true }).waitFor();
}
async function candidates(p, names) {
  await heading(p, 'いま制限中のアプリ').waitFor();
  // Wait for the route's initial snapshot; the controller remains authoritative.
  await p.waitForFunction(expected => [...document.querySelectorAll('[role="radio"]')].map(el => el.getAttribute('aria-label')).sort().join('|') === expected.sort().join('|'), names);
  assert(await p.getByRole('radio').count() === names.length, 'Candidate count');
}
async function enlarge(p, scale) {
  if (scale === 1) return;
  await p.evaluate(scale => {
    const nodes = [...document.querySelectorAll('[dir="auto"]')].filter(el => !el.dataset.enlarged).map(el => [el, parseFloat(getComputedStyle(el).fontSize), parseFloat(getComputedStyle(el).lineHeight)]);
    for (const [el, size, line] of nodes) { el.style.fontSize = size * scale + 'px'; if (Number.isFinite(line)) el.style.lineHeight = line * scale + 'px'; el.dataset.enlarged = '1'; }
  }, scale);
}
async function swipe(p, direction, capture) {
  const card = p.getByTestId('active-rule-card'); await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox(), session = await p.context().newCDPSession(p);
  const start = box.x + box.width * (direction === 'left' ? 0.8 : 0.2), delta = box.width * (direction === 'left' ? -0.6 : 0.6);
  const viewport = await card.evaluate(el => {
    const rect = el.closest('[data-testid="flow-scroll"]').getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  });
  const top = Math.max(viewport.top, box.y), bottom = Math.min(viewport.bottom, box.y + box.height);
  const y = top + Math.min(120, (bottom - top) / 2);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start, y }] });
  for (let i = 1; i <= 8; i++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start + delta * i / 8, y }] });
    await p.waitForTimeout(18);
    if (i === 6 && capture) await p.screenshot({ path: path.join(output, capture) });
  }
  const transform = await card.evaluate(el => getComputedStyle(el).transform);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach(); return transform;
}
(async () => {
  let browser;
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if ((await fetch(root)).ok) break; } catch {}
      if (attempt === 49) throw Error('Static server did not start');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ headless: true, ...(process.env.ITOMA_QA_CHROMIUM ? { executablePath: process.env.ITOMA_QA_CHROMIUM } : { channel: 'chrome' }) });
    results.browser = await browser.version();
    for (const [name, width, colorScheme, scale, reducedMotion] of [
      ['light-motion', 390, 'light', 1, 'no-preference'], ['narrow', 320, 'light', 1, 'reduce'],
      ['dark', 390, 'dark', 1, 'reduce'], ['large-text', 320, 'light', 2, 'reduce'],
    ]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme, hasTouch: true, timezoneId: 'Asia/Tokyo', reducedMotion });
      const p = await context.newPage(), errors = [], messages = [];
      p.on('pageerror', e => errors.push(e.message));
      p.on('console', m => { if (['warning', 'error'].includes(m.type())) messages.push(m.text()); });
      try {
        await p.goto(root, { waitUntil: 'networkidle' }); await heading(p, '夜の自分時間').waitFor();
        assert(await heading(p, '今日のスケジュール').count() === 0, 'Daily schedule remains');
        assert(await heading(p, '読書に集中').count() === 0, 'Hidden rule is still accessible');
        assert(await button(p, '一時解除する').count() === 1, 'Only the visible rule may expose an action');
        await enlarge(p, scale); await p.screenshot({ path: path.join(output, name + '-home.png') });
        const dragTransform = await swipe(p, 'left', name === 'light-motion' ? 'drag-left.png' : undefined);
        await heading(p, '読書に集中').waitFor();
        if (reducedMotion === 'reduce') assert(dragTransform === 'none' || dragTransform === 'matrix(1, 0, 0, 1, 0, 0)', 'Reduced motion moved the card');
        else assert(dragTransform !== 'none' && dragTransform !== 'matrix(1, 0, 0, 1, 0, 0)', 'Motion did not respond to drag');
        await enlarge(p, scale); await p.screenshot({ path: path.join(output, name + '-reading.png') });
        await swipe(p, 'right'); await heading(p, '夜の自分時間').waitFor();
        await button(p, '次のルール').click(); await heading(p, '読書に集中').waitFor();
        await button(p, '前のルール').click(); await heading(p, '夜の自分時間').waitFor();
        await heading(p, 'いま、3つのアプリを制限中').waitFor();
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        const action = await button(p, '一時解除する').boundingBox();
        assert(!overflow && action && action.height >= 44 && action.width >= 44, 'Layout/action bounds');
        await button(p, '一時解除する').click(); await candidates(p, ['Instagram']);
        await enlarge(p, scale); await p.screenshot({ path: path.join(output, name + '-night-unlock.png') });
        await button(p, 'ホームでルールを選び直す').click(); await heading(p, 'いとま').waitFor();
        await button(p, '次のルール').click(); await heading(p, '読書に集中').waitFor();
        await button(p, '一時解除する').click(); await candidates(p, ['X', 'YouTube']);
        await enlarge(p, scale); await p.screenshot({ path: path.join(output, name + '-reading-unlock.png') });
        results.cases.push({ name, width, colorScheme, artificialTextScale: scale, reducedMotion, dragTransform, horizontalOverflow: overflow, action, errors });
        if (name === 'light-motion') {
          await p.getByRole('radio', { name: 'X', exact: true }).click();
          await p.getByLabel('いま使う理由', { exact: true }).fill('架空の目的を残してルールを選び直す');
          await button(p, '解除内容を確認する').click(); await heading(p, 'この内容で一時解除しますか').waitFor();
          await button(p, '入力に戻る').click(); await scenario(p, '22時の切替後');
          await heading(p, 'アプリを選び直してください').waitFor(); await candidates(p, []);
          assert(await p.getByLabel('いま使う理由', { exact: true }).inputValue() === '架空の目的を残してルールを選び直す', 'Reason lost at boundary');
          assert(await button(p, '解除内容を確認する').isDisabled(), 'Old rule selection remains valid');
          await p.screenshot({ path: path.join(output, 'ended-rule-keeps-reason.png') });
          await button(p, 'ホームでルールを選び直す').click(); await heading(p, 'いとま').waitFor();
          await showRule(p, 'おやすみ前');
          await button(p, '一時解除する').click(); await candidates(p, ['X', 'TikTok']);
          assert(await p.getByLabel('いま使う理由', { exact: true }).inputValue() === '架空の目的を残してルールを選び直す', 'Reason lost during explicit rule change');
          await p.getByRole('radio', { name: 'X', exact: true }).click();
          await button(p, '解除内容を確認する').click(); await heading(p, 'この内容で一時解除しますか').waitFor();
          await button(p, '理由を保存して一時解除する').click(); await heading(p, '一時解除の状況').waitFor();
          await button(p, 'ホームへ戻る').click(); await heading(p, 'いま、2つのアプリを制限中').waitFor();
          await showRule(p, 'おやすみ前');
          await button(p, '一時解除する').click(); await candidates(p, ['TikTok']);
          await p.getByRole('radio', { name: 'TikTok', exact: true }).click();
          await p.getByLabel('いま使う理由', { exact: true }).fill('架空の破棄確認');
          await button(p, '制限を続ける').click(); await button(p, '破棄して制限を続ける').click();
          await heading(p, 'いとま').waitFor();
          for (const [state, expected] of [['時間外', 'いまは制限時間外です'], ['反映未確認', '現在の反映を確認できません'], ['全体停止', '制限は停止中です']]) {
            await scenario(p, state); await heading(p, expected).waitFor();
            assert(await button(p, '一時解除する').count() === 0, 'Unavailable state exposes unlock');
          }
          await scenario(p, '日跨ぎ'); await heading(p, 'おやすみ前').waitFor();
          assert(await button(p, '次のルール').count() === 0, 'Single rule has paging controls');
          await button(p, '一時解除する').click(); await candidates(p, ['X', 'TikTok']);
          await button(p, 'ホームでルールを選び直す').click();
          await scenario(p, '単独ルール'); await heading(p, '夜の自分時間').waitFor();
          await button(p, '一時解除する').click(); await candidates(p, ['X', 'Instagram']);
          results.flows.push('Rule-scoped candidates; no automatic widening after rule expiry; reason retained on explicit rule change; single X grant; discard returns home; unavailable/single/overnight states');
        }
        assert(errors.length === 0, 'Page errors: ' + errors.join('; '));
      } catch (e) {
        console.error('BROWSER STATE', JSON.stringify({ url: p.url(), body: await p.locator('body').innerText(), errors, messages }));
        await p.screenshot({ path: path.join(output, 'failure-' + name + '.png') }); throw e;
      } finally { await context.close(); }
    }
    console.log(JSON.stringify(results, null, 2));
  } catch (e) { results.failure = e.stack; console.error(e); process.exitCode = 1; }
  finally { writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n'); await browser?.close(); server.kill('SIGTERM'); }
})();
