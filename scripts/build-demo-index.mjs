import { mkdirSync, writeFileSync } from 'node:fs';
import { collectEnvironments, renderIndex } from './lib/demo-index.mjs';
const environments = await collectEnvironments({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, cloudflareToken: process.env.CLOUDFLARE_API_TOKEN, githubToken: process.env.GH_TOKEN, repository: process.env.GITHUB_REPOSITORY || 'kzk-maeda/itoma' });
const checkedAt = new Date().toISOString();
mkdirSync('dist/demo-index', { recursive: true });
writeFileSync('dist/demo-index/index.html', renderIndex(environments, checkedAt));
writeFileSync('dist/demo-index/_headers', '/*\n  Cache-Control: no-store\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n');
console.log(`Generated demo index: ${environments.length} environments at ${checkedAt}`);
