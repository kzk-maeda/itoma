import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { parseCommand, prepareRequest, receiveCommand, requestOptions, parseState } from '../scripts/lib/ai-review-requests.mjs';
import { executeRequest, publishPipeline } from '../scripts/lib/ai-review-pipeline.mjs';
import { harness, HEAD, NEXT, WORKFLOW } from './fixtures/ai-review-harness.mjs';

test('slash commands accept only complete, standalone commands', () => {
  assert.equal(parseCommand('  /ai-review\n'), 'force');
  assert.equal(parseCommand('/ai-review reassess'), 'reassess');
  for (const body of ['/ai-review please', '`/ai-review`', '```\n/ai-review\n```', '> /ai-review', '/ai-review\n/ai-review', '/ai-review; echo secret', 'please /ai-review']) assert.equal(parseCommand(body), null);
});

test('authorized Conversation comment dispatches a pinned PR request with no OpenAI call or GitHub state write', async () => {
  const h = harness(); const event = h.command();
  const result = await receiveCommand(event, { ...h.opts, eventName: 'issue_comment' }, h.github);
  assert.equal(result.status, 'dispatched'); assert.equal(h.apiCalls().length, 0);
  assert.deepEqual(h.state.writes, [{ path: '/actions/workflows/ai-review.yml/dispatches', method: 'POST', body: { ref: 'main', inputs: { pull_request_number: '42', mode: 'force', comment_id: '10', expected_sha: HEAD } } }]);
});

test('ordinary comments, issues, edits and receiver retries do not dispatch', async () => {
  for (const kind of ['ordinary', 'issue', 'edited', 'retry']) {
    const h = harness(); const event = h.command(kind === 'ordinary' ? 'hello' : '/ai-review');
    if (kind === 'issue') delete event.issue.pull_request;
    if (kind === 'edited') event.action = 'edited';
    const result = await receiveCommand(event, { ...h.opts, attempt: kind === 'retry' ? 2 : 1 }, h.github);
    assert.equal(result.status, 'ignored'); assert.equal(h.state.calls.length, 0);
  }
});

test('permission, PR eligibility, comment ownership and edits are checked before dispatch', async () => {
  for (const kind of ['permission', 'fork', 'draft', 'closed', 'base', 'other-pr', 'comment-edit']) {
    const h = harness(); const event = h.command('/ai-review', kind === 'permission' ? 'outsider' : 'owner');
    if (kind === 'fork') h.state.pr.head.repo.full_name = 'fork/itoma';
    if (kind === 'draft') h.state.pr.draft = true;
    if (kind === 'closed') h.state.pr.state = 'closed';
    if (kind === 'base') h.state.pr.base.ref = 'other';
    if (kind === 'other-pr') event.comment.issue_url = 'https://api.github.com/repos/owner/itoma/issues/5';
    if (kind === 'comment-edit') event.comment.updated_at = '2026-11-15T00:01:00Z';
    assert.equal((await receiveCommand(event, h.opts, h.github)).status, 'rejected');
    assert.equal(h.state.writes.length, 0); assert.equal(h.apiCalls().length, 0);
  }
});

test('command dispatch uses the original authorized author, bypasses Decisions and deduplicates the comment ID', async () => {
  const h = harness(); h.command();
  const opts = { ...h.opts, eventName: 'workflow_dispatch', actor: 'github-actions[bot]', commentId: 10 };
  const prepared = await prepareRequest({}, opts, h.github);
  assert.equal(prepared.request.author, 'owner'); assert.equal(prepared.request.mode, 'force');
  const report = await executeRequest(prepared.request, opts, h.dependencies);
  assert.equal(report.status, 'reviewed'); assert.equal(h.apiCalls('/decisions').length, 0); assert.equal(h.apiCalls('/responses').length, 1);
  assert.equal((await publishPipeline(report, opts, h.github)).status, 'published');
  assert.equal((await prepareRequest({}, { ...opts, runId: 101 }, h.github)).run, false);
  assert.equal((await receiveCommand(h.command('/ai-review', 'owner', 10), { ...h.opts, runId: 101 }, h.github)).status, 'duplicate');
  h.command('/ai-review', 'owner', 11);
  assert.equal((await prepareRequest({}, { ...opts, runId: 102, commentId: 11 }, h.github)).run, true);
});

