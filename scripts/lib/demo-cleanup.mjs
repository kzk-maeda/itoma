import { demoTarget, DEMO_ZONE } from './demo-target.mjs';

/** Delete only a missing branch's dedicated resources. fetchImpl allows API contract tests. */
export async function cleanupDemo({ branch, defaultBranch, repository, accountId, githubToken, cloudflareToken, apply = false, fetchImpl = fetch }) {
  if (!defaultBranch || branch === 'main' || branch === defaultBranch) throw new Error('Default/main branch cleanup is forbidden.');
  const target = demoTarget(branch);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^[a-f0-9]{32}$/.test(accountId ?? '') || !githubToken || !cloudflareToken) {
    throw new Error('Repository, Cloudflare account ID, and GitHub/Cloudflare API tokens are required.');
  }
  const result = { target, status: 'planned', deletedRoutes: 0, deletedWorker: false };
  async function branchExists() {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`, {
      headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`GitHub branch lookup failed: HTTP ${response.status}`);
    const ref = await response.json();
    if (ref.ref !== `refs/heads/${branch}` || !ref.object?.sha) throw new Error('Unexpected GitHub branch response.');
    return true;
  }
  async function cf(path, method = 'GET', allowMissing = false) {
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4${path}`, {
      method, headers: { Authorization: `Bearer ${cloudflareToken}` }, signal: AbortSignal.timeout(30_000),
    });
    if (allowMissing && response.status === 404) return null;
    const body = await response.json();
    if (!response.ok || body.success !== true) throw new Error(`Cloudflare ${method} failed: HTTP ${response.status}`);
    return body.result;
  }
  const skip = () => ({ ...result, status: 'skipped', reason: 'branch-exists' });
  if (await branchExists()) return skip();
  // Resolve the exact zone in the configured account; never enumerate/delete other zones.
  const zones = await cf(`/zones?name=${DEMO_ZONE}&account.id=${accountId}`);
  if (!Array.isArray(zones) || zones.length !== 1 || zones[0].name !== DEMO_ZONE || zones[0].account?.id !== accountId || !/^[a-f0-9]{32}$/.test(zones[0].id)) {
    throw new Error('Expected exactly the demo zone in the configured account.');
  }
  const routesPath = `/zones/${zones[0].id}/workers/routes`;
  const workerPath = `/accounts/${accountId}/workers/workers/${target.workerName}`;
  function checkWorker(worker) {
    if (worker === null) return;
    if (worker.name !== target.workerName || !/^[a-f0-9]{32}$/.test(worker.id ?? '') || !worker.references ||
        Object.values(worker.references).some(refs => !Array.isArray(refs) || refs.length > 0)) {
      throw new Error('Worker identity or references do not match an isolated branch demo.');
    }
  }
  function checkRoutes(routes) {
    if (!Array.isArray(routes)) throw new Error('Unexpected route list response.');
    for (const route of routes) {
      const ownPattern = target.routes.includes(route.pattern);
      const ownWorker = route.script === target.workerName;
      if (ownPattern !== ownWorker) throw new Error('Route ownership mismatch; refusing cleanup.');
      if (ownWorker && !/^[a-f0-9]{32}$/.test(route.id)) throw new Error('Invalid route ID.');
    }
    return routes.filter(route => route.script === target.workerName);
  }
  const worker = await cf(workerPath, 'GET', true);
  checkWorker(worker);
  const routes = checkRoutes(await cf(routesPath));
  result.routeIds = routes.map(route => route.id);
  result.workerExists = worker !== null;
  if (!apply) return result;
  // Concurrency is shared with deployment. Recheck existence before each mutation,
  // including retries of old delete events after the branch has been recreated.
  for (const route of routes) {
    if (await branchExists()) return skip();
    const current = await cf(`${routesPath}/${route.id}`, 'GET', true);
    if (current === null) continue;
    if (current.id !== route.id || current.pattern !== route.pattern || current.script !== target.workerName) {
      throw new Error('Route changed during cleanup; refusing deletion.');
    }
    await cf(`${routesPath}/${route.id}`, 'DELETE', true);
    result.deletedRoutes++;
  }
  if (await branchExists()) return skip();
  const currentWorker = await cf(workerPath, 'GET', true);
  checkWorker(currentWorker);
  if (worker && currentWorker && worker.id !== currentWorker.id) throw new Error('Worker changed during cleanup; refusing deletion.');
  if (checkRoutes(await cf(routesPath)).length > 0) throw new Error('Worker still has routes; refusing deletion.');
  if (currentWorker !== null) {
    // Never force removal of references owned by other resources.
    await cf(`/accounts/${accountId}/workers/workers/${currentWorker.id}?force=false`, 'DELETE', true);
    result.deletedWorker = true;
  }
  if (await cf(workerPath, 'GET', true) !== null || checkRoutes(await cf(routesPath)).length > 0) {
    throw new Error('Cleanup verification failed; inspect resources and retry.');
  }
  return { ...result, status: 'deleted' };
}
