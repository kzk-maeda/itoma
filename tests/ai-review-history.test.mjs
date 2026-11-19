import test from 'node:test';
import assert from 'node:assert/strict';
import { executeRequest, publishPipeline } from '../scripts/lib/ai-review-pipeline.mjs';
import { prepareRequest, parseState } from '../scripts/lib/ai-review-requests.mjs';
import { REVIEW_START, REVIEW_END, REVIEW_AGAIN, extractReviewBody } from '../scripts/lib/ai-review-history.mjs';
import { HEAD, NEXT, harness } from './fixtures/ai-review-harness.mjs';

async function reviewed() {
  const h = harness();
  const opts = { ...h.opts, eventName: 'workflow_dispatch' };
  const { request } = await h.claim({}, opts);
  const report = await executeRequest(request, opts, h.dependencies);
  await publishPipeline(report, opts, h.github);
  return { ...h, report };
}
const visible = h => h.state.bot.body.replace(/<!--[^]*?-->/g, '');

test('push and merge preserve the last findings and evidence without pretending to review the final revision', async () => {
  const h = await reviewed(); const before = structuredClone(h.saved().last_review);
  h.state.pr.head.sha = NEXT;
  await h.claim({ action: 'synchronize' }, { runId: 101, expectedSha: NEXT });
  assert.match(visible(h), /現在の差分には使えません/);
  assert.match(visible(h), /前回の本レビュー/);
  assert.match(visible(h), /Check authorization/);
  assert.ok(visible(h).includes(`/commit/${HEAD}`)); assert.ok(visible(h).includes(`/commit/${NEXT}`));
  h.state.pr.state = 'closed'; h.state.pr.merged = true;
  await h.claim({ action: 'closed' }, { runId: 102, expectedSha: NEXT });
  assert.equal(h.saved().current.status, 'merged');
  assert.match(visible(h), /マージ済み/); assert.match(visible(h), /最終差分へのAIレビューは未実行/);
  assert.match(visible(h), /Check authorization/);
  assert.ok(!visible(h).includes('/ai-review')); assert.ok(!visible(h).includes('open・非Draft'));
  assert.deepEqual(h.saved().last_review, before);
  assert.equal(h.apiCalls().length, 1);
  assert.equal((await publishPipeline(h.report, h.opts, h.github)).status, 'stale');
  assert.match(visible(h), /マージ済み/);
});

test('merging the reviewed revision retains its result without asking for a new review', async () => {
  const h = await reviewed(); h.state.pr.state = 'closed'; h.state.pr.merged = true;
  await h.claim({ action: 'closed' }, { runId: 101 });
  assert.match(visible(h), /Check authorization/);
  assert.ok(!visible(h).includes('最終差分へのAIレビューは未実行'));
  assert.ok(!visible(h).includes('/ai-review'));
  assert.equal(h.apiCalls().length, 1);
});

test('closed, draft, label removal and reopening preserve history and do not acquire paid requests', async () => {
  const h = await reviewed();
  h.state.pr.draft = true;
  await h.claim({ action: 'converted_to_draft' }, { runId: 101 });
  assert.equal(h.saved().current.status, 'paused_draft'); assert.match(visible(h), /Check authorization/);
  h.state.pr.draft = false; h.state.pr.labels = [];
  await h.claim({ action: 'unlabeled', label: { name: 'ai-review' } }, { runId: 102 });
  assert.equal(h.saved().current.status, 'cancelled'); assert.match(visible(h), /Check authorization/);
  h.state.pr.state = 'closed';
  await h.claim({ action: 'closed' }, { runId: 103 });
  assert.equal(h.saved().current.status, 'closed');
  assert.ok(!visible(h).includes('/ai-review')); assert.match(visible(h), /Check authorization/);
  h.state.pr.state = 'open'; h.state.pr.labels = [{ name: 'ai-review' }];
  await h.claim({ action: 'reopened' }, { runId: 104 });
  assert.match(visible(h), /前回と同じ差分/); assert.match(visible(h), /Check authorization/);
  assert.ok(!visible(h).includes('/ai-review'));
  assert.equal(h.apiCalls().length, 1);
  assert.equal(h.state.bot.body.split(REVIEW_START).length, 2);
});

