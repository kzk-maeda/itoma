import { createHash } from 'node:crypto';
import { diffRanges } from './ai-review.mjs';

const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
const finiteRange = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
const bytes = value => Buffer.byteLength(JSON.stringify(value));

export function validatePolicy(policy) {
  requireValue(policy.version && policy.calibration === 'provisional' && policy.model === 'gpt-6-luna', 'Invalid triage policy identity');
  requireValue(finiteRange(policy.threshold, 0, 100) && finiteRange(policy.critical_path_floor, policy.threshold, 100), 'Invalid triage score thresholds');
  requireValue(finiteRange(policy.minimum_confidence, 0, 1) && finiteRange(policy.high_tail_threshold, 0, 1), 'Invalid triage probability thresholds');
  requireValue(policy.max_facts_bytes === 49152 && policy.max_request_bytes === 65536, 'Invalid triage input limits');
  requireValue(Array.isArray(policy.critical_paths) && policy.critical_paths.length > 0, 'Missing critical paths');
  for (const pattern of policy.critical_paths) new RegExp(pattern, 'i');
  requireValue(policy.questions?.length === 3 && new Set(policy.questions.map(q => q.name)).size === 3, 'Invalid triage questions');
  for (const q of policy.questions) {
    requireValue(['impact', 'spread', 'sensitive'].includes(q.name) && q.type === 'score' && q.instructions && q.levels?.length === 5 && finiteRange(q.weight, 0, 1), 'Invalid score rubric');
    requireValue(q.levels.every(level => typeof level.label === 'string' && typeof level.description === 'string'), 'Invalid score levels');
  }
  requireValue(Math.abs(policy.questions.reduce((sum, q) => sum + q.weight, 0) - 1) < 1e-9, 'Triage weights must sum to one');
  return policy;
}

export const policyHash = policy => createHash('sha256').update(JSON.stringify(policy)).digest('hex');

export function criticalPaths(files, policy) {
  return [...new Set(files.flatMap(file => [file.path, file.previous_path].filter(Boolean)))]
    .filter(path => policy.critical_paths.some(pattern => new RegExp(pattern, 'i').test(path)));
}

export async function collectTriageInput(pr, github, policy) {
  if (!Number.isInteger(pr.changed_files) || pr.changed_files < 1 || pr.changed_files > 100) {
    return { supported: false, reason: 'PR must have 1–100 changed files; split it or review manually' };
  }
  const files = await github(`/pulls/${pr.number}/files?per_page=100`);
  requireValue(files.length === pr.changed_files, 'Incomplete changed-file list');
  const facts = {
    number: pr.number, head_sha: pr.head.sha, base_sha: pr.base.sha,
    title: String(pr.title || '').slice(0, 300), files: [], patches: [], omissions: [],
  };
  for (const file of files) {
    requireValue(typeof file.filename === 'string' && !/[\x00-\x1f\x7f]/.test(file.filename), 'Invalid triage path');
    facts.files.push({ path: file.filename, previous_path: file.previous_filename ?? null, status: file.status, additions: file.additions, deletions: file.deletions });
  }
  let textual = 0;
  for (const file of files) {
    const ranges = diffRanges(file.patch || '');
    if (!ranges.length) { facts.omissions.push(`${file.filename}: no textual patch`); continue; }
    textual++;
    const patch = { path: file.filename, patch: file.patch };
    // Reserve room for the omissions list; include complete patches, never half a hunk.
    if (bytes({ ...facts, patches: [...facts.patches, patch] }) <= policy.max_facts_bytes - 8192) facts.patches.push(patch);
    else facts.omissions.push(`${file.filename}: patch exceeds triage budget`);
    const lines = file.patch.split('\n');
    if (lines.filter(x => x.startsWith('+')).length !== file.additions || lines.filter(x => x.startsWith('-')).length !== file.deletions) {
      facts.omissions.push(`${file.filename}: GitHub patch may be truncated`);
    }
  }
  if (!textual) return { supported: false, reason: 'No textual diffs; human or visual QA is required' };
  requireValue(bytes(facts) <= policy.max_facts_bytes, 'Triage facts exceed hard limit');
  return { supported: true, facts, critical_paths: criticalPaths(facts.files, policy) };
}

