import { demoTarget } from './demo-target.mjs';

/** Exhaust both APIs; partial inventories must never authorize deletion. */
async function pages(url, token, cloudflare, fetchImpl) {
  const result = [];
  for (let page = 1; page <= 1000; page++) {
    const response = await fetchImpl(`${url}?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Demo inventory ${cloudflare ? 'Cloudflare' : 'GitHub'} failed: HTTP ${response.status}`);
    const body = await response.json();
    const rows = cloudflare ? body.result : body;
    if (!Array.isArray(rows) || (cloudflare && body.success !== true)) throw new Error('Invalid demo inventory response.');
    result.push(...rows);
    const total = cloudflare ? body.result_info?.total_pages : undefined;
    if (total !== undefined) {
      if (!Number.isInteger(total) || total < 0 || (total === 0 && rows.length > 0) || (page < total && rows.length === 0)) throw new Error('Invalid demo inventory pagination.');
      if (page >= total) return result;
    } else if (rows.length < 100) return result;
  }
  throw new Error('Demo inventory pagination limit reached.');
}

export async function liveDemoWorkers({ repository, githubToken, defaultBranch, fetchImpl = fetch }) {
  const branches = await pages(`https://api.github.com/repos/${repository}/branches`, githubToken, false, fetchImpl);
  if (!branches.some(branch => branch.name === defaultBranch)) throw new Error('Default branch missing from inventory; refusing cleanup.');
  const names = branches.map(branch => demoTarget(branch.name).workerName);
  if (new Set(names).size !== names.length) throw new Error('Duplicate branch identity in inventory.');
  return new Set(names);
}

export async function deployedWorkers({ accountId, cloudflareToken, fetchImpl = fetch }) {
  const workers = await pages(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/workers`, cloudflareToken, true, fetchImpl);
  const names = new Set();
  for (const worker of workers) {
    if (typeof worker.name !== 'string' || !/^[a-f0-9]{32}$/.test(worker.id ?? '') || names.has(worker.name)) throw new Error('Invalid Worker inventory identity.');
    names.add(worker.name);
  }
  return workers;
}
