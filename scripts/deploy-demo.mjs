import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
const manifest = JSON.parse(readFileSync(new URL('../dist/demo/demo-build.json', import.meta.url), 'utf8'));
const packaged = JSON.parse(readFileSync(new URL('../.cloudflare/output/v0/workers/default/assets/demo-build.json', import.meta.url), 'utf8'));

if (dirty || manifest.dirty || manifest.commit !== sha || JSON.stringify(manifest) !== JSON.stringify(packaged)) {
  throw new Error('Commit changes, then run npm run demo:package before deploying this exact commit.');
}

execFileSync(process.execPath, ['node_modules/cf/bin/cf', 'deploy', '--prebuilt'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});
