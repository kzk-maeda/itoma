import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { demoTarget } from './lib/demo-target.mjs';
import { demoRepo } from './lib/demo-repo.mjs';

const { sha, branch, dirty: changes } = demoRepo();
const dirty = changes.length > 0;
const target = demoTarget(branch);
// An isolated demo owns its router/config; it imports product code in one direction.
// Keep the legacy root export for branches that have not introduced this entry yet.
const project = existsSync(new URL('../demo/app/package.json', import.meta.url)) ? 'demo/app' : '.';
// Only clear this generated export, so switching branches cannot package old files.
rmSync(new URL('../dist/demo/', import.meta.url), { recursive: true, force: true });
rmSync(new URL('../dist/demo-export/', import.meta.url), { recursive: true, force: true });

execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/expo/bin/cli', import.meta.url)), 'export', '--platform', 'web', '--output-dir', fileURLToPath(new URL('../dist/demo-export/', import.meta.url))], {
  cwd: new URL(project + '/', new URL('../', import.meta.url)),
  env: { ...process.env, ITOMA_DEMO_BUILD: '1', ITOMA_DEMO_BASE_PATH: target.basePath },
  stdio: 'inherit',
});

mkdirSync(new URL('../dist/demo/', import.meta.url), { recursive: true });
const mounted = new URL(`../dist/demo${target.basePath}/`, import.meta.url);
mkdirSync(mounted, { recursive: true });
cpSync(new URL('../dist/demo-export/', import.meta.url), mounted, { recursive: true });
const manifest = JSON.stringify({
  kind: 'web-demo',
  ...target,
  commit: sha,
  dirty,
  builtAt: new Date().toISOString(),
  osFeatures: 'mock-only',
}, null, 2) + '\n';
writeFileSync(new URL('demo-build.json', mounted), manifest);
writeFileSync(new URL('../dist/demo-meta.json', import.meta.url), manifest);
writeFileSync(new URL('../dist/demo/_headers', import.meta.url), `/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n${target.basePath}/demo-build.json\n  Cache-Control: no-store\n`);
console.log(`Demo exported: ${sha}${dirty ? ' (working tree has uncommitted changes)' : ''}\n${target.url}`);
