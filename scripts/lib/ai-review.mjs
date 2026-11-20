import { posix } from 'node:path';

const API = 'https://api.github.com';
export const COMMENT_MARKER = '<!-- itoma-ai-review -->';
export const MAX_INPUT_BYTES = 160_000;
export const MAX_OUTPUT_TOKENS = 8_000;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function reviewOptions(env) {
  requireValue(/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? ''), 'Invalid repository');
  requireValue(/^[1-9]\d*$/.test(env.AI_REVIEW_PR_NUMBER ?? ''), 'Invalid PR number');
  requireValue(Number.isSafeInteger(Number(env.AI_REVIEW_PR_NUMBER)), 'Invalid PR number');
  requireValue(env.GH_TOKEN, 'GH_TOKEN is not configured');
  const expectedSha = env.AI_REVIEW_EXPECTED_SHA || null;
  requireValue(!expectedSha || /^[a-f0-9]{40}$/.test(expectedSha), 'Invalid expected SHA');
  return {
    repository: env.GITHUB_REPOSITORY,
    number: Number(env.AI_REVIEW_PR_NUMBER),
    defaultBranch: env.AI_REVIEW_DEFAULT_BRANCH || 'main',
    expectedSha,
    requireLabel: env.AI_REVIEW_REQUIRE_LABEL !== 'false',
    githubToken: env.GH_TOKEN,
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_REVIEW_MODEL || 'gpt-5.4',
    runUrl: /^\d+$/.test(env.GITHUB_RUN_ID ?? '')
      ? `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null,
  };
}

export function githubClient({ repository, githubToken, fetchImpl = fetch }) {
  return async (path, { method = 'GET', body, optional = false } = {}) => {
    let response;
    try {
      response = await fetchImpl(`${API}/repos/${repository}${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error('GitHub request failed or timed out');
    }
    if (optional && response.status === 404) return null;
    requireValue(response.ok, `GitHub HTTP ${response.status}`);
    if (response.status === 204) return null;
    try { return await response.json(); }
    catch { throw new Error('GitHub returned invalid JSON'); }
  };
}

export function ineligibleReason(pr, options) {
  if (pr.state !== 'open' || pr.draft) return 'PR is closed or draft';
  if (pr.head?.repo?.full_name !== options.repository || pr.base?.repo?.full_name !== options.repository) return 'Fork PRs are not supported';
  if (pr.base.ref !== options.defaultBranch) return 'PR must target the default branch';
  if (options.requireLabel && !pr.labels?.some(label => label.name === 'ai-review')) return 'ai-review label is not present';
  if (options.expectedSha && pr.head.sha !== options.expectedSha) return 'Event SHA is stale';
  requireValue(/^[a-f0-9]{40}$/.test(pr.head.sha) && /^[a-f0-9]{40}$/.test(pr.base.sha), 'Invalid PR revision');
  return null;
}

const pathUrl = path => path.split('/').map(encodeURIComponent).join('/');
function validPath(path) {
  return typeof path === 'string' && path.length > 0 && !/[\x00-\x1f\x7f]/.test(path) &&
    !path.startsWith('/') && !path.split('/').some(part => part === '..' || part === '.');
}

