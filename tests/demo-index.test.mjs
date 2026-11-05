import test from 'node:test';
import assert from 'node:assert/strict';
import { collectEnvironments, renderIndex, summaryFor } from '../scripts/lib/demo-index.mjs';
import { demoTarget, DEMO_HOST } from '../scripts/lib/demo-target.mjs';

const accountId = 'a'.repeat(32);
const zoneId = 'b'.repeat(32);
const repository = 'kzk-maeda/itoma';
const target = demoTarget('feat/new-screen');
const branch = { name: target.branch, commit: { sha: 'd'.repeat(40) } };
const routes = target.routes.map(pattern => ({ pattern, script: target.workerName }));
function fixture(overrides = {}) {
  const calls = [];
  const settings = { routes, branches: [branch], prs: [{ number: 42, title: '解除画面の検証', body: '## 変更内容\n\n理由入力と取消の導線を確認します。', head: { ref: branch.name, repo: { full_name: repository } } }], worker: { id: 'c'.repeat(32), name: target.workerName, updated_on: '2026-11-04T00:00:00Z' }, ...overrides };
  const fetchImpl = async (url, init) => {
    calls.push({ url, token: init.headers.Authorization });
    let result;
    if (url.includes('api.cloudflare.com')) {
      assert.equal(init.headers.Authorization, 'Bearer cloudflare-test');
      if (url.includes('/zones?')) result = [{ name: 'kzk-maeda.com', id: zoneId, account: { id: accountId } }];
      else if (url.endsWith('/workers/routes')) result = settings.routes;
      else if (url.endsWith(`/workers/${target.workerName}`)) {
        if (settings.worker === null) return new Response('', { status: 404 });
        result = settings.worker;
      } else throw new Error(`Unexpected URL: ${url}`);
      return Response.json({ success: true, result });
    }
    assert.equal(init.headers.Authorization, 'Bearer github-test');
    if (url.includes('/branches?')) result = settings.branches;
    else if (url.includes('/pulls?')) result = settings.prs;
    else if (url.includes('/commits/')) result = { commit: { message: '新しい設定を検証\n\n詳細' } };
    else throw new Error(`Unexpected URL: ${url}`);
    return Response.json(result);
  };
  return { input: { accountId, repository, cloudflareToken: 'cloudflare-test', githubToken: 'github-test', fetchImpl }, calls };
}

test('index requires a matching route pair and existing Worker, not just a Git branch', async () => {
  const { input } = fixture();
  const result = await collectEnvironments(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].summary, '理由入力と取消の導線を確認します。');
  assert.equal(result[0].prNumber, 42);
  assert.equal(result[0].basePath, target.basePath);
  for (const overrides of [{ routes: [] }, { routes: routes.slice(1) }, { worker: null }, { routes: routes.map(r => ({ ...r, script: 'unrelated-worker' })) }]) {
    assert.deepEqual(await collectEnvironments(fixture(overrides).input), []);
  }
});

test('deleted/unknown branches with live routes remain visible, and no-PR summaries use commit text', async () => {
  const unknown = await collectEnvironments(fixture({ branches: [], prs: [] }).input);
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].branch, null);
  const fallback = await collectEnvironments(fixture({ prs: [] }).input);
  assert.equal(fallback[0].summary, '新しい設定を検証');
});

test('API errors and unexpected Worker identity fail instead of publishing an empty success', async () => {
  await assert.rejects(collectEnvironments({ ...fixture().input, fetchImpl: async () => new Response('', { status: 403 }) }), /HTTP 403/);
  await assert.rejects(collectEnvironments(fixture({ worker: { name: 'other', id: 'c'.repeat(32) } }).input), /identity/);
  await assert.rejects(collectEnvironments({ ...fixture().input, accountId: 'bad' }), /required/);
});

test('GitHub pagination is exhausted and fork PRs are not used as environment summaries', async () => {
  const { input } = fixture({ prs: [{ title: 'fork', head: { ref: branch.name, repo: { full_name: 'other/itoma' } } }] });
  const baseFetch = input.fetchImpl;
  let secondPage = false;
  input.fetchImpl = async (url, init) => {
    if (url.includes('/branches?') && url.endsWith('page=1')) return Response.json(Array.from({ length: 100 }, (_, i) => ({ name: `test/${i}` })));
    if (url.includes('/branches?') && url.endsWith('page=2')) { secondPage = true; return Response.json([branch]); }
    return baseFetch(url, init);
  };
  const result = await collectEnvironments(input);
  assert.equal(secondPage, true);
  assert.equal(result[0].branch, branch.name);
  assert.equal(result[0].prNumber, null);
});

test('rendering escapes untrusted PR text, provides relative demo links and explicit empty state', () => {
  const html = renderIndex([{ ...target, title: '<script>alert(1)</script>', summary: '<img src=x onerror=alert(1)>', branch: target.branch, prNumber: 42 }], '2026-11-04');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes(`href="${target.basePath}/"`));
  assert.ok(html.includes('PR #42'));
  assert.ok(renderIndex([], 'now').includes('現在、配信中のブランチデモはありません。'));
  assert.equal(summaryFor(null, null), 'ブランチごとに配信された検証用のデモです。');
});
