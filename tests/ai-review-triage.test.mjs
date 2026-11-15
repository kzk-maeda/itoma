import test from 'node:test';
import assert from 'node:assert/strict';
import { assessPR, criticalPaths, decideReview, validatePolicy } from '../scripts/lib/ai-review-triage.mjs';
import { executeRequest, publishPipeline, renderPipelineReport } from '../scripts/lib/ai-review-pipeline.mjs';
import { decision, harness, policy, NEXT } from './fixtures/ai-review-harness.mjs';

const facts = () => ({ files: [{ path: 'README.md' }], omissions: [] });

test('score boundaries, confidence, high-impact tail and important old/new paths route conservatively', () => {
  assert.equal(decideReview(decision(), facts(), policy).required, false);
  const below = decideReview(decision([1.99, 1.99, 1.99]), facts(), policy);
  assert.equal(below.required, false);
  assert.equal(decideReview(decision([2, 2, 2]), facts(), policy).required, true);
  assert.equal(decideReview(decision([0, 0, 0], 0.7), facts(), policy).required, false);
  assert.equal(decideReview(decision([0, 0, 0], 0.699), facts(), policy).required, true);
  const tail = decision();
  tail.answers[0].score = 0.9;
  tail.answers[0].probabilities.forEach(p => { p.probability = p.value === 0 ? 0.7 : p.value === 3 ? 0.3 : 0; });
  assert.ok(decideReview(tail, facts(), policy).reasons.includes('high_impact_tail'));
  for (const path of ['.github/workflows/ci.yml', 'AGENTS.md', 'modules/itoma-native/ios/X.swift', 'packages/itoma-storage/Sources/X.swift', 'src/state/control.ts', 'package-lock.json', 'infra/device-farm/main.tf']) {
    const f = { files: [{ path: 'moved.txt', previous_path: path }], omissions: [] };
    const result = decideReview(decision(), f, policy);
    assert.equal(result.score, 70); assert.equal(result.required, true);
    assert.deepEqual(criticalPaths(f.files, policy), [path]);
  }
});

test('refusal and omissions do not invent zero scores or imply a clean review', () => {
  const result = decision(); result.answers[0] = { name: 'impact', type: 'refusal' };
  const verdict = decideReview(result, facts(), policy);
  assert.equal(verdict.model_score, null); assert.equal(verdict.score, null); assert.equal(verdict.required, true);
  const f = facts(); f.omissions.push('missing patch');
  assert.ok(decideReview(decision(), f, policy).reasons.includes('insufficient_evidence'));
});

test('invalid models, missing/duplicate answers, scores, probability distributions and policies are rejected', () => {
  for (const mutate of [
    r => { r.model = 'gpt-5.6-sol'; }, r => { r.answers.pop(); }, r => { r.answers[1].name = 'impact'; },
    r => { r.answers[0].score = 5; }, r => { r.answers[0].confidence = null; },
    r => { r.answers[0].probabilities[0].probability = 0.5; }, r => { r.answers[0].score = 3; },
    r => { r.answers[0].probabilities[0].label = 'invented'; }, r => { r.answers[0].probabilities[0].value = 9; },
  ]) { const r = decision(); mutate(r); assert.throws(() => decideReview(r, facts(), policy)); }
  assert.throws(() => validatePolicy({ ...policy, critical_path_floor: 1 }));
  assert.throws(() => validatePolicy({ ...policy, model: 'gpt-5.6-sol' }));
});

test('low-impact initial request calls Decisions once and never starts a full review', async () => {
  const h = harness(); const { request } = await h.claim();
  const report = await executeRequest(request, h.opts, h.dependencies);
  assert.equal(report.status, 'skipped_low');
  assert.equal(h.apiCalls('/decisions').length, 1); assert.equal(h.apiCalls('/responses').length, 0);
  const body = h.apiCalls('/decisions')[0].body;
  assert.equal(body.model, 'gpt-6-luna'); assert.equal(body.questions.length, 3);
  assert.equal(body.questions[0].weight, undefined);
  for (const key of ['reasoning', 'store', 'max_output_tokens', 'text', 'tools']) assert.equal(body[key], undefined);
  assert.ok(!body.input.includes('ignore policies'));
  assert.equal(report.triage.request_id, 'req-fixture');
  assert.match(renderPipelineReport(report), /本レビューは実行していません/);
  assert.equal((await publishPipeline(report, h.opts, h.github)).status, 'published');
  assert.equal(h.saved().current.status, 'skipped_low');
  const writes = h.state.writes.length;
  assert.equal((await publishPipeline(report, h.opts, h.github)).status, 'already_published');
  assert.equal(h.state.writes.length, writes);
});