export function diffRanges(patch) {
  return [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map(match => ({
    LEFT: [Number(match[1]), Number(match[2] ?? 1)],
    RIGHT: [Number(match[3]), Number(match[4] ?? 1)],
  }));
}

// Entire sections are omitted when over budget; never silently cut a diff in half.
export async function collectInput(pr, github) {
  requireValue(pr.changed_files > 0 && pr.changed_files <= 100, 'Review supports PRs with 1–100 changed files; split this PR');
  const files = await github(`/pulls/${pr.number}/files?per_page=100`);
  requireValue(files.length === pr.changed_files, 'Changed-file list is incomplete or PR changed during collection');
  const comparison = await github(`/compare/${pr.base.sha}...${pr.head.sha}`);
  const diffBaseSha = comparison.merge_base_commit?.sha;
  requireValue(/^[a-f0-9]{40}$/.test(diffBaseSha ?? ''), 'Invalid diff merge base');
  const input = {
    pr: { number: pr.number, title: pr.title.slice(0, 500), body: (pr.body || '').slice(0, 6000), base_sha: pr.base.sha, diff_base_sha: diffBaseSha, head_sha: pr.head.sha },
    checks: [], documents: [], patches: [], source: [], omissions: [],
  };
  let remaining = 140_000;
  function add(section, value, omission) {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > remaining) { input.omissions.push(omission); return false; }
    remaining -= bytes;
    input[section].push(value);
    return true;
  }
  if ((pr.body || '').length > 6000) input.omissions.push('PR body truncated to 6000 characters');
  const checks = await github(`/commits/${pr.head.sha}/check-runs?per_page=100`);
  input.checks = checks.check_runs.map(check => ({ name: check.name, status: check.status, conclusion: check.conclusion }));
  if (checks.total_count > 100) input.omissions.push('Only the first 100 check runs were supplied');

  async function readFile(path, ref, limit) {
    const file = await github(`/contents/${pathUrl(path)}?ref=${ref}`, { optional: true });
    if (!file) return null;
    if (file.type !== 'file' || file.encoding !== 'base64' || file.size > limit) {
      input.omissions.push(`${path}@${ref}: source unavailable or exceeds ${limit} bytes`);
      return null;
    }
    const content = Buffer.from(file.content, 'base64').toString('utf8');
    if (content.includes('\u0000')) { input.omissions.push(`${path}: binary source omitted`); return null; }
    return content;
  }

  const documents = new Set(['AGENTS.md', 'docs/system/README.md']);
  if (files.some(file => /^(src|demo)\//.test(file.filename))) {
    documents.add('DESIGN.md'); documents.add('docs/ui-acceptance.md');
  }
  if (files.some(file => /^(packages|modules|plugins)\//.test(file.filename))) {
    documents.add('docs/system/architecture.md'); documents.add('docs/system/data.md');
  }
  // Include applicable nested agent instructions from the trusted base, with a bound.
  const nested = new Set();
  for (const file of files) {
    requireValue(validPath(file.filename), 'Invalid changed-file path');
    const parts = file.filename.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) nested.add(`${parts.slice(0, i).join('/')}/AGENTS.md`);
  }
  for (const path of [...nested].slice(0, 20)) documents.add(path);
  if (nested.size > 20) input.omissions.push('Nested AGENTS.md lookup limited to 20 paths');
  for (const path of documents) {
    const content = await readFile(path, pr.base.sha, 30_000);
    if (content !== null) add('documents', { path, revision: 'base', content }, `${path}: context budget exceeded`);
  }

  const reviewedFiles = [];
  for (const file of files) {
    if (!file.patch || !diffRanges(file.patch).length) { input.omissions.push(`${file.filename}: diff unavailable (binary, oversized, or no textual changes)`); continue; }
    const value = { path: file.filename, previous_path: file.previous_filename ?? null, status: file.status, patch: file.patch };
    const additions = file.patch.split('\n').filter(line => line.startsWith('+')).length;
    const deletions = file.patch.split('\n').filter(line => line.startsWith('-')).length;
    if (additions !== file.additions || deletions !== file.deletions) input.omissions.push(`${file.filename}: GitHub diff may be truncated`);
    if (add('patches', value, `${file.filename}: diff exceeds remaining input budget`)) reviewedFiles.push(value);
  }
  requireValue(reviewedFiles.length > 0, 'No textual diffs fit the review input budget');
  // Full changed files provide surrounding code; imports are never executed.
  for (const file of reviewedFiles) {
    if (remaining < 1000) { input.omissions.push(`${file.path}: surrounding source omitted (budget)`); continue; }
    const revision = file.status === 'removed' ? 'base' : 'head';
    const ref = revision === 'base' ? diffBaseSha : pr.head.sha;
    const content = await readFile(file.path, ref, Math.min(20_000, remaining));
    if (content !== null) add('source', { path: file.path, revision, content }, `${file.path}: surrounding source exceeds input budget`);
  }
  // CI/dependency changes need the manifests and build definitions they operate on.
  // These are immutable API data; package managers and PR configuration are never run.
  if (files.some(file => /^(\.github\/(workflows\/|docker\/|dependabot\.ya?ml$)|package(-lock)?\.json$)/.test(file.filename))) {
    for (const path of ['package.json', '.github/workflows/ci.yml', '.github/docker/swift-tests.Dockerfile']) {
      if (input.source.some(source => source.path === path && source.revision === 'head')) continue;
      if (remaining < 1000) { input.omissions.push(`${path}: related configuration omitted (budget)`); continue; }
      const content = await readFile(path, pr.head.sha, Math.min(20_000, remaining));
      if (content !== null) add('source', { path, revision: 'head', related_config: true, content }, `${path}: related configuration exceeds input budget`);
      else input.omissions.push(`${path}: related configuration could not be supplied`);
    }
    if (!input.source.some(source => source.path === 'package-lock.json') && remaining >= 1000) {
      const content = await readFile('package-lock.json', pr.head.sha, 1_000_000);
      if (content !== null) {
        try {
          const lock = JSON.parse(content);
          const root = lock.packages?.[''];
          requireValue(root && lock.lockfileVersion >= 2, 'Unsupported lockfile summary');
          const dependencies = { ...root.dependencies, ...root.devDependencies, ...root.optionalDependencies };
          const resolved = Object.fromEntries(Object.keys(dependencies).map(name => [name, lock.packages[`node_modules/${name}`]?.version ?? null]));
          add('source', { path: 'package-lock.json', revision: 'head', related_config: true, summary: true,
            content: JSON.stringify({ lockfileVersion: lock.lockfileVersion, declared_dependencies: dependencies, resolved_direct_versions: resolved }) }, 'package-lock.json: direct dependency summary exceeds input budget');
        } catch { input.omissions.push('package-lock.json: direct dependency summary could not be supplied'); }
      } else input.omissions.push('package-lock.json: related configuration could not be supplied');
    }
  }
  // Read a bounded set of direct local imports as context, without loading modules.
  const imports = new Set();
  for (const source of input.source) {
    if (source.revision !== 'head' || source.related_config) continue;
    for (const match of source.content.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      const target = specifier.startsWith('@/') ? `src/${specifier.slice(2)}`
        : specifier.startsWith('.') ? posix.normalize(posix.join(posix.dirname(source.path), specifier)) : null;
      if (target && validPath(target)) imports.add(target);
    }
  }
  if (imports.size > 6) input.omissions.push('Direct local import lookup limited to 6 specifiers');
  const seen = new Set(input.source.map(source => source.path));
  for (const target of [...imports].slice(0, 6)) {
    if (remaining < 1000) { input.omissions.push(`${target}: related import omitted (budget)`); continue; }
    const candidates = posix.extname(target) ? [target] : ['.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx'].map(suffix => target + suffix);
    let found = false;
    for (const path of candidates) {
      if (seen.has(path)) { found = true; break; }
      const content = await readFile(path, pr.head.sha, Math.min(20_000, remaining));
      if (content === null) continue;
      add('source', { path, revision: 'head', related_import: true, content }, `${path}: related import exceeds input budget`);
      seen.add(path); found = true; break;
    }
    if (!found) input.omissions.push(`${target}: direct local import could not be supplied`);
  }
  requireValue(Buffer.byteLength(JSON.stringify(input)) <= MAX_INPUT_BYTES, 'Review input exceeds hard byte limit');
  return { input, reviewedFiles };
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
const boundedText = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;

export function validateReview(review, files) {
  requireValue(exactKeys(review, ['summary', 'findings', 'limitations']) && boundedText(review.summary, 2000), 'Invalid review summary');
  requireValue(Array.isArray(review.findings) && review.findings.length <= 10, 'Invalid review findings');
  requireValue(Array.isArray(review.limitations) && review.limitations.length <= 10 && review.limitations.every(x => boundedText(x, 1000)), 'Invalid review limitations');
  for (const finding of review.findings) {
    requireValue(exactKeys(finding, ['priority', 'title', 'body', 'path', 'side', 'line']), 'Invalid finding fields');
    requireValue(['P0', 'P1', 'P2', 'P3'].includes(finding.priority) && boundedText(finding.title, 200) && boundedText(finding.body, 2000), 'Invalid finding text');
    const file = files.find(file => file.path === finding.path);
    requireValue(file && ['LEFT', 'RIGHT'].includes(finding.side) && Number.isSafeInteger(finding.line) && finding.line > 0, 'Invalid finding location');
    requireValue(diffRanges(file.patch).some(range => {
      const [start, count] = range[finding.side];
      return count > 0 && finding.line >= start && finding.line < start + count;
    }), 'Finding line is outside the supplied diff');
  }
  return review;
}

export async function callOpenAI({ apiKey, model, prompt, schema, input, files, fetchImpl = fetch }) {
  requireValue(apiKey, 'OPENAI_API_KEY is not configured');
  let response;
  try {
    // One request only: no automatic retries, tools, subprocesses, or model-selected URLs.
    response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(240_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, store: false, max_output_tokens: MAX_OUTPUT_TOKENS,
        reasoning: { effort: 'low' },
        instructions: prompt, input: JSON.stringify(input),
        text: { format: { type: 'json_schema', name: 'itoma_code_review', strict: true, schema } },
      }),
    });
  } catch { throw new Error('OpenAI request failed or timed out; no automatic retry'); }
  requireValue(response.ok, `OpenAI HTTP ${response.status}; no automatic retry`);
  let result;
  try { result = await response.json(); }
  catch { throw new Error('OpenAI returned invalid response JSON'); }
  requireValue(result.status === 'completed', 'OpenAI response incomplete or failed');
  const content = result.output?.filter(item => item.type === 'message').flatMap(item => item.content ?? []) ?? [];
  requireValue(!content.some(item => item.type === 'refusal'), 'OpenAI refused the review');
  let review;
  try { review = JSON.parse(content.filter(item => item.type === 'output_text').map(item => item.text).join('')); }
  catch { throw new Error('OpenAI returned invalid JSON'); }
  return { review: validateReview(review, files), responseId: result.id, usage: result.usage ?? null };
}

