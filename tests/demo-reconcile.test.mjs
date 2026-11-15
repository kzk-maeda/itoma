import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reconcileDemos } from '../scripts/lib/demo-reconcile.mjs';
import { cleanupDemo } from '../scripts/lib/demo-cleanup.mjs';
import { demoTarget, demoTargetFromWorker, DEMO_ZONE } from '../scripts/lib/demo-target.mjs';

const orphan = demoTarget('demo/deleted-local-check');
const legacy = demoTarget('feat/deleted-before-cleanup');
const live = demoTarget('demo/retained');
const accountId = 'a'.repeat(32), zoneId = 'b'.repeat(32);
function fixture() {
  const worker = (name, n) => ({ name, id: String(n).padStart(32, '0'), references: { workers: [], domains: [], queues: [] } });
  const state = {
    branches: ['main', live.branch], branchChecks: 0, recreateAt: Infinity,
    workers: new Map([worker('itoma-demo', 1), worker(live.workerName, 2), worker(orphan.workerName, 3), worker(legacy.workerName, 4), worker('unrelated', 5)].map(w => [w.name, w])),
    routes: [live, orphan, legacy].flatMap((target, i) => target.routes.map((pattern, j) => ({ id: String(i * 2 + j + 1).padStart(32, '0'), pattern, script: target.workerName }))),
    calls: [], githubStatus: 200, workerPages: null, failBranchPage: null,
  };
  const response = result => Response.json({ success: true, result });
  const options = {
    accountId, repository: 'owner/repo', defaultBranch: 'main', githubToken: 'github-fixture', cloudflareToken: 'cf-fixture', apply: true,
    async fetchImpl(url, {method = 'GET'} = {}) {
      const u = new URL(url); state.calls.push({ path: u.pathname, method });
      if (u.hostname === 'api.github.com') {
        assert.ok(u.pathname.endsWith('/branches'));
        const page = Number(u.searchParams.get('page'));
        if (state.githubStatus !== 200 || page === state.failBranchPage) return new Response('', {status: 403});
        if (page === 1) state.branchChecks++;
        const branches = [...state.branches, ...(state.branchChecks >= state.recreateAt ? [orphan.branch] : [])];
        return Response.json(branches.slice((page - 1) * 100, page * 100).map(name => ({name})));
      }
      assert.equal(u.hostname, 'api.cloudflare.com');
      if (u.pathname === '/client/v4/zones') return response([{ id: zoneId, name: DEMO_ZONE, account: { id: accountId } }]);
      const routesPath = `/client/v4/zones/${zoneId}/workers/routes`;
      if (u.pathname === routesPath) return response(state.routes);
      if (u.pathname.startsWith(routesPath + '/')) {
        const id = u.pathname.split('/').at(-1); const route = state.routes.find(r => r.id === id);
        if (!route) return new Response('', {status: 404});
        if (method === 'DELETE') state.routes = state.routes.filter(r => r.id !== id);
        return response(route);
      }
      const workersPath = `/client/v4/accounts/${accountId}/workers/workers`;
      if (u.pathname === workersPath) {
        const page = Number(u.searchParams.get('page'));
        if (state.workerPages) return Response.json({success: true, result: state.workerPages[page - 1], result_info: {total_pages: state.workerPages.length}});
        return Response.json({success: true, result: [...state.workers.values()], result_info: {total_pages: 1}});
      }
      assert.ok(u.pathname.startsWith(workersPath + '/'));
      const identity = u.pathname.split('/').at(-1);
      const w = [...state.workers.values()].find(w => w.name === identity || w.id === identity);
      if (!w) return new Response('', {status: 404});
      if (method === 'DELETE') { assert.equal(u.searchParams.get('force'), 'false'); state.workers.delete(w.name); }
      return response(w);
    },
  };
  return {options, state};
}
const mutations = state => state.calls.filter(call => call.method === 'DELETE');

test('reclaims legacy/local orphans, preserves live/index/unrelated Workers, and is idempotent', async () => {
  const {options, state} = fixture();
  const result = await reconcileDemos(options);
  assert.equal(result.status, 'complete');
  assert.equal(result.retained, 1);
  assert.equal(result.results.length, 2);
  assert.ok(result.results.every(r => r.deletedWorker && r.deletedRoutes === 2));
  assert.deepEqual([...state.workers.keys()], ['itoma-demo', live.workerName, 'unrelated']);
  assert.deepEqual(state.routes.map(r => r.script), [live.workerName, live.workerName]);
  assert.equal(mutations(state).length, 6);
  assert.equal((await reconcileDemos(options)).results.length, 0);
  assert.equal(mutations(state).length, 6);
});

test('dry-run reports exact candidates without any mutations', async () => {
  const {options, state} = fixture(); const result = await reconcileDemos({...options, apply: false});
  assert.ok(result.results.every(r => r.status === 'planned' && r.routeIds.length === 2));
  assert.equal(mutations(state).length, 0);
});

