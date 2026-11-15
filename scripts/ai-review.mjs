import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { githubClient, publishReview, renderReport, reviewOptions, runReview, safeError } from './lib/ai-review.mjs';

const directory = 'artifacts/ai-review';
let options;
try {
  options = reviewOptions(process.env);
  const github = githubClient(options);
  if (process.argv[2] === 'review') {
    const prompt = await readFile('.github/ai-review/prompt.md', 'utf8');
    const schema = JSON.parse(await readFile('.github/ai-review/schema.json', 'utf8'));
    const report = await runReview(options, { github, prompt, schema });
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/review.json`, `${JSON.stringify(report, null, 2)}\n`);
    const markdown = renderReport(report);
    await writeFile(`${directory}/review.md`, `${markdown}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
    console.log(`AI review: ${report.status}`);
    if (report.status === 'failed') { console.error(report.error); process.exitCode = 1; }
  } else if (process.argv[2] === 'publish') {
    const report = JSON.parse(await readFile(`${directory}/review.json`, 'utf8'));
    const result = await publishReview(report, options, github);
    console.log(`AI review publication: ${result.status}`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `AI review publication: **${result.status}**\n`);
  } else throw new Error('Usage: node scripts/ai-review.mjs review|publish');
} catch (error) {
  console.error(safeError(error, options ?? {}));
  process.exitCode = 1;
}