export async function runReview(options, { github, prompt, schema, fetchImpl, beforeApi }) {
  const report = { version: 1, status: 'failed', repository: options.repository, number: options.number, run_url: options.runUrl, model: options.model };
  try {
    const pr = await github(`/pulls/${options.number}`);
    report.base_sha = pr.base.sha; report.head_sha = pr.head.sha;
    const reason = ineligibleReason(pr, options);
    if (reason) return { ...report, status: 'skipped', reason };
    requireValue(options.apiKey, 'OPENAI_API_KEY is not configured');
    const { input, reviewedFiles } = await collectInput(pr, github);
    report.files = reviewedFiles.map(({ path, previous_path, status }) => ({ path, previous_path, status }));
    report.omissions = input.omissions;
    report.checks = input.checks;
    report.diff_base_sha = input.pr.diff_base_sha;
    report.input_bytes = Buffer.byteLength(JSON.stringify(input));
    const current = await github(`/pulls/${options.number}`);
    if (current.head.sha !== pr.head.sha || current.base.sha !== pr.base.sha || ineligibleReason(current, options)) {
      return { ...report, status: 'skipped', reason: 'PR changed before the API call' };
    }
    if (beforeApi) await beforeApi();
    const result = await callOpenAI({ ...options, prompt, schema, input, files: reviewedFiles, fetchImpl });
    return { ...report, status: 'completed', review: result.review, response_id: result.responseId, usage: result.usage };
  } catch (error) {
    if (error.name === 'StaleRequestError') return { ...report, status: 'skipped', reason: safeError(error, options) };
    // Only our bounded diagnostic messages are persisted; never dump HTTP bodies/inputs.
    return { ...report, error: safeError(error, options) };
  }
}

