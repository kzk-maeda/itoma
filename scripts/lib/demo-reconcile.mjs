import { cleanupDemo } from './demo-cleanup.mjs';
import { deployedWorkers, liveDemoWorkers } from './demo-inventory.mjs';
import { demoTarget, demoTargetFromWorker, DEMO_ZONE } from './demo-target.mjs';

/** Recover missed delete events without guessing a deleted branch's original name. */
export async function reconcileDemos(options) {
  const { accountId, repository, defaultBranch, githubToken, cloudflareToken, fetchImpl = fetch } = options;
  if (!defaultBranch || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^[a-f0-9]{32}$/.test(accountId ?? '') || !githubToken || !cloudflareToken) throw new Error('Demo reconciliation credentials/default branch are required.');
  const live = await liveDemoWorkers(options);
  const workers = await deployedWorkers(options);
  async function cf(path) {
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4${path}`, {
      headers: { Authorization: `Bearer ${cloudflareToken}` }, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Cloudflare reconciliation failed: HTTP ${response.status}`);
    const body = await response.json();
    if (body.success !== true) throw new Error('Invalid Cloudflare reconciliation response.');
    return body.result;
  }
  const zones = await cf(`/zones?name=${DEMO_ZONE}&account.id=${accountId}`);
  if (!Array.isArray(zones) || zones.length !== 1 || zones[0].name !== DEMO_ZONE || zones[0].account?.id !== accountId || !/^[a-f0-9]{32}$/.test(zones[0].id)) throw new Error('Expected exactly the demo zone in the configured account.');
  const routes = await cf(`/zones/${zones[0].id}/workers/routes`);
  if (!Array.isArray(routes)) throw new Error('Invalid demo routes.');
  // Include route-only leftovers as well as Workers left after partial cleanup.
  const names = new Set([...workers.map(worker => worker.name), ...routes.map(route => route.script)]
    .filter(name => demoTargetFromWorker(name)));
  const protectedNames = new Set([demoTarget('main').workerName, demoTarget(defaultBranch).workerName]);
  const results = [];
  let retained = 0;
  for (const workerName of [...names].sort()) {
    if (live.has(workerName) || protectedNames.has(workerName)) { retained++; continue; }
    try {
      // Fresh branch inventory before Cloudflare inspection AND every mutation.
      results.push(await cleanupDemo({ ...options, branch: undefined, workerName }));
    } catch (error) {
      results.push({ target: { workerName }, status: 'failed', reason: error.message });
    }
  }
  return { status: results.some(result => result.status === 'failed') ? 'failed' : 'complete', apply: options.apply === true, inspected: names.size, retained, results };
}
