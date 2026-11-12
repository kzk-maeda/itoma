import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const output = process.env.DEVICEFARM_LOG_DIR;
if (!output) throw new Error('DEVICEFARM_LOG_DIR is required');
mkdirSync(output, { recursive: true });
const report = join(output, 'junit.xml');
const scenarios = JSON.parse(readFileSync(new URL('./scenarios.json', import.meta.url), 'utf8'));
const expectedIds = new Set(scenarios.map(scenario => scenario.id));
if (!expectedIds.size || expectedIds.size !== scenarios.length) throw new Error('Scenario IDs must be nonempty and unique');
const result = spawnSync(process.execPath, [
  '--test', '--test-concurrency=1', '--test-reporter=spec', '--test-reporter=junit',
  '--test-reporter-destination=stdout', `--test-reporter-destination=${report}`,
  'tests/smoke.test.mjs',
], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
// An empty, filtered or partially skipped suite must never produce a green Device Farm run.
const xml = readFileSync(report, 'utf8');
const reportedIds = [...xml.matchAll(/<testcase\b[^>]*\bname="(DF[0-9]+):[^"]*"/g)].map(match => match[1]);
if ((xml.match(/<testcase\s/g) ?? []).length !== expectedIds.size ||
    reportedIds.length !== expectedIds.size || new Set(reportedIds).size !== expectedIds.size ||
    reportedIds.some(id => !expectedIds.has(id)) || /<skipped\b|<failure\b|<error\b/.test(xml)) {
  throw new Error('Expected all registered E2E scenarios to execute and pass');
}
