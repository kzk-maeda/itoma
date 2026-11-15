import { markdown, renderFindings } from './ai-review.mjs';
import { createHash } from 'node:crypto';

// The PR comment answers what needs attention. Diagnostic evidence stays in Actions.
export function renderRequestStatus(current) {
  switch (current.status) {
    case 'claimed': return '**AIレビューを実行中です。**';
    case 'pending_draft': return '**Draftのため未実行です。**\n\n開始するには、PRをReadyにしてください。';
    case 'skipped_low': return '**本レビューは実行していません（影響判定で省略）。**\n\n必要なら、新しいPRコメントに `/ai-review` を投稿してください。';
    case 'triage_failed': return '**影響判定に失敗し、本レビューは実行していません。**\n\n詳細・ログで原因を解消し、新しいPRコメントに `/ai-review reassess` を投稿してください。';
    case 'review_failed': return '**本レビューを完了できませんでした。**\n\n詳細・ログで原因を解消し、新しいPRコメントに `/ai-review` を投稿してください。';
    case 'manual_required': return '**AIレビューを実行できません。**\n\n差分を分割するか、人手でレビューしてください。理由は詳細・ログで確認できます。';
    case 'stale': return '**PRが更新されたため、以前の結果は現在の差分には使えません。**\n\n再レビューするには、新しいPRコメントに `/ai-review` を投稿してください。';
    case 'cancelled': return '**AIレビューを停止しました。**\n\n再開するには、PRをopen・非Draftにして、新しいPRコメントに `/ai-review` を投稿してください。';
    case 'unsupported': return '**このPRはAIレビューの対象外です。**\n\n人手でレビューしてください。';
    default: return '**結果は詳細・ログで確認してください。**';
  }
}

function renderCoverage(report) {
  const omissions = report.omissions ?? [];
  const paths = [...new Set(omissions.flatMap(value => {
    const match = value.match(/^(.+): (?:diff exceeds remaining input budget|diff unavailable \(binary, oversized, or no textual changes\)|GitHub diff may be truncated)$/);
    return match ? [match[1]] : [];
  }))];
  const media = paths.filter(path => /\.(png|jpe?g|gif|webp|heic|pdf|ico|mp4|mov)$/i.test(path));
  const text = paths.filter(path => !media.includes(path));
  const lines = [];
  if (text.length) {
    lines.push(`**未確認・不完全な差分${text.length}ファイルは、人手でレビューしてください。**`, '');
    for (const path of text.slice(0, 3)) {
      const url = `https://github.com/${report.repository}/pull/${report.number}/files#diff-${createHash('sha256').update(path).digest('hex')}`;
      lines.push(`- [${markdown(path)}](${url})`);
    }
    if (text.length > 3) lines.push(`- ほか${text.length - 3}ファイル（詳細・ログを参照）`);
  }
  if (media.length) lines.push('', `画像・動画等${media.length}ファイルの差分は、目視で確認してください。`);
  if (!paths.length && omissions.length) lines.push('**周辺コード・資料の一部を取得できていません。** 詳細・ログの未確認範囲は、人手で確認してください。');
  else if (!paths.length && report.review.limitations.length) lines.push('追加の未検証事項は、詳細・ログで確認してください。');
  return lines.join('\n').trim();
}

export function renderPipelineComment(report) {
  if (report.status !== 'reviewed') {
    if (report.status === 'manual_required' && report.error?.startsWith('Paid API work is not automatically retried.')) {
      const command = report.request.mode === 'force' ? '/ai-review' : '/ai-review reassess';
      return `**同じ実行の再試行では、APIを再送していません。**\n\n再実行するには、新しいPRコメントに \`${command}\` を投稿してください。`;
    }
    return renderRequestStatus({ status: report.status });
  }
  const review = report.review;
  const count = review.review.findings.length;
  const lines = [count ? `**修正候補 ${count}件。該当箇所を確認し、修正してください。**` : '**確認できた範囲では、修正候補は見つかりませんでした。**'];
  if (count) lines.push('', renderFindings(review));
  const coverage = renderCoverage(review);
  if (coverage) lines.push('', coverage);
  if (count) lines.push('', '修正後の再確認は、新しいPRコメントに `/ai-review` を投稿してください。');
  return lines.join('\n');
}