test('finds and removes route-only leftovers after a partial/manual Worker deletion', async () => {
  const {options, state} = fixture(); state.workers.delete(orphan.workerName);
  const result = await reconcileDemos(options);
  const removed = result.results.find(r => r.target.workerName === orphan.workerName);
  assert.equal(removed.deletedRoutes, 2); assert.equal(removed.deletedWorker, false);
});

test('retains Workers for branches on later GitHub pages', async () => {
  const {options, state} = fixture();
  state.branches = ['main', ...Array.from({length: 102}, (_, i) => `feature/${i}`), live.branch, orphan.branch, legacy.branch];
  const result = await reconcileDemos(options);
  assert.equal(result.retained, 3); assert.equal(result.results.length, 0); assert.equal(mutations(state).length, 0);
});

test('Cloudflare total_pages is exhausted even when each page has fewer than 100 Workers', async () => {
  const {options, state} = fixture(); const rows = [...state.workers.values()];
  state.workerPages = [rows.slice(0, 2), rows.slice(2)];
  const result = await reconcileDemos(options);
  assert.equal(result.results.length, 2);
  assert.equal(state.calls.filter(c => c.path.endsWith('/workers/workers') && c.method === 'GET').length, 2);
});

test('permission errors, incomplete branch inventory and missing default branch never authorize deletion', async () => {
  for (const change of [s => {s.githubStatus = 403;}, s => {s.branches = Array.from({length: 101}, (_, i) => i ? `feat/${i}` : 'main'); s.failBranchPage = 2;}, s => {s.branches = [];}]) {
    const {options, state} = fixture(); change(state);
    await assert.rejects(reconcileDemos(options)); assert.equal(mutations(state).length, 0);
  }
});

test('invalid Worker pagination and duplicate identities fail before any deletion', async () => {
  for (const pages of [[[], []], [[{name: orphan.workerName, id: 'c'.repeat(32)}], [{name: orphan.workerName, id: 'c'.repeat(32)}]]]) {
    const {options, state} = fixture(); state.workerPages = pages;
    await assert.rejects(reconcileDemos(options)); assert.equal(mutations(state).length, 0);
  }
});

test('already absent branch resources are reported separately from actual deletions', async () => {
  const {options, state} = fixture(); state.workers.delete(orphan.workerName); state.routes = state.routes.filter(r => r.script !== orphan.workerName);
  const result = await cleanupDemo({...options, workerName: orphan.workerName});
  assert.equal(result.status, 'absent'); assert.equal(result.deletedRoutes, 0); assert.equal(result.deletedWorker, false); assert.equal(mutations(state).length, 0);
});

test('recreated branch stops cleanup between route deletions without deleting its Worker', async () => {
  const {options, state} = fixture(); state.recreateAt = 4;
  const result = await reconcileDemos(options);
  const skipped = result.results.find(r => r.target.workerName === orphan.workerName);
  assert.equal(skipped.status, 'skipped'); assert.equal(skipped.deletedRoutes, 1); assert.equal(skipped.deletedWorker, false);
  assert.ok(state.workers.has(orphan.workerName));
});

test('shared references or route ownership mismatches are visible failures; other safe candidates can finish', async () => {
  for (const change of [s => {s.workers.get(orphan.workerName).references.workers.push({name: 'consumer'});}, s => {s.routes.find(r => r.script === orphan.workerName).pattern = 'other.example.com/*';}]) {
    const {options, state} = fixture(); change(state);
    const result = await reconcileDemos(options);
    assert.equal(result.status, 'failed');
    assert.equal(result.results.find(r => r.target.workerName === orphan.workerName).status, 'failed');
    assert.ok(state.workers.has(orphan.workerName)); assert.ok(!state.workers.has(legacy.workerName));
  }
});

test('recognizes only canonical branch Worker names and protects main/default identities', async () => {
  for (const name of ['itoma-demo', 'unrelated', 'itoma-demo-bad', 'itoma-demo-x--y-123456789abc', 'itoma-demo-' + 'x'.repeat(37) + '-123456789abc']) assert.equal(demoTargetFromWorker(name), null);
  for (const branch of ['demo/with/slashes', 'demo/' + 'long-'.repeat(20), '日本語', 'feat/older']) assert.equal(demoTargetFromWorker(demoTarget(branch).workerName).key, demoTarget(branch).key);
  for (const name of ['itoma-demo', demoTarget('main').workerName, demoTarget('demo/default').workerName]) {
    const {options, state} = fixture();
    await assert.rejects(cleanupDemo({...options, defaultBranch: 'demo/default', workerName: name}));
    assert.equal(state.calls.length, 0);
  }
});

test('resource jobs share a bounded pending queue instead of cancelling other branches cleanup', () => {
  for (const file of ['deploy-demo.yml', 'cleanup-demo.yml', 'reconcile-demos.yml']) {
    const source = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
    assert.match(source, /group: itoma-demo-resource-mutations\s+cancel-in-progress: false\s+queue: max/);
  }
  const source = readFileSync(new URL('../.github/workflows/reconcile-demos.yml', import.meta.url), 'utf8');
  assert.match(source, /ref: \$\{\{ github.event.repository.default_branch \}\}/);
  assert.match(source, /schedule:/); assert.match(source, /default: true/);
});
