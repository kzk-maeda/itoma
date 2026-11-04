import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
  cwd: root,
  encoding: 'utf8',
}).trim().length > 0;

execFileSync(process.execPath, ['node_modules/expo/bin/cli', 'export', '--platform', 'web', '--output-dir', 'dist/demo'], {
  cwd: root,
  env: { ...process.env, ITOMA_DEMO_BUILD: '1' },
  stdio: 'inherit',
});

mkdirSync(new URL('../dist/demo/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/demo/demo-build.json', import.meta.url), JSON.stringify({
  kind: 'web-demo',
  commit: sha,
  dirty,
  builtAt: new Date().toISOString(),
  osFeatures: 'mock-only',
}, null, 2) + '\n');
writeFileSync(new URL('../dist/demo/_headers', import.meta.url), '/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n/demo-build.json\n  Cache-Control: no-store\n');
console.log(`Demo exported: ${sha}${dirty ? ' (working tree has uncommitted changes)' : ''}`);
