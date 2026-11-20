import type { HistoryRow } from '../../../modules/itoma-native';
export function canReadChoiceReason(row: HistoryRow) {
  return !!row.commandID && !row.reasonDeleted && ['reason', 'requestTemporaryGrant', 'retryCommand'].includes(row.action);
}
export function choiceTitle(row: HistoryRow) {
  if (row.action === 'reason') return '理由を保存しました';
  if (row.action === 'cancelled') return '確定前に取り消しました';
  if (row.action === 'commitPolicy') return 'ルールを見直しました';
  if (row.action === 'resumeAfterAuthorization') return 'ルールの再開を選びました';
  if (row.action === 'stop') return 'ルールの停止を選びました';
  return '一時解除を選びました';
}
export function choiceRecordTitle(row: HistoryRow, application?: string) {
  if (!application) return choiceTitle(row);
  return row.action === 'reason' ? `${application}を開く理由` : `${application}の一時解除`;
}
const grantStates: Record<string, string> = {
  pending: '受付済み', scheduling: '予定を登録中', applying: '反映を確認中', active: '解除の反映を記録',
  expired: '解除の期限が終了', invalidated: '解除の終了を記録', reblockPending: '再制限の反映は未確認',
  reconciled: '再制限への切替を記録', uncertain: '反映は未確認', failed: '完了できませんでした',
};
export function choiceStatus(row: HistoryRow) {
  if (row.action === 'reason' && row.status === 'prepared' && !row.grantStatus) return '理由の保存のみ';
  // An expiry or successful command must not hide uncertain/failed reblock facts.
  if (row.grantStatus === 'reblockPending') return grantStates.reblockPending;
  if (row.grantStatus === 'uncertain' || row.status === 'uncertain') return grantStates.uncertain;
  if (row.grantStatus === 'failed' || row.status === 'failed') return grantStates.failed;
  if (row.grantStatus && Object.prototype.hasOwnProperty.call(grantStates, row.grantStatus)) return grantStates[row.grantStatus];
  return ({ prepared: '理由の保存のみ', pending: '受付済み', scheduling: '予定を登録中', applying: '反映を確認中', succeeded: '処理の完了を記録', failed: '完了できませんでした', superseded: '新しい操作に置き換え', cancelled: '取消済み', uncertain: '反映は未確認', expired: '期限が終了' } as const)[row.status];
}
export { dayAt, moveDay, dateLabel, timeLabel } from '@/lib/history-date';
