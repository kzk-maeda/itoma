import { COMMENT_MARKER, findReviewComment, ineligibleReason } from './ai-review.mjs';
import { renderRequestStatus } from './ai-review-comment.mjs';

const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
const integer = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const sha = value => /^[a-f0-9]{40}$/.test(value || '');
const LABEL = 'ai-review';

export class StaleRequestError extends Error {
  constructor(message) { super(message); this.name = 'StaleRequestError'; }
}
class CommandRejectedError extends Error {
  constructor(message) { super(message); this.name = 'CommandRejectedError'; }
}
const commandCheck = (ok, message) => { if (!ok) throw new CommandRejectedError(message); };

export function requestOptions(env, options) {
  requireValue(integer(env.GITHUB_RUN_ID), 'Invalid workflow run ID');
  requireValue(integer(env.GITHUB_RUN_ATTEMPT || '1'), 'Invalid workflow attempt');
  requireValue(sha(env.GITHUB_WORKFLOW_SHA), 'Missing trusted workflow revision');
  const mode = env.AI_REVIEW_MODE || 'force';
  requireValue(['force', 'reassess'].includes(mode), 'Invalid review request mode');
  const commentId = env.AI_REVIEW_COMMENT_ID || '';
  requireValue(!commentId || integer(commentId), 'Invalid command comment ID');
  return {
    ...options, runId: Number(env.GITHUB_RUN_ID), attempt: Number(env.GITHUB_RUN_ATTEMPT || 1),
    workflowSha: env.GITHUB_WORKFLOW_SHA, actor: env.GITHUB_ACTOR,
    eventName: env.GITHUB_EVENT_NAME, mode, commentId: commentId ? Number(commentId) : null,
    requireLabel: true,
  };
}

export function parseCommand(body) {
  const text = typeof body === 'string' ? body.trim() : '';
  if (text === '/ai-review') return 'force';
  if (text === '/ai-review reassess') return 'reassess';
  return null;
}

export async function hasWritePermission(login, github) {
  if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(login || '')) return false;
  const permission = await github(`/collaborators/${encodeURIComponent(login)}/permission`, { optional: true });
  return permission && (['write', 'admin', 'maintain'].includes(permission.permission) || ['maintain', 'admin'].includes(permission.role_name));
}

export async function commandSource(options, pr, github) {
  const comment = await github(`/issues/comments/${options.commentId}`, { optional: true });
  commandCheck(comment && comment.id === options.commentId, 'Command comment is missing');
  commandCheck(comment.issue_url === `https://api.github.com/repos/${options.repository}/issues/${options.number}`, 'Command belongs to another PR');
  commandCheck(parseCommand(comment.body) === options.mode && comment.created_at === comment.updated_at, 'Command was edited or is not recognized');
  commandCheck(comment.user?.type === 'User' && await hasWritePermission(comment.user.login, github), 'Command author lacks write permission');
  commandCheck(!ineligibleReason(pr, { ...options, requireLabel: false, expectedSha: null }), 'Command PR is not eligible');
  return { id: comment.id, author: comment.user.login, url: `https://github.com/${options.repository}/pull/${options.number}#issuecomment-${comment.id}` };
}

export async function receiveCommand(event, options, github) {
  if (options.attempt !== 1 || event.action !== 'created' || !event.issue?.pull_request || event.issue.number !== options.number) return { status: 'ignored' };
  const mode = parseCommand(event.comment?.body);
  if (!mode || !integer(event.comment?.id)) return { status: 'ignored' };
  const pr = await github(`/pulls/${options.number}`);
  const accepted = { ...options, mode, commentId: event.comment.id };
  let source;
  try { source = await commandSource(accepted, pr, github); }
  catch (error) { if (error.name === 'CommandRejectedError') return { status: 'rejected' }; throw error; }
  requireValue(source.author === event.comment.user?.login, 'Command author changed');
  const { state } = await readState(options, pr, github);
  if (state && source.id <= state.last_command_id) return { status: 'duplicate' };
  const current = await github(`/pulls/${options.number}`);
  requireValue(current.head.sha === pr.head.sha && current.base.sha === pr.base.sha, 'PR changed before dispatch');
  await github('/actions/workflows/ai-review.yml/dispatches', {
    method: 'POST', body: { ref: options.defaultBranch, inputs: {
      pull_request_number: String(options.number), mode,
      comment_id: String(source.id), expected_sha: pr.head.sha,
    } },
  });
  return { status: 'dispatched', mode, number: options.number };
}

