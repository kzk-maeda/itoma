import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { HEAD, WORKFLOW } from './fixtures/ai-review-harness.mjs';

test('real CLI prepares, executes and publishes with immutable request/evidence files and one mocked Decisions call', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'itoma-ai-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, '.github'), { recursive: true });
  await cp(new URL('../.github/ai-review', import.meta.url), join(directory, '.github/ai-review'), { recursive: true });
  const eventPath = join(directory, 'event.json');
  await writeFile(eventPath, JSON.stringify({ action: 'opened' }));
  const statePath = join(directory, 'github.json');
  const bootstrap = join(directory, 'bootstrap.mjs');
  await writeFile(bootstrap, `
    import { readFileSync, writeFileSync, existsSync } from 'node:fs';
    import { harness } from ${JSON.stringify(new URL('./fixtures/ai-review-harness.mjs', import.meta.url).href)};
    const h = harness();
    const path = process.env.TEST_GITHUB_STATE;
    const prior = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { decisions: 0, responses: 0 };
    for (const key of ['pr', 'bot', 'comments']) if (key in prior) h.state[key] = prior[key];
    globalThis.fetch = h.fetchImpl;
    process.on('exit', () => writeFileSync(path, JSON.stringify({ pr: h.state.pr, bot: h.state.bot, comments: h.state.comments, decisions: prior.decisions + h.apiCalls('/decisions').length, responses: prior.responses + h.apiCalls('/responses').length })));
  `);
  const env = {
    PATH: process.env.PATH, GITHUB_REPOSITORY: 'owner/itoma', GH_TOKEN: 'github-fixture-secret',
    OPENAI_API_KEY: 'openai-fixture-secret', OPENAI_REVIEW_MODEL: 'gpt-5.6-sol',
    GITHUB_RUN_ID: '100', GITHUB_RUN_ATTEMPT: '1', GITHUB_ACTOR: 'owner', GITHUB_WORKFLOW_SHA: WORKFLOW,
    GITHUB_EVENT_NAME: 'pull_request_target', GITHUB_EVENT_PATH: eventPath,
    AI_REVIEW_PR_NUMBER: '42', AI_REVIEW_EXPECTED_SHA: HEAD,
    GITHUB_OUTPUT: join(directory, 'outputs'), GITHUB_STEP_SUMMARY: join(directory, 'summary.md'), TEST_GITHUB_STATE: statePath,
  };
  const cli = fileURLToPath(new URL('../scripts/ai-review.mjs', import.meta.url));
  for (const command of ['prepare', 'execute', 'publish']) {
    const result = spawnSync(process.execPath, ['--import', bootstrap, cli, command], { cwd: directory, env, encoding: 'utf8' });
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
  }
  assert.match(await readFile(env.GITHUB_OUTPUT, 'utf8'), /run=true/);
  const report = JSON.parse(await readFile(join(directory, 'artifacts/ai-review/review.json'), 'utf8'));
  assert.equal(report.version, 2); assert.equal(report.status, 'skipped_low');
  assert.match(await readFile(join(directory, 'artifacts/ai-review/review.md'), 'utf8'), /本レビューは実行していません/);
  const saved = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(saved.decisions, 1); assert.equal(saved.responses, 0);
  assert.match(saved.bot.body, /本レビューは実行していません/);
});
