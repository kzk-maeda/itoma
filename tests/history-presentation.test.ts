import { dayAt, moveDay, dateLabel, timeLabel, choiceStatus } from '../src/components/flow/history-presentation';
import type { HistoryRow } from '../modules/itoma-native/src/history';
const row: HistoryRow = { key: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', at: 0, action: 'requestTemporaryGrant', status: 'succeeded' };
test('history uses the acquisition zone and Gregorian civil days across DST and year boundaries', () => {
  expect(dayAt(Date.parse('2026-11-01T03:30:00Z') / 1000, 'America/New_York')).toBe('2026-10-31');
  expect(dayAt(Date.parse('2026-11-01T06:30:00Z') / 1000, 'America/New_York')).toBe('2026-11-01');
  expect(moveDay('2026-03-08', 1)).toBe('2026-03-09');
  expect(moveDay('2026-11-01', -1)).toBe('2026-10-31');
  expect(moveDay('2026-12-31', 1)).toBe('2027-01-01');
  expect(moveDay('2028-02-28', 1)).toBe('2028-02-29');
  expect(moveDay('2026-02-30', 1)).toBe('');
  expect(dayAt(0, 'invalid/zone')).toBe('');
  expect(dateLabel('2026-11-01')).toBe('2026年11月1日');
  expect(timeLabel(Date.parse('2026-11-15T12:00:00Z') / 1000, 'Asia/Tokyo')).toBe('21:00');
});
test('uncertain or pending reblock is not hidden behind a successful command or expired time', () => {
  expect(choiceStatus({ ...row, grantStatus: 'reblockPending', expiresAt: 1 })).toBe('再制限の反映は未確認');
  expect(choiceStatus({ ...row, grantStatus: 'uncertain', expiresAt: 1 })).toBe('反映は未確認');
  expect(choiceStatus({ ...row, status: 'uncertain', grantStatus: 'expired' })).toBe('反映は未確認');
  expect(choiceStatus({ ...row, grantStatus: 'reconciled' })).toBe('再制限への切替を記録');
  expect(choiceStatus({ ...row, status: 'failed' })).toBe('完了できませんでした');
  expect(choiceStatus({ ...row, grantStatus: 'failed' })).toBe('完了できませんでした');
  expect(choiceStatus({ ...row, grantStatus: 'invalidated' })).toBe('解除の終了を記録');
});