test('reassess command calls Decisions, while revoked permission, edited/deleted comments and stale dispatch cannot call paid APIs', async () => {
  const h = harness(); h.command('/ai-review reassess');
  const opts = { ...h.opts, mode: 'reassess', commentId: 10, eventName: 'workflow_dispatch' };
  const { request } = await prepareRequest({}, opts, h.github);
  const report = await executeRequest(request, opts, h.dependencies);
  assert.equal(report.status, 'skipped_low'); assert.equal(h.apiCalls('/decisions').length, 1);
  for (const kind of ['revoked', 'deleted', 'edited', 'head', 'base', 'label']) {
    const f = harness(); f.command();
    const o = { ...f.opts, commentId: 10, eventName: 'workflow_dispatch' };
    const { request } = await prepareRequest({}, o, f.github);
    if (kind === 'revoked') f.state.permissions.owner = 'read';
    if (kind === 'deleted') f.state.comments = [];
    if (kind === 'edited') f.state.comments[0].body = '/ai-review reassess';
    if (kind === 'head') f.state.pr.head.sha = NEXT;
    if (kind === 'base') f.state.pr.base.sha = NEXT;
    if (kind === 'label') f.state.pr.labels = [];
    assert.equal((await executeRequest(request, o, f.dependencies)).status, 'stale');
    assert.equal(f.apiCalls().length, 0);
  }
  const s = harness(); s.command(); s.state.pr.head.sha = NEXT;
  await assert.rejects(prepareRequest({}, { ...s.opts, commentId: 10, eventName: 'workflow_dispatch' }, s.github));
});

test('initial draft waits for first ready at latest SHA; later ready/reopen/push never creates another API slot', async () => {
  const h = harness(); h.state.pr.draft = true;
  assert.equal((await h.claim()).run, false); assert.equal(h.saved().current.status, 'pending_draft');
  assert.deepEqual(h.state.pr.labels, [{ name: 'ai-review' }]);
  h.state.pr.head.sha = NEXT;
  await h.claim({ action: 'synchronize' }, { runId: 101, expectedSha: NEXT });
  assert.equal(h.saved().initial.pending, true);
  h.state.pr.draft = false;
  const { request } = await h.claim({ action: 'ready_for_review' }, { runId: 102, expectedSha: NEXT });
  assert.equal(request.head_sha, NEXT); assert.equal(h.saved().initial.consumed, true);
  for (const [i, action] of ['synchronize', 'reopened', 'ready_for_review'].entries()) assert.equal((await h.claim({ action }, { runId: 103 + i, expectedSha: NEXT })).run, false);
  assert.equal(h.apiCalls().length, 0);
});

test('forks receive an automatic label but cannot start paid work', async () => {
  for (const draft of [false, true]) {
    const h = harness(); h.state.pr.head.repo.full_name = 'fork/itoma'; h.state.pr.draft = draft;
    assert.equal((await h.claim()).run, false);
    assert.deepEqual(h.state.pr.labels, [{ name: 'ai-review' }]);
    assert.equal(h.saved().current.status, 'unsupported');
    assert.equal(h.saved().initial.consumed, true); assert.equal(h.apiCalls().length, 0);
  }
});

test('removing a label cancels pending/claimed work, never restores it on push, and stale add events cannot override removal', async () => {
  const h = harness(); const { request } = await h.claim(); h.state.pr.labels = [];
  await h.claim({ action: 'unlabeled', label: { name: 'ai-review' } }, { runId: 101 });
  assert.equal(h.saved().current.status, 'cancelled');
  await h.claim({ action: 'synchronize' }, { runId: 102 });
  assert.deepEqual(h.state.pr.labels, []);
  assert.equal((await h.claim({ action: 'labeled', label: { name: 'ai-review' } }, { runId: 103 })).run, false);
  assert.equal((await executeRequest(request, h.opts, h.dependencies)).status, 'stale');
  assert.equal(h.apiCalls().length, 0);
});

test('unrelated label/body events are ignored, lost state is not an unused initial slot, and damaged state fails closed', async () => {
  const h = harness(); await h.claim(); const original = h.state.bot.body;
  for (const event of [{ action: 'labeled', label: { name: 'bug' } }, { action: 'edited', changes: { body: {} } }]) assert.equal((await h.claim(event, { runId: 101 })).run, false);
  assert.equal(h.state.bot.body, original);
  h.state.bot = null;
  assert.equal((await h.claim({ action: 'ready_for_review' }, { runId: 102 })).run, false);
  const d = harness(); await d.claim(); d.state.bot.body = d.state.bot.body.replace(/itoma-ai-state:[^ ]+/, 'itoma-ai-state:broken');
  await assert.rejects(d.claim({ action: 'synchronize' }, { runId: 101 }));
  assert.equal(d.apiCalls().length, 0);
});

test('paid-job reruns never resubmit, failed publishing can reuse its artifact, and an old publisher cannot overwrite a new generation', async () => {
  const h = harness(); const { request } = await h.claim();
  assert.equal((await executeRequest(request, { ...h.opts, attempt: 2 }, h.dependencies)).status, 'manual_required');
  assert.equal(h.apiCalls().length, 0);
  const report = await executeRequest(request, h.opts, h.dependencies);
  assert.equal((await publishPipeline(report, { ...h.opts, attempt: 2 }, h.github)).status, 'published');
  await h.claim({ action: 'labeled', label: { name: 'ai-review' } }, { runId: 101 });
  const generation = h.saved().current.id;
  assert.equal((await publishPipeline(report, h.opts, h.github)).status, 'stale');
  assert.equal(h.saved().current.id, generation);
});