export function safeError(error, options) {
  let message = String(error.message || 'Review failed');
  for (const secret of [options.githubToken, options.apiKey]) if (secret) message = message.replaceAll(secret, '[redacted]');
  return message.slice(0, 500);
}

const markdown = value => String(value).replaceAll('@', '@\u200b').replace(/[\\`*_{}[\]()<>!|#]/g, '\\$&');
export { markdown };

export function renderFindings(report, { includeSide = false } = {}) {
  const lines = [];
  const priorities = ['P0', 'P1', 'P2', 'P3'];
  for (const finding of report.review.findings.toSorted((a, b) => priorities.indexOf(a.priority) - priorities.indexOf(b.priority))) {
    const file = report.files.find(file => file.path === finding.path);
    const sha = finding.side === 'LEFT' ? report.diff_base_sha : report.head_sha;
    const path = finding.side === 'LEFT' ? file.previous_path || finding.path : finding.path;
    const url = `https://github.com/${report.repository}/blob/${sha}/${pathUrl(path)}#L${finding.line}`;
    lines.push(`### ${finding.priority}: ${markdown(finding.title)}`, '', `[${markdown(finding.path)}:${finding.line}${includeSide ? ` (${finding.side})` : ''}](${url})`, '', markdown(finding.body), '');
  }
  return lines.join('\n').trimEnd();
}