test('a failed explicit rerun retains the previous successful findings and shows the failure separately', async () => {
  const h = await reviewed(); const before = structuredClone(h.saved().last_review);
  const opts = { ...h.opts, eventName: 'workflow_dispatch', runId: 101 };
  const { request } = await prepareRequest({}, opts, h.github);
  assert.match(visible(h), /実行中/); assert.match(visible(h), /Check authorization/);
  h.state.responseStatus = 429;
  const report = await executeRequest(request, opts, h.dependencies);
  assert.equal(report.status, 'review_failed');
  await publishPipeline(report, opts, h.github);
  assert.match(visible(h), /本レビューを完了できません/); assert.match(visible(h), /前回の本レビュー/);
  assert.match(visible(h), /Check authorization/); assert.deepEqual(h.saved().last_review, before);
});

test('a close racing with publication does not replace the comment with instructions to reopen a merged PR', async () => {
  for (const merged of [true, false]) {
    const h = await reviewed();
    const opts = { ...h.opts, eventName: 'workflow_dispatch', runId: 101 };
    const { request } = await prepareRequest({}, opts, h.github);
    const report = await executeRequest(request, opts, h.dependencies);
    h.state.pr.state = 'closed'; h.state.pr.merged = merged;
    assert.equal((await publishPipeline(report, opts, h.github)).status, 'stale');
    assert.equal(h.saved().current.status, merged ? 'merged' : 'closed');
    assert.match(visible(h), /Check authorization/); assert.ok(!visible(h).includes('/ai-review'));
  }
});

test('legacy completed comments are adopted on the next event without changing request watermarks or repeating commands', async () => {
  const h = await reviewed(); const state = h.saved(); delete state.last_review;
  h.state.bot.body = `<!-- itoma-ai-review -->\n## AIレビュー\n\n**修正候補 1件。**\n\nOld actionable finding\n\n${REVIEW_AGAIN}\n\n対象: [\`${HEAD.slice(0, 7)}\`](https://github.com/owner/itoma/commit/${HEAD}) · [詳細・ログ](${h.opts.runUrl})\n\n<!-- itoma-ai-state:${Buffer.from(JSON.stringify(state)).toString('base64url')} -->`;
  h.state.pr.state = 'closed'; h.state.pr.merged = true;
  await h.claim({ action: 'closed' }, { runId: 101 });
  assert.match(visible(h), /Old actionable finding/); assert.ok(!visible(h).includes('/ai-review'));
  assert.equal(h.saved().last_review.finding_count, 1);
  assert.equal(h.saved().last_review.run_id, 100); assert.equal(h.saved().last_command_id, state.last_command_id);
  assert.equal(h.apiCalls().length, 1);
});

test('corrupted historical prose cannot become findings, and malformed metadata cannot bypass existing state validation', async () => {
  const h = await reviewed();
  h.state.bot.body = h.state.bot.body.replace('Check authorization', 'Injected finding');
  h.state.pr.state = 'closed'; h.state.pr.merged = true;
  await h.claim({ action: 'closed' }, { runId: 101 });
  assert.ok(!visible(h).includes('Injected finding'));
  assert.match(visible(h), /本文は復元できません/);
  const state = h.saved(); state.last_review.run_id = '100)';
  const body = `<!-- itoma-ai-review -->\n<!-- itoma-ai-state:${Buffer.from(JSON.stringify(state)).toString('base64url')} -->`;
  assert.throws(() => parseState({ body }, h.opts, h.state.pr));
});

test('a new completed review replaces old findings without duplicating the body in the hidden state', async () => {
  const h = await reviewed(); const opts = { ...h.opts, eventName: 'workflow_dispatch', runId: 101 };
  const { request } = await prepareRequest({}, opts, h.github);
  const report = await executeRequest(request, opts, h.dependencies);
  report.review.review.findings = [];
  await publishPipeline(report, opts, h.github);
  assert.ok(!visible(h).includes('Check authorization')); assert.match(visible(h), /修正候補は見つかりません/);
  assert.equal(h.saved().last_review.run_id, 101);
  assert.ok(!JSON.stringify(h.saved()).includes('修正候補は見つかりません'));
  assert.ok(extractReviewBody(h.state.bot, h.saved()));
  assert.equal(h.state.bot.body.split(REVIEW_START).length, 2);
  assert.equal(h.state.bot.body.split(REVIEW_END).length, 2);
});