export function parseState(comment, options, pr) {
  if (!comment) return null;
  const marker = comment.body.match(/^<!-- itoma-ai-state:([A-Za-z0-9_-]+) -->$/m);
  if (!marker) {
    requireValue(!/^<!-- itoma-ai-state:/m.test(comment.body), 'Review state is damaged; repair it before retrying');
    return null; // Legacy review comment: only an explicit new request can initialize it.
  }
  let state;
  try { state = JSON.parse(Buffer.from(marker[1], 'base64url').toString('utf8')); }
  catch { throw new Error('Review state is damaged; repair it before retrying'); }
  requireValue(state.version === 2 && state.repository === options.repository && state.number === options.number && state.node_id === pr.node_id, 'Review state belongs to another PR');
  requireValue(typeof state.initial?.consumed === 'boolean' && typeof state.initial?.pending === 'boolean', 'Invalid initial review state');
  for (const key of ['last_run_id', 'last_command_id']) requireValue(Number.isSafeInteger(state[key]) && state[key] >= 0, 'Invalid request watermark');
  requireValue(state.current && typeof state.current.id === 'string' && typeof state.current.status === 'string' && sha(state.current.head_sha) && sha(state.current.base_sha), 'Invalid current request state');
  return state;
}

export async function readState(options, pr, github) {
  const comment = await findReviewComment(options.number, github);
  return { comment, state: parseState(comment, options, pr) };
}

export function renderState(state, options, visible = '') {
  const current = state.current;
  const target = `対象: [\`${current.head_sha.slice(0, 7)}\`](https://github.com/${options.repository}/commit/${current.head_sha})`;
  const lines = [COMMENT_MARKER, '## AIレビュー', '', visible || renderRequestStatus(current), '', `${target}${current.run_url ? ` · [詳細・ログ](${current.run_url})` : ''}`,
    '', `<!-- itoma-ai-state:${Buffer.from(JSON.stringify(state)).toString('base64url')} -->`];
  return lines.join('\n');
}

export async function writeState(state, comment, options, github, visible = '') {
  const body = renderState(state, options, visible);
  requireValue(body.length <= 60_000, 'Review comment exceeds size limit');
  return github(comment ? `/issues/comments/${comment.id}` : `/issues/${options.number}/comments`, {
    method: comment ? 'PATCH' : 'POST', body: { body },
  });
}

function freshState(options, pr) {
  return { version: 2, repository: options.repository, number: options.number, node_id: pr.node_id,
    initial: { consumed: true, pending: false }, last_run_id: 0, last_command_id: 0, current: null };
}

function requestRecord(options, pr, mode, source, id) {
  return { id, mode, author: source?.author || options.actor || null, comment_id: source?.id || null,
    head_sha: pr.head.sha, base_sha: pr.base.sha, run_id: options.runId,
    run_url: options.runUrl, workflow_sha: options.workflowSha, status: 'claimed' };
}