export function decideReview(result, facts, policy) {
  requireValue(/^gpt-6-luna(?:-\d{4}-\d{2}-\d{2})?$/.test(result.model || ''), 'Unexpected Decisions model');
  requireValue(Array.isArray(result.answers) && result.answers.length === 3, 'Missing Decisions answers');
  const names = new Set();
  const dimensions = {};
  let refused = false;
  for (const answer of result.answers) {
    const question = policy.questions.find(q => q.name === answer.name);
    requireValue(question && !names.has(answer.name), 'Unknown or duplicate Decisions answer');
    names.add(answer.name);
    if (answer.type === 'refusal') { dimensions[answer.name] = null; refused = true; continue; }
    requireValue(answer.type === 'score' && finiteRange(answer.score, 0, 4) && finiteRange(answer.confidence, 0, 1), 'Invalid Decisions score/confidence');
    requireValue(Array.isArray(answer.probabilities) && answer.probabilities.length === 5, 'Invalid Decisions distribution');
    const levels = new Set();
    let total = 0; let expected = 0; let high = 0;
    for (const p of answer.probabilities) {
      requireValue(Number.isInteger(p.value) && p.value >= 0 && p.value < 5 && !levels.has(p.value) && p.label === question.levels[p.value].label && finiteRange(p.probability, 0, 1), 'Invalid Decisions probability');
      levels.add(p.value); total += p.probability; expected += p.value * p.probability;
      if (p.value >= 3) high += p.probability;
    }
    requireValue(Math.abs(total - 1) <= 0.005 && Math.abs(expected - answer.score) <= 0.02, 'Inconsistent Decisions distribution');
    dimensions[answer.name] = { score: answer.score, confidence: answer.confidence, high_tail: high, probabilities: answer.probabilities };
  }
  const paths = criticalPaths(facts.files, policy);
  const modelScore = refused ? null : 25 * policy.questions.reduce((sum, q) => sum + q.weight * dimensions[q.name].score, 0);
  const score = modelScore === null ? null : Math.max(modelScore, paths.length ? policy.critical_path_floor : 0);
  const confidence = refused ? null : Math.min(...Object.values(dimensions).map(d => d.confidence));
  const tail = refused ? null : Math.max(...Object.values(dimensions).map(d => d.high_tail));
  const reasons = [];
  if (paths.length) reasons.push('critical_path');
  if (score !== null && score >= policy.threshold) reasons.push('score_threshold');
  if (tail !== null && tail >= policy.high_tail_threshold) reasons.push('high_impact_tail');
  if (confidence !== null && confidence < policy.minimum_confidence) reasons.push('low_confidence');
  if (refused || facts.omissions.length) reasons.push('insufficient_evidence');
  return {
    status: 'assessed', required: reasons.length > 0,
    model: result.model, model_score: modelScore, score, confidence_min: confidence,
    high_tail: tail, dimensions, critical_paths: paths, reasons: reasons.length ? reasons : ['below_threshold'],
    omissions: facts.omissions, usage: result.usage ?? null,
    policy_version: policy.version, policy_hash: policyHash(policy), calibration: policy.calibration,
    threshold: policy.threshold,
  };
}

export async function assessPR({ pr, github, policy, apiKey, beforeApi, fetchImpl = fetch }) {
  validatePolicy(policy);
  requireValue(apiKey, 'OPENAI_API_KEY is not configured');
  const collected = await collectTriageInput(pr, github, policy);
  if (!collected.supported) return { status: 'manual_required', required: false, reason: collected.reason };
  const request = {
    model: policy.model,
    input: JSON.stringify(collected.facts),
    questions: policy.questions.map(({ type, name, instructions, levels }) => ({ type, name, instructions, levels })),
  };
  requireValue(bytes(request) <= policy.max_request_bytes, 'Decisions request exceeds hard limit');
  await beforeApi();
  let response;
  try {
    response = await fetchImpl('https://api.openai.com/v1/decisions', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  } catch { throw new Error('Decisions request failed or timed out; no automatic retry'); }
  const evidence = { model: policy.model, input_bytes: bytes(collected.facts), request_id: response.headers?.get('x-request-id') ?? null, usage: null };
  const failure = message => Object.assign(new Error(message), { decisionEvidence: evidence });
  if (!response.ok) throw failure(`Decisions HTTP ${response.status}; no automatic retry`);
  let result;
  try { result = await response.json(); } catch { throw failure('Decisions returned invalid JSON'); }
  evidence.usage = result?.usage ?? null;
  if (typeof result?.model === 'string' && result.model.length <= 200) evidence.model = result.model;
  try { return { ...decideReview(result, collected.facts, policy), ...evidence }; }
  catch (error) { throw Object.assign(error, { decisionEvidence: evidence }); }
}
