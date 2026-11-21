const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const button = (page, name) => page.getByRole('button', { name, exact: true });
const heading = (page, name) => page.getByRole('heading', { name, exact: true }).waitFor();
const shot = (page, name) => page.screenshot({ path: join(__dirname, name + '.png') });
const actions = (page, action) => page.evaluate(action => window.__itomaDecisionQA.actions.filter(value => value === action).length, action);
const choose = (page, index) => page.evaluate(index => window.__itomaDecisionQA.choose(index), index);
const reason = '待ち合わせ場所を確認したい';
const longReason = '待ち合わせ場所までの道順と、到着する時間を確かめてから、相手にも連絡を送りたい。連絡が済んだら、読みかけの本に戻る。';

async function load(page, scene, large) {
  await page.goto('http://localhost:8089/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => !!window.__itomaDecisionQA?.refresh, { timeout: 90000 });
  await heading(page, 'いとま');
  await page.evaluate(async ({ scene, large }) => {
    const qa = window.__itomaDecisionQA;
    qa.scenario(scene, large);
    await qa.refresh();
  }, { scene, large });
}
async function checkLayout(page, large, labels) {
  if (large) {
    await page.evaluate(() => {
      const text = [...document.querySelectorAll('[dir="auto"]')].map(node => [node, getComputedStyle(node).fontSize, getComputedStyle(node).lineHeight]);
      for (const [node, size, line] of text) {
        node.style.fontSize = `${parseFloat(size) * 1.75}px`;
        if (Number.isFinite(parseFloat(line))) node.style.lineHeight = `${parseFloat(line) * 1.75}px`;
      }
    });
  }
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal page overflow');
  for (const label of labels) {
    const box = await button(page, label).boundingBox();
    assert(box && box.width >= 44 && box.height >= 44, `${label} target should be at least 44 by 44`);
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.ITOMA_QA_CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const results = { passed: false, browser: browser.version(), evidence: 'Synthetic native snapshots in the ordinary app routes', cases: [] };
  try {
    for (const large of [false, true]) {
      const colorScheme = large ? 'dark' : 'light', width = large ? 320 : 390;
      const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, colorScheme, reducedMotion: 'reduce', timezoneId: 'UTC' });
      const errors = [];
      const open = async scene => {
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await load(page, scene, large);
        return page;
      };
      let page = await open('review');
      await button(page, '一時解除する').click();
      await page.getByRole('radio', { name: 'X', exact: true }).click();
      await page.getByLabel('いま使う理由').fill(large ? longReason : reason);
      await page.getByLabel('解除時間（1〜30分）').fill('10');
      await page.evaluate(() => window.__itomaDecisionQA.omitNextPreviewSnapshot());
      await button(page, '解除内容を確認する').click();
      const previewFailure = page.getByRole('heading', { name: '解除内容を確認できませんでした', exact: true });
      await previewFailure.waitFor();
      assert.equal(await page.getByLabel('いま使う理由').inputValue(), large ? longReason : reason);
      assert.equal(await page.getByLabel('解除時間（1〜30分）').inputValue(), '10');
      assert.equal(await actions(page, 'cancelUnlock'), 1);
      assert.equal(await actions(page, 'unlock'), 0);
      if (!large) {
        await button(page, '解除内容を確認する').scrollIntoViewIfNeeded();
        await shot(page, 'light-preview-retry');
      }
      await button(page, '解除内容を確認する').click();
      await page.getByText('23:00まで', { exact: true }).waitFor();
      await page.getByText('いま確定すると最大3分').waitFor();
      await checkLayout(page, large, ['制限を続ける', '理由を保存して一時解除する', '入力に戻る']);
      await shot(page, colorScheme + '-unlock');
      if (large) {
        await page.locator('div[dir="auto"]').filter({ hasText: new RegExp(`^${longReason}$`) }).scrollIntoViewIfNeeded();
        await shot(page, 'dark-unlock-reason');
      }
      await page.evaluate(() => window.__itomaDecisionQA.setClock(130));
      await page.getByText('いま確定すると1分未満').waitFor();
      await page.evaluate(() => window.__itomaDecisionQA.setClock(180));
      await heading(page, '解除内容を確認し直してください');
      assert(await button(page, '理由を保存して一時解除する').isDisabled());
      assert.equal(await actions(page, 'unlock'), 0);
      await button(page, '入力に戻る').click();
      assert.equal(await page.getByLabel('いま使う理由').inputValue(), large ? longReason : reason);

      await page.close();
      page = await open('unconfirmed');
      const recover = 'スクリーンタイムで確認する';
      await button(page, recover).waitFor();
      await checkLayout(page, large, [recover]);
      await shot(page, colorScheme + '-home');
      await button(page, recover).click();
      await heading(page, 'スクリーンタイム');
      assert.equal(await actions(page, 'reconcile'), 0);
      await page.evaluate(() => window.__itomaDecisionQA.reconcilesSuccessfully(false));
      const reconcile = '保存した設定を再確認・反映する';
      await button(page, reconcile).click();
      await page.getByText('制限の反映を確認できていません。', { exact: true }).waitFor();
      await page.getByRole('tab', { name: 'ホーム' }).click();
      await button(page, recover).click();
      await page.evaluate(() => window.__itomaDecisionQA.reconcilesSuccessfully(true));
      await button(page, reconcile).click();
      await page.getByText('取得時点でITOMAの設定を反映した記録があります。', { exact: true }).waitFor();
      await page.getByRole('tab', { name: 'ホーム' }).click();
      await button(page, '一時解除する').waitFor();
      assert.equal(await button(page, recover).count(), 0);
      assert.equal(await actions(page, 'reconcile'), 2);

      await page.close();
      page = await open('schedules');
      await page.getByRole('tab', { name: '設定' }).click();
      await button(page, 'スケジュール').click();
      await heading(page, 'すべて停止中');
      await page.getByText('2件の設定は保存されています。').waitFor();
      await page.getByText(/設定は有効/).waitFor();
      await page.getByText(/設定は無効/).waitFor();
      const resume = '保存したルールの再開を確認';
      await checkLayout(page, large, [resume, 'ルールを追加する']);
      await shot(page, colorScheme + '-schedules');
      await button(page, resume).click();
      await choose(page, 0);
      assert.equal(await actions(page, 'resume'), 0);
      await heading(page, 'すべて停止中');
      await button(page, resume).click();
      await choose(page, 1);
      await heading(page, '時間帯に合わせて実行');
      await page.getByText(/設定は無効/).waitFor();
      assert.equal(await actions(page, 'resume'), 1);
      await button(page, 'すべてのルールの停止を確認').click();
      await choose(page, 1);
      await heading(page, 'すべて停止中');
      assert.equal(await actions(page, 'stop'), 1);
      assert.deepEqual(errors, []);
      results.cases.push({ colorScheme, width, domTextScale: large ? 1.75 : 1, invalidPreviewCancelled: true, unlockRequestsAfterExpiry: 0, reconcileRequests: 2, resumeRequests: 1, stopRequests: 1, errors });
      await context.close();
    }
    results.passed = true;
  } catch (error) {
    results.error = error.stack;
    throw error;
  } finally {
    writeFileSync(join(__dirname, 'results.json'), JSON.stringify(results, null, 2) + '\n');
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
