import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPipelineComment, renderRequestStatus } from '../scripts/lib/ai-review-comment.mjs';
import { executeRequest, publishPipeline, renderPipelineReport } from '../scripts/lib/ai-review-pipeline.mjs';
import { parseState, renderState } from '../scripts/lib/ai-review-requests.mjs';
import { BASE, HEAD, harness } from './fixtures/ai-review-harness.mjs';

const completed = () => ({
  status: 'reviewed', request: { mode: 'force' },
  review: { repository: 'owner/itoma', number: 42, head_sha: HEAD, diff_base_sha: BASE,
    files: [{ path: 'src/new name.ts', previous_path: 'src/old name.ts' }], omissions: [],
    review: { summary: 'A long model summary need not be repeated.', limitations: [], findings: [] } },
});
const finding = (overrides = {}) => ({ priority: 'P1', title: '認可を再確認する', body: '認可取消後に実行すると制限を更新します。操作前に認可を再確認してください。',
  path: 'src/new name.ts', side: 'RIGHT', line: 2, ...overrides });

test('actionable findings keep severity, all corrections and exact old/new revision links', () => {
  const report = completed();
  report.review.review.findings = [finding({ priority: 'P3', title: '軽微な修正' }), finding({ side: 'LEFT' })];
  const body = renderPipelineComment(report);
  assert.match(body, /修正候補 2件/);
  assert.ok(body.indexOf('P1:') < body.indexOf('P3:'));
  assert.match(body, /操作前に認可を再確認してください/);
  assert.ok(body.includes(`/blob/${BASE}/src/old%20name.ts#L2`));
  assert.ok(body.includes(`/blob/${HEAD}/src/new%20name.ts#L2`));
  assert.ok(!body.includes(report.review.review.summary));
  assert.match(body, /修正後.*`\/ai-review`/);
});

test('zero findings remain distinct from skipped or failed review and do not demand unnecessary reruns', () => {
  const body = renderPipelineComment(completed());
  assert.match(body, /確認できた範囲では、修正候補は見つかりません/);
  assert.ok(!body.includes('/ai-review'));
  for (const status of ['skipped_low', 'triage_failed', 'review_failed', 'manual_required', 'stale']) {
    const text = renderPipelineComment({ status });
    assert.ok(!text.includes('修正候補は見つかりません'));
    assert.match(text, /投稿|人手でレビュー/);
  }
  assert.match(renderPipelineComment({ status: 'skipped_low' }), /本レビューは実行していません/);
});

