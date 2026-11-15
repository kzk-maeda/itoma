import { appendFileSync } from 'node:fs';
import { reconcileDemos } from './lib/demo-reconcile.mjs';

const result = await reconcileDemos({
  repository: process.env.GITHUB_REPOSITORY,
  defaultBranch: process.env.DEMO_DEFAULT_BRANCH,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  githubToken: process.env.GH_TOKEN,
  cloudflareToken: process.env.CLOUDFLARE_API_TOKEN,
  apply: process.env.DEMO_CLEANUP_APPLY === 'true',
});
console.log(JSON.stringify(result, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Demo reconciliation: ${result.status}\n\nApply: ${result.apply}\n\nInspected branch demos: ${result.inspected}\n\nRetained: ${result.retained}\n\n` + result.results.map(item => `- \`${item.target.workerName}\`: ${item.status}; routes deleted=${item.deletedRoutes ?? 0}, Worker deleted=${item.deletedWorker ?? false}\n`).join(''));
}
if (result.status === 'failed') process.exitCode = 1;
