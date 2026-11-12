import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const output = process.env.DEVICEFARM_LOG_DIR;
if (!output) throw new Error('DEVICEFARM_LOG_DIR is required');
mkdirSync(output, { recursive: true });
const report = join(output, 'junit.xml');
const result = spawnSync(process.execPath, [
  '--test', '--test-concurrency=1', '--test-reporter=spec', '--test-reporter=junit',
  '--test-reporter-destination=stdout', `--test-reporter-destination=${report}`,
  'tests/smoke.test.mjs',
], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
// An empty, filtered or partially skipped suite must never produce a green Device Farm run.
const xml = readFileSync(report, 'utf8');
if ((xml.match(/<testcase\s/g) ?? []).length !== 4 || /<skipped\b|<failure\b|<error\b/.test(xml)) {
  throw new Error('Expected four executed, passing E2E scenarios');
}