test('missing text patches stay actionable ahead of media, without repeating every context omission', () => {
  const report = completed();
  report.review.omissions = [
    ...Array.from({ length: 4 }, (_, i) => `docs/qa/${i}.png: diff unavailable (binary, oversized, or no textual changes)`),
    ...Array.from({ length: 5 }, (_, i) => `src/unreviewed-${i}.ts: diff exceeds remaining input budget`),
    ...Array.from({ length: 20 }, (_, i) => `src/context-${i}.ts@${HEAD}: source unavailable or exceeds 1011 bytes`),
  ];
  const body = renderPipelineComment(report);
  assert.match(body, /未確認・不完全な差分5ファイル.*人手でレビュー/);
  for (let i = 0; i < 3; i++) assert.ok(body.includes(`src/unreviewed-${i}.ts`));
  assert.match(body, /ほか2ファイル/);
  assert.match(body, /画像・動画等4ファイル.*目視/);
  assert.ok(!body.includes('source unavailable'));
  assert.ok(!body.includes('src/context-'));
  assert.match(body, /\/pull\/42\/files#diff-[a-f0-9]{64}/);
  report.review.omissions = ['src/new name.ts: GitHub diff may be truncated'];
  assert.match(renderPipelineComment(report), /未確認・不完全な差分1ファイル/);
  report.review.omissions = ['src/new name.ts: surrounding source omitted (budget)'];
  assert.match(renderPipelineComment(report), /周辺コード・資料の一部を取得できていません/);
});

test('failure and lifecycle messages identify the next operation without exposing diagnostic internals', () => {
  for (const [status, expected] of [
    ['claimed', /実行中/], ['pending_draft', /Readyに/], ['cancelled', /open・非Draft/],
    ['unsupported', /人手でレビュー/], ['stale', /以前の結果.*現在の差分には使えません/],
    ['triage_failed', /`\/ai-review reassess`/], ['review_failed', /`\/ai-review`/],
  ]) assert.match(renderRequestStatus({ status, reason: 'internal diagnostic' }), expected);
  for (const [mode, command] of [['force', '/ai-review'], ['initial', '/ai-review reassess']]) {
    const body = renderPipelineComment({ status: 'manual_required', request: { mode }, error: 'Paid API work is not automatically retried. Post a new /ai-review comment.' });
    assert.ok(body.includes(`\`${command}\``));
    assert.ok(!body.includes('差分を分割'));
  }
});

test('omitted vector and modern image formats are assigned visual inspection, not source-code review', () => {
  const report = completed();
  const images = ['logo.svg', 'hero.AVIF', 'splash.bmp', 'scan.tiff', 'animated.apng', 'photo.heif'];
  report.review.omissions = images.map(path => `${path}: diff unavailable (binary, oversized, or no textual changes)`);
  const body = renderPipelineComment(report);
  assert.match(body, /画像・動画等6ファイル.*目視/);
  assert.ok(!body.includes('テキスト'));
  assert.ok(!body.includes('人手でレビュー'));
});

test('model text and omission paths cannot inject HTML, links or mentions into the compact comment', () => {
  const report = completed();
  report.review.review.findings = [finding({ title: '<script>@everyone</script>', body: '![image](https://bad.example)' })];
  report.review.omissions = ['<img>@here.ts: diff exceeds remaining input budget'];
  const body = renderPipelineComment(report);
  for (const value of ['<script>', '<img>', '@everyone', '@here', '![image](']) assert.ok(!body.includes(value));
});

test('publishing uses a compact comment while preserving full diagnostic evidence and unchanged machine state', async () => {
  const h = harness();
  const opts = { ...h.opts, eventName: 'workflow_dispatch' };
  const { request } = await h.claim({}, opts);
  const report = await executeRequest(request, opts, h.dependencies);
  report.review.omissions.push('src/unreviewed.ts: diff exceeds remaining input budget');
  const evidenceBefore = structuredClone(report);
  await publishPipeline(report, opts, h.github);
  const body = h.state.bot.body;
  const visible = body.replace(/<!--[^]*?-->/g, '');
  assert.equal((visible.match(/## AIレビュー/g) || []).length, 1);
  assert.match(visible, /修正候補 1件/);
  assert.match(visible, /src\/unreviewed/);
  assert.match(visible, /詳細・ログ/);
  for (const value of ['gpt-', 'manual_force', 'ポリシー', '対象SHAのCI', 'fixture review', 'base:']) assert.ok(!visible.includes(value));
  const evidence = renderPipelineReport(report);
  for (const value of ['gpt-5.6-sol', 'manual\\_force', 'ポリシー', '対象SHAのCI', 'quality', 'fixture review', 'src/unreviewed.ts']) assert.ok(evidence.includes(value));
  assert.deepEqual(report, evidenceBefore);
  const expectedCurrent = { ...request, status: 'reviewed', reason: null };
  for (const key of ['version', 'repository', 'number', 'node_id']) delete expectedCurrent[key];
  assert.deepEqual(h.saved().current, expectedCurrent);
});

test('rendering new comment prose round-trips every watermark and request field without mutation', async () => {
  const h = harness(); await h.claim();
  const state = h.saved(); const before = structuredClone(state);
  state.current.status = 'stale';
  const expected = structuredClone(state);
  const body = renderState(state, h.opts);
  assert.deepEqual(state, expected);
  assert.deepEqual(parseState({ body }, h.opts, h.state.pr), state);
  assert.equal(state.last_run_id, before.last_run_id);
  assert.equal(state.last_command_id, before.last_command_id);
  assert.ok(body.includes(`/commit/${HEAD}`));
  assert.match(body, /以前の結果.*現在の差分には使えません/);
});