export function renderReport(report) {
  const lines = [COMMENT_MARKER, '## AIコードレビュー', '', `対象: \`${report.head_sha ?? '未取得'}\` / base: \`${report.base_sha ?? '未取得'}\``, '', `状態: **${report.status}** / モデル: ${markdown(report.model)}`];
  if (report.run_url) lines.push('', `[Actionsの実行・証跡](${report.run_url})`);
  if (report.status !== 'completed') {
    lines.push('', markdown(report.error || report.reason || 'レビューは完了していません。'));
  } else {
    lines.push('', markdown(report.review.summary), '', `指摘: ${report.review.findings.length}件（人間による確認が必要）`);
    if (report.review.findings.length) lines.push('', renderFindings(report, { includeSide: true }));
    const limitations = [...(report.omissions ?? []), ...report.review.limitations];
    lines.push('', '### レビュー範囲・制約', '', `対象差分: ${report.files.length}ファイル / 入力: ${report.input_bytes} bytes`, '', ...limitations.map(value => `- ${markdown(value)}`));
    lines.push('', '### 対象SHAのCI結果（収集時点）', '');
    lines.push(...(report.checks?.length ? report.checks.map(check => `- ${markdown(check.name)}: ${markdown(check.conclusion || check.status)}`) : ['- CI結果はまだありません。']));
  }
  lines.push('', 'AIによる参考レビューです。指摘0件は、テスト成功・PR承認・実機検証を意味しません。');
  return lines.join('\n');
}

export async function findReviewComment(number, github) {
  for (let page = 1; page <= 10; page++) {
    const comments = await github(`/issues/${number}/comments?per_page=100&page=${page}`);
    const comment = comments.find(item => item.user?.login === 'github-actions[bot]' && item.user?.type === 'Bot' && item.body?.startsWith(COMMENT_MARKER));
    if (comment) return comment;
    if (comments.length < 100) return null;
  }
  throw new Error('Too many PR comments to safely locate review state');
}

export async function publishReview(report, options, github) {
  requireValue(report.version === 1 && report.repository === options.repository && report.number === options.number, 'Review artifact does not match the target PR');
  requireValue(['completed', 'failed', 'skipped'].includes(report.status), 'Invalid report status');
  if (report.status === 'skipped') return { status: 'skipped', reason: report.reason };
  const pr = await github(`/pulls/${options.number}`);
  if (ineligibleReason(pr, options) || pr.head.sha !== report.head_sha || pr.base.sha !== report.base_sha) {
    return { status: 'stale', reason: 'PR revision or eligibility changed; review retained only as an artifact' };
  }
  const comment = await findReviewComment(options.number, github);
  // Recheck after pagination, immediately before the write. The body always pins both SHAs.
  const current = await github(`/pulls/${options.number}`);
  if (ineligibleReason(current, options) || current.head.sha !== report.head_sha || current.base.sha !== report.base_sha) return { status: 'stale' };
  const body = renderReport(report);
  requireValue(body.length <= 60_000, 'Rendered review exceeds the comment limit');
  if (comment) await github(`/issues/comments/${comment.id}`, { method: 'PATCH', body: { body } });
  else await github(`/issues/${options.number}/comments`, { method: 'POST', body: { body } });
  return { status: 'published' };
}
