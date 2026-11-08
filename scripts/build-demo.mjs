import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { demoTarget } from './lib/demo-target.mjs';
import { demoRepo } from './lib/demo-repo.mjs';
import { installDemoEntry } from './lib/demo-entry.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { sha, branch, dirty: changes } = demoRepo();
const dirty = changes.length > 0;
const target = demoTarget(branch);
// Only clear this generated export, so switching branches cannot package old files.
rmSync(new URL('../dist/demo/', import.meta.url), { recursive: true, force: true });
rmSync(new URL('../dist/demo-export/', import.meta.url), { recursive: true, force: true });

execFileSync(process.execPath, ['node_modules/expo/bin/cli', 'export', '--platform', 'web', '--output-dir', 'dist/demo-export'], {
  cwd: root,
  env: { ...process.env, ITOMA_DEMO_BUILD: '1', ITOMA_DEMO_BASE_PATH: target.basePath },
  stdio: 'inherit',
});

mkdirSync(new URL('../dist/demo/', import.meta.url), { recursive: true });
const mounted = new URL(`../dist/demo${target.basePath}/`, import.meta.url);
mkdirSync(mounted, { recursive: true });
cpSync(new URL('../dist/demo-export/', import.meta.url), mounted, { recursive: true });
const entryPage = installDemoEntry(fileURLToPath(mounted));
const manifest = JSON.stringify({
  kind: 'web-demo',
  entryPage,
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