test('a state-write failure prevents all paid API work; corrupt/cross-PR metadata and invalid runtime inputs are rejected', async () => {
  const h = harness();
  const failing = async (path, init) => { if (init?.method === 'POST' && path === '/issues/42/comments') throw new Error('write denied'); return h.github(path, init); };
  await assert.rejects(prepareRequest({ action: 'opened' }, h.opts, failing)); assert.equal(h.apiCalls().length, 0);
  const d = harness(); await d.claim(); assert.throws(() => parseState(d.state.bot, { ...d.opts, number: 1 }, d.state.pr));
  assert.throws(() => requestOptions({ GITHUB_RUN_ID: '1;echo', GITHUB_WORKFLOW_SHA: WORKFLOW }, h.opts));
  assert.throws(() => requestOptions({ GITHUB_RUN_ID: '1', GITHUB_WORKFLOW_SHA: WORKFLOW, AI_REVIEW_MODE: 'anything' }, h.opts));
});

test('comment receiver has no OpenAI secret or shared concurrency and pins executable code', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ai-review-command.yml', import.meta.url), 'utf8');
  assert.ok(!/^concurrency:/m.test(workflow)); assert.ok(!workflow.includes('secrets.OPENAI_API_KEY'));
  assert.match(workflow, /ref: \$\{\{ github.workflow_sha \}\}/);
  assert.ok(!workflow.includes('github.event.comment.body }}'));
});

test('permission revoked while collecting full-review context is checked again before the paid call', async () => {
  const h = harness(); h.command();
  const opts = { ...h.opts, commentId: 10, eventName: 'workflow_dispatch' };
  const { request } = await prepareRequest({}, opts, h.github);
  h.state.beforeRequest = url => { if (url.pathname.includes('/contents/')) h.state.permissions.owner = 'read'; };
  const report = await executeRequest(request, opts, h.dependencies);
  assert.equal(report.status, 'stale'); assert.equal(h.apiCalls().length, 0);
  assert.equal((await publishPipeline(report, opts, h.github)).status, 'stale');
  assert.equal(h.saved().current.status, 'stale');
});

test('manual dispatch without a source comment requires the actual actor to have current write permission', async () => {
  for (const actor of ['outsider', 'github-actions[bot]']) {
    const h = harness();
    await assert.rejects(prepareRequest({}, { ...h.opts, actor, eventName: 'workflow_dispatch' }, h.github));
    assert.equal(h.state.writes.length, 0); assert.equal(h.apiCalls().length, 0);
  }
  const h = harness();
  const opts = { ...h.opts, eventName: 'workflow_dispatch' };
  const { request } = await prepareRequest({}, opts, h.github);
  h.state.permissions.owner = 'read';
  assert.equal((await executeRequest(request, opts, h.dependencies)).status, 'stale');
  assert.equal(h.apiCalls().length, 0);
});

test('legacy prose mentioning the state marker cannot be mistaken for executable workflow state', () => {
  const h = harness();
  assert.equal(parseState({ body: '<!-- itoma-ai-review -->\nFinding: preserve the itoma-ai-state: field.' }, h.opts, h.state.pr), null);
});

test('publication rechecks the PR immediately before writing and never publishes findings for an updated head', async () => {
  const h = harness(); h.command();
  const opts = { ...h.opts, commentId: 10, eventName: 'workflow_dispatch' };
  const { request } = await prepareRequest({}, opts, h.github);
  const report = await executeRequest(request, opts, h.dependencies);
  let reads = 0;
  h.state.beforeRequest = url => { if (url.pathname.endsWith('/pulls/42') && ++reads === 2) h.state.pr.head.sha = NEXT; };
  assert.equal((await publishPipeline(report, opts, h.github)).status, 'stale');
  assert.equal(h.saved().current.status, 'stale');
  assert.ok(!h.state.bot.body.includes('Check authorization'));
});

test('workflow concurrency admits review/cancellation events but unrelated labels, edits and comments cannot cancel work', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ai-review.yml', import.meta.url), 'utf8');
  const block = workflow.split('\nconcurrency:\n')[1].split('\nenv:\n')[0];
  const expression = [...block.matchAll(/\$\{\{([\s\S]*?)\}\}/g)][1][1];
  for (const [eventName, action, label, base, expected] of [
    ['pull_request_target', 'labeled', 'bug', null, '777'],
    ['pull_request_target', 'labeled', 'ai-review', null, 'active'],
    ['pull_request_target', 'unlabeled', 'ai-review', null, 'active'],
    ['pull_request_target', 'edited', '', null, '777'],
    ['pull_request_target', 'edited', '', { ref: { from: 'main' } }, 'active'],
    ['pull_request_target', 'synchronize', '', null, 'active'],
    ['workflow_dispatch', '', '', null, 'active'],
    ['issue_comment', 'created', '', null, '777'],
  ]) {
    const actual = runInNewContext(expression, { github: { event_name: eventName, run_id: '777', event: { action, label: { name: label }, changes: { base } } }, contains: (a, v) => a.includes(v), fromJSON: JSON.parse }, { timeout: 100 });
    assert.equal(actual, expected);
  }
});
