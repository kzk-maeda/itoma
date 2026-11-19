// Browser verification of this explicit demo's packaged shared product routes.
const { spawn } = require('node:child_process');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const meta = JSON.parse(readFileSync('dist/demo-meta.json', 'utf8'));
const output = path.resolve('dist/multi-rule-qa');
mkdirSync(output, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', '8841', '--bind', '127.0.0.1'], { cwd: 'dist/demo', stdio: 'ignore' });
const root = 'http://127.0.0.1:8841' + meta.basePath + '/';
const results = { commit: meta.commit, kind: 'fictional-native-ports-static-web', physicalDevice: false, cases: [], flows: [] };
const assert = (condition, message) => { if (!condition) throw Error(message); };
const button = (page, name) => page.getByRole('button', { name, exact: true });
const heading = (page, name) => page.getByRole('heading', { name, exact: true });
async function scenario(page, name) {
  await button(page, 'デモの状態を切り替える').click();
  await button(page, name).click();
  await page.getByText('画面デモ · ' + name, { exact: true }).waitFor();
}
async function scrollTo(page, name) {
  await heading(page, name).evaluate(element => {
    const scroll = element.closest('[data-testid="flow-scroll"]');
    if (scroll) scroll.scrollTop += element.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 16;
  });
}
async function candidates(page, names) {
  const radios = page.getByRole('radio');
  await radios.first().waitFor();
  assert(await radios.count() === names.length, 'Candidate count differs');
  for (const name of names) assert(await page.getByRole('radio', { name, exact: true }).count() === 1, 'Candidate ' + name);
}
(async () => {
  let browser;
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if ((await fetch(root)).ok) break; } catch {}
      if (attempt === 49) throw Error('Static server did not start');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ headless: true });
    results.browser = await browser.version();
    for (const [name, width, colorScheme, scale] of [
      ['light', 390, 'light', 1], ['narrow', 320, 'light', 1], ['dark', 390, 'dark', 1], ['large-text', 320, 'light', 2],
    ]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme, timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' });
      const page = await context.newPage(), errors = [], messages = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (['warning', 'error'].includes(message.type())) messages.push(message.text()); });
      page.on('dialog', dialog => { console.log('BROWSER DIALOG', dialog.message()); return dialog.accept(); });
      try {
        await page.goto(root, { waitUntil: 'networkidle' });
        await heading(page, 'いま、3つのアプリを制限中').waitFor();
        assert(await heading(page, '夜の自分時間').count() === 1 && await heading(page, '読書に集中').count() === 1, 'Active rule headings');
        assert(await page.getByText('X', { exact: true }).count() === 1, 'Shared app must appear once on home');
        if (scale > 1) await page.evaluate(scale => {
          const nodes = [...document.querySelectorAll('[dir="auto"]')].map(el => [el, parseFloat(getComputedStyle(el).fontSize), parseFloat(getComputedStyle(el).lineHeight)]);
          for (const [el, size, line] of nodes) { el.style.fontSize = size * scale + 'px'; if (Number.isFinite(line)) el.style.lineHeight = line * scale + 'px'; }
        }, scale);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert(!overflow, 'Horizontal overflow');
        const action = await button(page, '一時解除する').boundingBox();
        assert(action && action.height >= 44 && action.width >= 44, 'Unlock action target');
        await page.screenshot({ path: path.join(output, name + '-home.png') });
        await scrollTo(page, '読書に集中');
        await page.screenshot({ path: path.join(output, name + '-rules.png') });
        await scrollTo(page, '今日のスケジュール');
        await page.screenshot({ path: path.join(output, name + '-schedule.png') });
        await button(page, '一時解除する').click();
        await heading(page, 'いま制限中のアプリ').waitFor();
        await candidates(page, ['X', 'Instagram', 'YouTube']);
        await page.screenshot({ path: path.join(output, name + '-unlock.png') });
        results.cases.push({ name, width, colorScheme, artificialTextScale: scale, horizontalOverflow: overflow, action, errors });
        if (name === 'light') {
          await page.getByRole('radio', { name: 'X', exact: true }).click();
          await page.getByLabel('いま使う理由', { exact: true }).fill('架空の確認目的を入力しています');
          await button(page, '解除内容を確認する').click();
          await heading(page, 'この内容で一時解除しますか').waitFor();
          await page.screenshot({ path: path.join(output, 'review.png') });
          await button(page, '入力に戻る').click();
          await scenario(page, '22時の切替後');
          await heading(page, 'アプリを選び直してください').waitFor();
          assert(await page.getByLabel('いま使う理由', { exact: true }).inputValue() === '架空の確認目的を入力しています', 'Reason was lost on switch');
          await candidates(page, ['X', 'Instagram', 'TikTok']);
          assert(await button(page, '解除内容を確認する').isDisabled(), 'Stale selection still valid');
          await page.screenshot({ path: path.join(output, 'switch-keeps-reason.png') });
          results.flows.push('Rule switch clears only the app selection, preserving the reason and time');
          await button(page, '制限を続ける').click();
          await button(page, '破棄して制限を続ける').click();
          await heading(page, 'いとま').waitFor();
          await scenario(page, '重複中');
          await button(page, '一時解除する').click();
          await page.getByRole('radio', { name: 'X', exact: true }).click();
          await page.getByLabel('いま使う理由', { exact: true }).fill('架空の目的');
          await button(page, '解除内容を確認する').click();
          await heading(page, 'この内容で一時解除しますか').waitFor();
          await button(page, '理由を保存して一時解除する').click();
          await heading(page, '一時解除の状況').waitFor();
          await button(page, 'ホームへ戻る').click();
          await heading(page, 'いま、2つのアプリを制限中').waitFor();
          await button(page, '一時解除する').click();
          await candidates(page, ['Instagram', 'YouTube']);
          results.flows.push('A single X grant leaves Instagram/YouTube restricted and removes X from candidates');
          await button(page, '制限を続ける').click();
          for (const [name, expected] of [
            ['時間外', 'いまは制限時間外です'], ['反映未確認', '現在の反映を確認できません'], ['全体停止', '制限は停止中です'],
          ]) {
            await scenario(page, name); await heading(page, expected).waitFor();
            assert(await button(page, '一時解除する').count() === 0, name + ' exposes an unlock entry');
            await page.screenshot({ path: path.join(output, name + '.png') });
          }
          await scenario(page, '一時解除中'); await button(page, '一時解除する').click();
          await candidates(page, ['Instagram', 'YouTube']);
          await button(page, '制限を続ける').click();
          await scenario(page, '日跨ぎ'); await heading(page, 'いま、2つのアプリを制限中').waitFor();
          assert(await heading(page, 'おやすみ前').count() === 1, 'Overnight current rule');
          await page.screenshot({ path: path.join(output, 'overnight.png') });
          await scenario(page, '単独ルール'); await heading(page, 'いま、2つのアプリを制限中').waitFor();
          assert(await page.getByTestId('period-ring').count() === 1, 'Single rule ring');
          await button(page, '一時解除する').click(); await candidates(page, ['X', 'Instagram']);
          results.flows.push('Outside/unknown/paused/granted/overnight/single scenarios');
        }
        assert(errors.length === 0, 'Page errors: ' + errors.join('; '));
      } catch (error) {
        console.error('BROWSER STATE', JSON.stringify({ url: page.url(), body: await page.locator('body').innerText(), errors, messages, reason: await page.getByLabel('いま使う理由', { exact: true }).inputValue().catch(() => undefined) }));
        await page.screenshot({ path: path.join(output, 'failure-' + name + '.png') });
        throw error;
      } finally { await context.close(); }
    }
    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    results.failure = error.stack; console.error(error); process.exitCode = 1;
  } finally {
    writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
    await browser?.close(); server.kill('SIGTERM');
  }
})();