export async function prepareRequest(event, options, github) {
  if (options.attempt !== 1) return { run: false, reason: 'Use a new comment instead of retrying paid API work' };
  const pr = await github(`/pulls/${options.number}`);
  const action = event.action;
  const relevant = ['opened', 'ready_for_review', 'synchronize', 'reopened', 'closed', 'converted_to_draft'].includes(action) ||
    (['labeled', 'unlabeled'].includes(action) && event.label?.name === LABEL) || (action === 'edited' && event.changes?.base);
  if (options.eventName !== 'workflow_dispatch' && !relevant) return { run: false, reason: 'Unrelated event' };
  const found = await readState(options, pr, github);
  let state = found.state;
  if (state && options.runId <= state.last_run_id) return { run: false, reason: 'Request already consumed or superseded' };
  const initialEvent = action === 'opened' || (action === 'edited' && event.changes?.base && pr.base.ref === options.defaultBranch);
  const manual = options.eventName === 'workflow_dispatch' || action === 'labeled';
  if (action === 'labeled' && !pr.labels?.some(label => label.name === LABEL)) return { run: false, reason: 'Label event is stale' };
  if (pr.base.ref !== options.defaultBranch && !state) return { run: false, reason: 'Not a default-branch PR' };
  let source = null;
  let mode = 'initial';
  if (manual) {
    if (options.eventName === 'workflow_dispatch') {
      if (options.commentId) {
        requireValue(sha(options.expectedSha), 'Comment dispatch requires the accepted head SHA');
        source = await commandSource(options, pr, github);
        if (state && source.id <= state.last_command_id) return { run: false, reason: 'Command already consumed' };
      } else requireValue(await hasWritePermission(options.actor, github), 'Manual request requires write permission');
      mode = options.mode;
    } else mode = 'force';
    const reason = ineligibleReason(pr, { ...options, requireLabel: false });
    requireValue(!reason, reason || 'PR is not eligible');
    // Explicit new requests can initialize a legacy PR; never create a new automatic slot.
    state ??= freshState(options, pr);
    state.initial = { consumed: true, pending: false };
  } else if (initialEvent && !state && !found.comment) {
    state = freshState(options, pr);
    state.initial = { consumed: false, pending: true };
  } else if (!state) {
    // Ready/reopen/push on pre-existing PRs do not acquire an automatic review slot.
    return { run: false, reason: 'No initial request; use /ai-review' };
  }
  const id = source ? `comment:${source.id}` : manual ? `${action === 'labeled' ? 'label' : 'manual'}:${options.runId}` : `event:${options.runId}`;
  const previous = state.current;
  state.last_run_id = options.runId;
  if (source) state.last_command_id = source.id;
  state.current = requestRecord(options, pr, mode, source, id);
  const invalidation = !manual && !initialEvent && !(action === 'ready_for_review' && state.initial.pending && !state.initial.consumed);
  const unlabeled = action === 'unlabeled';
  const reason = ineligibleReason(pr, { ...options, requireLabel: false });
  if (unlabeled) state.initial = { consumed: true, pending: false };
  if (invalidation || reason || (options.expectedSha && pr.head.sha !== options.expectedSha)) {
    state.current.status = unlabeled || pr.state !== 'open' || pr.draft ? 'cancelled' : 'stale';
    state.current.reason = reason || (unlabeled ? 'ai-review label removed' : 'PR changed; manual review request required');
    const unsupported = pr.head?.repo?.full_name !== options.repository || pr.base?.repo?.full_name !== options.repository || pr.base.ref !== options.defaultBranch;
    if (unsupported || pr.state !== 'open' || unlabeled) {
      state.initial = { consumed: true, pending: false };
      state.current.status = unsupported ? 'unsupported' : 'cancelled';
    } else if (state.initial.pending && !state.initial.consumed && pr.draft) state.current.status = 'pending_draft';
    else if (initialEvent) state.initial = { consumed: true, pending: false };
    if (previous?.run_url) state.current.reason += `; previous evidence: ${previous.run_url}`;
    if (initialEvent && pr.base.ref === options.defaultBranch && pr.state === 'open') await github(`/issues/${options.number}/labels`, { method: 'POST', body: { labels: [LABEL] } });
    await writeState(state, found.comment, options, github);
    return { run: false, reason: state.current.status };
  }
  if (!manual && state.initial.consumed) return { run: false, reason: 'Initial review already consumed' };
  if (!manual && !initialEvent && !pr.labels?.some(label => label.name === LABEL)) {
    state.initial = { consumed: true, pending: false };
    state.current.status = 'cancelled'; state.current.reason = 'Initial label was removed';
    await writeState(state, found.comment, options, github);
    return { run: false, reason: 'Initial request cancelled' };
  }
  state.initial = { consumed: true, pending: false };
  await github(`/issues/${options.number}/labels`, { method: 'POST', body: { labels: [LABEL] } });
  await writeState(state, found.comment, options, github);
  return { run: true, request: { version: 2, repository: options.repository, number: options.number, node_id: pr.node_id, ...state.current } };
}

export async function currentRequest(request, options, github, allowedStatus = 'claimed') {
  const pr = await github(`/pulls/${options.number}`);
  const reason = ineligibleReason(pr, { ...options, expectedSha: request.head_sha, requireLabel: true });
  if (reason || pr.base.sha !== request.base_sha || request.repository !== options.repository || request.number !== options.number || request.node_id !== pr.node_id) throw new StaleRequestError(reason || 'Request revision changed');
  const found = await readState(options, pr, github);
  if (!found.state || ['id', 'run_id', 'head_sha', 'base_sha', 'mode', 'comment_id', 'author', 'workflow_sha'].some(key => found.state.current[key] !== request[key]) || !['claimed', allowedStatus].includes(found.state.current.status)) throw new StaleRequestError('Request was superseded or cancelled');
  if (request.comment_id) {
    try {
      const source = await commandSource({ ...options, mode: request.mode, commentId: request.comment_id }, pr, github);
      if (source.author !== request.author) throw new Error('Command author changed');
    } catch { throw new StaleRequestError('Command was removed, edited, or no longer authorized'); }
  } else if (request.id.startsWith('manual:') && !await hasWritePermission(request.author, github)) {
    throw new StaleRequestError('Manual requester no longer has write permission');
  }
  return { pr, ...found };
}