test('high-impact and important-path changes run Decisions then the existing full review', async () => {
  for (const importantPath of [false, true]) {
    const h = harness();
    if (importantPath) h.state.files[0].filename = '.github/workflows/ci.yml';
    else h.state.decisions = decision([3, 2, 2]);
    const { request } = await h.claim();
    const report = await executeRequest(request, h.opts, h.dependencies);
    assert.equal(report.status, 'reviewed');
    assert.equal(h.apiCalls('/decisions').length, 1); assert.equal(h.apiCalls('/responses').length, 1);
    assert.equal(h.apiCalls('/responses')[0].body.model, 'gpt-5.6-sol');
    assert.equal((await publishPipeline(report, h.opts, h.github)).status, 'published');
    assert.match(h.state.bot.body, /Check authorization/);
  }
});

test('authentication, rate limiting, timeout and malformed decision answers stop instead of reviewing every PR', async () => {
  for (const mutate of [
    s => { s.decisionStatus = 401; }, s => { s.decisionStatus = 429; }, s => { s.decisionStatus = 500; },
    s => { s.decisionError = true; }, s => { s.decisions.answers = []; },
  ]) {
    const h = harness(); mutate(h.state); const { request } = await h.claim();
    const report = await executeRequest(request, h.opts, h.dependencies);
    assert.equal(report.status, 'triage_failed');
    assert.equal(h.apiCalls('/decisions').length, 1); assert.equal(h.apiCalls('/responses').length, 0);
    assert.equal((await publishPipeline(report, h.opts, h.github)).status, 'published');
    assert.ok(!h.state.bot.body.includes('fixture-secret'));
    if (!h.state.decisionError) assert.equal(report.triage.request_id, 'req-fixture');
    if (h.state.decisions.answers.length === 0) assert.equal(report.triage.usage.input_tokens, 200);
  }
});

test('missing key, oversized/binary-only PRs and changed revisions never become low-risk success', async () => {
  for (const kind of ['key', 'large', 'binary']) {
    const h = harness();
    if (kind === 'large') h.state.pr.changed_files = 101;
    if (kind === 'binary') delete h.state.files[0].patch;
    const { request } = await h.claim();
    const report = await executeRequest(request, { ...h.opts, ...(kind === 'key' ? { apiKey: '' } : {}) }, h.dependencies);
    assert.equal(report.status, kind === 'key' ? 'triage_failed' : 'manual_required');
    assert.equal(h.apiCalls().length, 0);
  }
  const h = harness(); const { request } = await h.claim();
  h.state.decisions = decision([3, 3, 3]); h.state.afterDecision = () => { h.state.pr.head.sha = NEXT; };
  const report = await executeRequest(request, h.opts, h.dependencies);
  assert.equal(report.status, 'stale'); assert.equal(h.apiCalls('/responses').length, 0);
  assert.equal((await publishPipeline(report, h.opts, h.github)).status, 'stale');
  assert.equal(h.saved().current.status, 'stale');
});

test('only complete patches fit the lightweight input; omitted evidence escalates to review', async () => {
  const h = harness(); h.state.files[0].patch += `\n+${'x'.repeat(60_000)}`;
  const result = await assessPR({ pr: h.state.pr, github: h.github, policy, apiKey: h.opts.apiKey, beforeApi: async () => {}, fetchImpl: h.fetchImpl });
  const input = JSON.parse(h.apiCalls('/decisions')[0].body.input);
  assert.equal(input.patches.length, 0); assert.ok(input.omissions.length);
  assert.equal(result.required, true);
});
