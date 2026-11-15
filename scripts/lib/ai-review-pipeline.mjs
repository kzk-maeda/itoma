import { COMMENT_MARKER, markdown, renderReport, runReview, safeError } from './ai-review.mjs';
import { assessPR, policyHash } from './ai-review-triage.mjs';
import { currentRequest, readState, writeState } from './ai-review-requests.mjs';
import { renderPipelineComment } from './ai-review-comment.mjs';

const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
const statuses = ['reviewed', 'skipped_low', 'triage_failed', 'review_failed', 'manual_required', 'stale'];

function validateRequest(request, options) {
  requireValue(request?.version === 2 && request.repository === options.repository && request.number === options.number && request.run_id === options.runId && request.workflow_sha === options.workflowSha, 'Request artifact does not match this workflow');
  requireValue(['initial', 'force', 'reassess'].includes(request.mode) && /^[a-f0-9]{40}$/.test(request.head_sha) && /^[a-f0-9]{40}$/.test(request.base_sha), 'Invalid execution request');
}

export async function executeRequest(request, options, { github, policy, prompt, schema, fetchImpl }) {
  validateRequest(request, options);
  const report = { version: 2, request, status: 'triage_failed', policy_version: policy.version, policy_hash: policyHash(policy), calibration: policy.calibration, triage_model: policy.model, review_model: options.model };
  if (options.attempt !== 1) return { ...report, status: 'manual_required', error: 'Paid API work is not automatically retried. Post a new /ai-review comment.' };
  let phase = 'triage';
  try {
    const { pr } = await currentRequest(request, options, github);
    const beforeApi = () => currentRequest(request, options, github);
    if (request.mode !== 'force') {
      report.triage = await assessPR({ pr, github, policy, apiKey: options.apiKey, beforeApi, fetchImpl });
      if (report.triage.status === 'manual_required') return { ...report, status: 'manual_required' };
      if (!report.triage.required) return { ...report, status: 'skipped_low' };
    } else report.triage = { status: 'bypassed', required: true, reasons: ['manual_force'] };
    phase = 'review';
    await beforeApi();
    report.review = await runReview({ ...options, expectedSha: request.head_sha, requireLabel: true }, { github, prompt, schema, fetchImpl, beforeApi });
    report.status = report.review.status === 'completed' ? 'reviewed' : report.review.status === 'skipped' ? 'stale' : 'review_failed';
    return report;
  } catch (error) {
    return { ...report, ...(error.decisionEvidence ? { triage: { status: 'failed', ...error.decisionEvidence } } : {}), status: error.name === 'StaleRequestError' ? 'stale' : phase === 'triage' ? 'triage_failed' : 'review_failed', error: safeError(error, options) };
  }
}

export function renderPipelineReport(report) {
  const lines = [`## 選別結果: ${markdown(report.status)}`, '', `対象: \`${report.request.head_sha}\``, '', `判定モデル: ${markdown(report.triage_model)} / 本レビューモデル: ${markdown(report.review_model)}`, '', `ポリシー: ${markdown(report.policy_version)} / 校正: **${markdown(report.calibration)}（実PRで未校正）**`];
  const triage = report.triage;
  if (triage) {
    lines.push('', `判定: ${markdown(triage.status)}`);
    if (triage.model) lines.push('', `判定モデル: ${markdown(triage.model)}`);
    if (triage.status === 'assessed') {
      lines.push('', `影響スコア: ${triage.score === null ? '判定不能' : triage.score.toFixed(2)} / 100（閾値 ${triage.threshold}、比較は丸め前）`, '', `モデルスコア: ${triage.model_score === null ? '判定不能' : triage.model_score.toFixed(2)}`);
      for (const [name, value] of Object.entries(triage.dimensions)) lines.push(`- ${markdown(name)}: ${value ? `score=${value.score}, confidence=${value.confidence}` : 'refusal'}`);
      if (triage.critical_paths.length) lines.push('', `重要パス: ${triage.critical_paths.map(markdown).join(', ')}`);
      if (triage.omissions.length) lines.push('', '入力の制約:', ...triage.omissions.map(value => `- ${markdown(value)}`));
    }
    if (triage.reasons) lines.push('', `判定理由: ${triage.reasons.map(markdown).join(', ')}`);
    if (triage.reason) lines.push('', markdown(triage.reason));
  }
  if (report.status === 'skipped_low') lines.push('', '**本レビューは実行していません。** このSHAでは自動レビューを割り当てないという判断です。');
  if (report.error) lines.push('', markdown(report.error));
  if (report.review) lines.push('', renderReport(report.review).replace(COMMENT_MARKER, ''));
  return lines.join('\n');
}

export async function publishPipeline(report, options, github) {
  requireValue(report?.version === 2 && statuses.includes(report.status), 'Invalid pipeline report');
  validateRequest(report.request, options);
  try {
    const { state, comment } = await currentRequest(report.request, options, github, report.status);
    if (state.current.status === report.status) return { status: 'already_published' };
    state.current.status = report.status;
    state.current.reason = report.error || null;
    // Recheck after constructing the result, immediately before the write.
    await currentRequest(report.request, options, github);
    await writeState(state, comment, options, github, renderPipelineComment(report));
    return { status: 'published' };
  } catch (error) {
    if (error.name !== 'StaleRequestError') throw error;
    const pr = await github(`/pulls/${options.number}`);
    const { state, comment } = await readState(options, pr, github);
    if (state?.current.id === report.request.id && state.current.run_id === report.request.run_id && state.current.status === 'claimed') {
      state.current.status = 'stale';
      state.current.reason = `Request changed before completion; no review published. Current head: ${pr.head.sha}`;
      await writeState(state, comment, options, github);
    }
    return { status: 'stale' };
  }
}
