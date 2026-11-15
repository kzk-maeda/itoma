import type { HistoryRow } from '../../../modules/itoma-native';
export function canReadChoiceReason(row: HistoryRow) {
  return !!row.commandID && !row.reasonDeleted && ['reason', 'requestTemporaryGrant', 'retryCommand'].includes(row.action);
}
export function groupChoices(rows: HistoryRow[]): { row: HistoryRow; events: HistoryRow[] }[] {
  const groups: { row: HistoryRow; events: HistoryRow[] }[] = [], byCommand = new Map<string, number>();
  for (const row of rows) {
    const related = !!row.commandID && ['reason', 'requestTemporaryGrant', 'retryCommand'].includes(row.action);
    const index = related ? byCommand.get(row.commandID!) : undefined;
    if (index !== undefined) groups[index].events.push(row);
    else { if (related) byCommand.set(row.commandID!, groups.length); groups.push({ row, events: [row] }); }
  }
  return groups;
}
export function choiceTitle(row: HistoryRow) {
  if (row.action === 'reason') return '理由を保存しました';
  if (row.action === 'cancelled') return '確定前に取り消しました';
  if (row.action === 'commitPolicy') return 'ルールを見直しました';
  if (row.action === 'resumeAfterAuthorization') return 'ルールの再開を選びました';
  if (row.action === 'stop') return 'ルールの停止を選びました';
  return '一時解除を選びました';
}
export function choiceStatus(row: HistoryRow) {
  if (row.action === 'reason' && row.status === 'prepared') return '理由の保存のみ';
  if (row.grantStatus === 'reblockPending') return '再制限の反映は未確認';
  if (row.grantStatus === 'uncertain' || row.status === 'uncertain') return '反映は未確認';
  if (row.grantStatus === 'expired' || row.status === 'expired') return '解除の期限が終了';
  if (row.grantStatus === 'reconciled') return '期限後の切替を記録';
  return ({ prepared: '理由の保存のみ', pending: '受付済み', scheduling: '予定を登録中', applying: '反映を確認中', succeeded: '処理の完了を記録', failed: '完了できませんでした', superseded: '新しい操作に置き換え', cancelled: '取消済み', uncertain: '反映は未確認', expired: '期限が終了' } as const)[row.status];
}
export { dayAt, moveDay, dateLabel, timeLabel } from '@/lib/history-date';
