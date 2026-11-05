import { appendFileSync } from 'node:fs';
import { cleanupDemo } from './lib/demo-cleanup.mjs';

const result = await cleanupDemo({
  branch: process.env.DEMO_BRANCH,
  defaultBranch: process.env.DEMO_DEFAULT_BRANCH,
  repository: process.env.GITHUB_REPOSITORY,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  githubToken: process.env.GH_TOKEN,
  cloudflareToken: process.env.CLOUDFLARE_API_TOKEN,
  apply: process.env.DEMO_CLEANUP_APPLY === 'true',
});
console.log(JSON.stringify(result, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Branch demo cleanup: ${result.status}\n\nWorker: \`${result.target.workerName}\`\n\nURL: ${result.target.url}\n\nDeleted routes: ${result.deletedRoutes}\n\nDeleted Worker: ${result.deletedWorker}\n\n${result.reason ?? ''}\n`);
}
