import { createHash } from 'node:crypto';

export const REVIEW_START = '<!-- itoma-ai-result:start -->';
export const REVIEW_END = '<!-- itoma-ai-result:end -->';
export const REVIEW_AGAIN = '修正後の再確認は、新しいPRコメントに `/ai-review` を投稿してください。';
const digest = text => createHash('sha256').update(text).digest('hex');
export const matchesReviewBody = (body, review) => typeof body === 'string' && digest(body.trim()) === review.body_sha256;

export function reviewSnapshot(request, body, findings) {
  return { head_sha: request.head_sha, base_sha: request.base_sha, run_id: request.run_id,
    finding_count: findings, body_sha256: digest(body.trim()) };
}

export function validReviewSnapshot(review) {
  return review && /^[a-f0-9]{40}$/.test(review.head_sha) && /^[a-f0-9]{40}$/.test(review.base_sha) &&
    Number.isSafeInteger(review.run_id) && review.run_id > 0 && /^[a-f0-9]{64}$/.test(review.body_sha256) &&
    (review.finding_count === null || (Number.isSafeInteger(review.finding_count) && review.finding_count >= 0 && review.finding_count <= 10));
}

function legacyBody(comment, repository, review) {
  const heading = '## AIレビュー\n\n';
  const start = comment?.body.indexOf(heading);
  const footer = `\n\n対象: [\`${review.head_sha.slice(0, 7)}\`](https://github.com/${repository}/commit/${review.head_sha})`;
  const end = comment?.body.lastIndexOf(footer);
  if (start === undefined || start < 0 || end <= start + heading.length) return null;
  return comment.body.slice(start + heading.length, end).replace(`\n\n${REVIEW_AGAIN}`, '').trim();
}

// Upgrade an existing completed comment without interpreting prose as request state.
export function adoptLegacyReview(state, comment) {
  if (!state || state.last_review || state.current.status !== 'reviewed') return;
  const body = legacyBody(comment, state.repository, state.current);
  if (!body) return;
  const count = body.match(/^\*\*修正候補 (\d+)件/);
  const findingCount = count ? Number(count[1]) : body.startsWith('**確認できた範囲では、修正候補は見つかりませんでした。**') ? 0 : null;
  const snapshot = reviewSnapshot(state.current, body, findingCount);
  if (validReviewSnapshot(snapshot)) state.last_review = snapshot;
}

export function extractReviewBody(comment, state) {
  const review = state.last_review;
  if (!review || !comment) return null;
  const sections = [...comment.body.matchAll(/^<!-- itoma-ai-result:start -->\n([\s\S]*?)\n<!-- itoma-ai-result:end -->$/gm)];
  const body = sections.length === 1 ? sections[0][1].trim() : sections.length === 0 ? legacyBody(comment, state.repository, review) : null;
  return body && digest(body) === review.body_sha256 ? body : null;
}
