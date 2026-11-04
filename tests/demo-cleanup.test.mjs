import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupDemo } from '../scripts/lib/demo-cleanup.mjs';
import { demoTarget, DEMO_ZONE } from '../scripts/lib/demo-target.mjs';

function fixture() {
  const target = demoTarget('demo/cleanup-check');
  const accountId = 'a'.repeat(32);
  const zoneId = 'b'.repeat(32);
  const unrelated = { id: 'f'.repeat(32), pattern: 'other.example.com/*', script: 'unrelated' };
  const state = {
    branchChecks: 0, exists: false, githubStatus: 200,
    worker: { id: 'c'.repeat(32), name: target.workerName, references: { domains: [], workers: [], queues: [] } },
    routes: target.routes.map((pattern, i) => ({ id: String(i + 1).repeat(32), pattern, script: target.workerName })).concat(unrelated),
    calls: [], failDelete: false, recreateAt: Infinity, changeRoute: false,
  };
  const response = (status, result) => ({ status, ok: status >= 200 && status < 300, json: async () => ({ success: status < 400, result }) });
  const options = {
    branch: target.branch, defaultBranch: 'main', repository: 'owner/repo', accountId,
    githubToken: 'github-fixture', cloudflareToken: 'cloudflare-fixture', apply: true,
    async fetchImpl(url, { method = 'GET' } = {}) {
      const u = new URL(url);
      state.calls.push({ host: u.host, path: u.pathname, method, search: u.search });
      if (u.host === 'api.github.com') {
        state.branchChecks++;
        if (state.githubStatus === 403) return response(403);
        const exists = state.exists || state.branchChecks >= state.recreateAt;
        return { status: exists ? 200 : 404, ok: exists, json: async () => ({ ref: `refs/heads/${target.branch}`, object: { sha: 'new' } }) };
      }
      assert.equal(u.host, 'api.cloudflare.com');
      if (u.pathname === '/client/v4/zones') return response(200, [{ id: zoneId, name: DEMO_ZONE, account: { id: accountId } }]);
      const routesPath = `/client/v4/zones/${zoneId}/workers/routes`;
      if (u.pathname === routesPath) return response(200, structuredClone(state.routes));
      if (u.pathname.startsWith(`${routesPath}/`)) {
        const id = u.pathname.split('/').at(-1);
        const route = state.routes.find(x => x.id === id);
        if (!route) return response(404);
        if (method === 'DELETE') {
          if (state.failDelete) return response(500);
          state.routes = state.routes.filter(x => x.id !== id);
        }
        return response(200, state.changeRoute ? { ...route, script: 'changed' } : route);
      }
      assert.equal(u.pathname, `/client/v4/accounts/${accountId}/workers/workers/${method === 'DELETE' ? 'c'.repeat(32) : target.workerName}`);
      if (!state.worker) return response(404);
      if (method === 'DELETE') {
        assert.equal(u.searchParams.get('force'), 'false');
        state.worker = null;
      }
      return response(200, state.worker);
    },
  };
  return { options, state, unrelated };
}
const deletions = state => state.calls.filter(x => x.method === 'DELETE');

test('deletes only two owned routes and their Worker, and is safe to rerun', async () => {
  const { options, state, unrelated } = fixture();
  const result = await cleanupDemo(options);
  assert.equal(result.status, 'deleted');
  assert.equal(result.deletedRoutes, 2);
  assert.equal(result.deletedWorker, true);
  assert.deepEqual(state.routes, [unrelated]);
  assert.equal(deletions(state).length, 3);
  const again = await cleanupDemo(options);
  assert.equal(again.deletedRoutes, 0);
  assert.equal(again.deletedWorker, false);
  assert.equal(deletions(state).length, 3);
});

test('dry run only plans the exact resources', async () => {
  const { options, state } = fixture();
  const result = await cleanupDemo({ ...options, apply: false });
  assert.equal(result.status, 'planned');
  assert.equal(result.routeIds.length, 2);
  assert.equal(deletions(state).length, 0);
});

test('protects main/default branches and refuses incomplete credentials', async () => {
  for (const override of [{ branch: 'main' }, { branch: 'release', defaultBranch: 'release' }, { defaultBranch: '' }, { accountId: '' }, { githubToken: '' }, { cloudflareToken: '' }]) {
    const { options, state } = fixture();
    await assert.rejects(cleanupDemo({ ...options, ...override }));
    assert.equal(state.calls.length, 0);
  }
});

test('skips a recreated branch before querying Cloudflare', async () => {
  const { options, state } = fixture();
  state.exists = true;
  assert.equal((await cleanupDemo(options)).status, 'skipped');
  assert.equal(state.calls.length, 1);
});

test('stops if a branch is recreated during cleanup', async () => {
  const { options, state } = fixture();
  state.recreateAt = 3;
  const result = await cleanupDemo(options);
  assert.equal(result.status, 'skipped');
  assert.equal(result.deletedRoutes, 1);
  assert.equal(result.deletedWorker, false);
  assert.equal(deletions(state).length, 1);
});

test('fails closed for GitHub permission errors', async () => {
  const { options, state } = fixture();
  state.githubStatus = 403;
  await assert.rejects(cleanupDemo(options), /GitHub.*403/);
  assert.equal(state.calls.length, 1);
});

test('refuses shared Workers, unexpected routes, and mismatched route owners', async () => {
  for (const change of [
    s => { s.worker.name = 'itoma-demo'; },
    s => { s.worker.references.domains.push({ hostname: 'shared.example.com' }); },
    s => { s.worker.references.workers.push({ name: 'consumer' }); },
    s => { delete s.worker.references; },
    s => { s.routes[0].script = 'other'; },
    s => { s.routes[0].pattern = 'itoma-demo.kzk-maeda.com/*'; },
  ]) {
    const { options, state } = fixture();
    change(state);
    await assert.rejects(cleanupDemo(options));
    assert.equal(deletions(state).length, 0);
  }
});

test('rechecks route ownership immediately before deletion', async () => {
  const { options, state } = fixture();
  state.changeRoute = true;
  await assert.rejects(cleanupDemo(options), /Route changed/);
  assert.equal(deletions(state).length, 0);
});

test('a failed route deletion prevents Worker deletion and can be retried', async () => {
  const { options, state } = fixture();
  state.failDelete = true;
  await assert.rejects(cleanupDemo(options), /Cloudflare DELETE failed/);
  assert.ok(state.worker);
  state.failDelete = false;
  assert.equal((await cleanupDemo(options)).status, 'deleted');
});

test('removes orphaned routes if the dedicated Worker was already deleted', async () => {
  const { options, state, unrelated } = fixture();
  state.worker = null;
  const result = await cleanupDemo(options);
  assert.equal(result.deletedRoutes, 2);
  assert.equal(result.deletedWorker, false);
  assert.deepEqual(state.routes, [unrelated]);
});
