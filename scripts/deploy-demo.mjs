import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertDemoDeployment, demoTarget } from './lib/demo-target.mjs';
import { demoRepo } from './lib/demo-repo.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const repo = demoRepo();
const expected = demoTarget(repo.branch);
const manifest = JSON.parse(readFileSync(new URL('../dist/demo-meta.json', import.meta.url), 'utf8'));
const packaged = JSON.parse(readFileSync(new URL(`../.cloudflare/output/v0/workers/default/assets${expected.basePath}/demo-build.json`, import.meta.url), 'utf8'));

const config = JSON.parse(readFileSync(new URL('../.cloudflare/output/v0/workers/default/worker.config.json', import.meta.url), 'utf8'));
const target = assertDemoDeployment({ ...repo, manifest, packaged, config });
console.log(`Deploying ${target.branch}: ${target.url}`);

execFileSync(process.execPath, ['node_modules/cf/bin/cf', 'deploy', '--prebuilt'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});
