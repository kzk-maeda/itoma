import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { githubClient, reviewOptions, safeError } from './lib/ai-review.mjs';
import { prepareRequest, receiveCommand, requestOptions } from './lib/ai-review-requests.mjs';
import { executeRequest, publishPipeline, renderPipelineReport } from './lib/ai-review-pipeline.mjs';

const directory = 'artifacts/ai-review';
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const save = async (name, value) => { await mkdir(directory, { recursive: true }); await writeFile(`${directory}/${name}`, `${JSON.stringify(value, null, 2)}\n`); };
const output = async text => { if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${text}\n`); };
const summary = async text => { if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${text}\n`); };
let options;
try {
  options = requestOptions(process.env, reviewOptions(process.env));
  const github = githubClient(options);
  switch (process.argv[2]) {
    case 'command': {
      const result = await receiveCommand(await json(process.env.GITHUB_EVENT_PATH), options, github);
      console.log(`AI review command: ${result.status}`);
      await summary(`AI review command: **${result.status}**`);
      break;
    }
    case 'prepare': {
      const result = await prepareRequest(await json(process.env.GITHUB_EVENT_PATH), options, github);
      if (result.run) await save('request.json', result.request);
      await output(`run=${result.run}`);
      console.log(`AI review request: ${result.run ? 'claimed' : 'skipped'}`);
      await summary(`AI review request: **${result.run ? 'claimed' : 'skipped'}**`);
      break;
    }
    case 'execute': {
      const policy = await json('.github/ai-review/triage-policy.json');
      const prompt = await readFile('.github/ai-review/prompt.md', 'utf8');
      const schema = await json('.github/ai-review/schema.json');
      const report = await executeRequest(await json(`${directory}/request.json`), options, { github, policy, prompt, schema });
      await save('review.json', report);
      const markdown = renderPipelineReport(report);
      await writeFile(`${directory}/review.md`, `${markdown}\n`);
      await summary(markdown);
      console.log(`AI review: ${report.status}`);
      if (['triage_failed', 'review_failed', 'manual_required'].includes(report.status)) process.exitCode = 1;
      break;
    }
    case 'publish': {
      const result = await publishPipeline(await json(`${directory}/review.json`), options, github);
      console.log(`AI review publication: ${result.status}`);
      await summary(`AI review publication: **${result.status}**`);
      break;
    }
    default: throw new Error('Usage: node scripts/ai-review.mjs command|prepare|execute|publish');
  }
} catch (error) {
  console.error(safeError(error, options ?? {}));
  process.exitCode = 1;
}
