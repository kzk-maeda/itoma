import { choiceStatus, choiceTitle, groupChoices, dayAt, moveDay, timeLabel } from '../src/components/flow/history-presentation';
import { createDemoSession } from '../src/demo/session';
import type { HistoryRow } from '../modules/itoma-native';

test('related processing rows group only within the loaded page and keep the newest fact', () => {
  const rows: HistoryRow[] = [{ key: 'latest', commandID: 'command', at: 200, action: 'requestTemporaryGrant', status: 'expired', grantStatus: 'reblockPending' },
    { key: 'setting', at: 150, action: 'commitPolicy', status: 'succeeded' },
    { key: 'initial', commandID: 'command', at: 100, action: 'requestTemporaryGrant', status: 'succeeded' }];
  const groups = groupChoices(rows);
  expect(groups).toHaveLength(2);
  expect(groups[0].row.key).toBe('latest');
  expect(groups[0].events.map(row => row.key)).toEqual(['latest', 'initial']);
  expect(choiceStatus(groups[0].row)).toBe('再制限の反映は未確認');
  expect(rows).toHaveLength(3);
});
test('saved-only, cancellation, uncertain and processing success do not become measured usage', () => {
  expect(choiceTitle({ key: 'a', at: 1, action: 'cancelled', status: 'cancelled' })).toBe('確定前に取り消しました');
  expect(choiceStatus({ key: 'a', at: 1, action: 'reason', status: 'prepared' })).toBe('理由の保存のみ');
  expect(choiceStatus({ key: 'a', at: 1, action: 'requestTemporaryGrant', status: 'succeeded' })).toBe('処理の完了を記録');
  expect(choiceStatus({ key: 'a', at: 1, action: 'requestTemporaryGrant', status: 'uncertain' })).toBe('反映は未確認');
});
test('calendar uses Gregorian days across DST and dates are grouped in the read timezone', () => {
  const at = Date.parse('2026-11-15T00:30:00Z') / 1000;
  expect(dayAt(at, 'Asia/Tokyo')).toBe('2026-11-15');
  expect(dayAt(at, 'America/Los_Angeles')).toBe('2026-11-14');
  expect(moveDay('2026-03-08', 1)).toBe('2026-03-09');
  expect(moveDay('2026-11-01', -1)).toBe('2026-10-31');
  expect(timeLabel(at, 'invalid')).toContain('UTC');
});
test('demo historical context is immutable and never rebuilt from renamed current rules', async () => {
  const session = createDemoSession({ now: () => Date.parse('2026-11-15T12:00:00Z'), historySample: true });
  const page = (await session.clients.history.run('page')).page!;
  const first = page.rows[0], historical = session.historicalChoice(first);
  expect(historical?.ruleTitle).toBe('夜の読書');
  const snapshot = (await session.clients.screenTime.run('snapshot')).snapshot!;
  expect(snapshot.rules[0].title).toBe('自分の時間');
  await session.clients.screenTime.run('saveRuleDetails', { details: { ruleID: snapshot.rules[0].id, title: '新しい名前', goal: '新しい目標', expectedRevision: snapshot.ruleDetailsRevision!, expectedPolicyRevision: snapshot.revision } });
  expect(session.historicalChoice(first)).toEqual(historical);
  await session.clients.history.run('deleteReasons');
  expect((await session.clients.history.run('reason', { commandID: first.commandID })).reason?.body).toBeUndefined();
  await session.clients.reflection.run('deleteAll');
  expect(session.historicalChoice(first)).toBeUndefined();
});

test('long demo history follows real 40-row cursors, ends without repetition and rejects a cursor after deletion', async () => {
  const session = createDemoSession({ now: () => Date.parse('2026-11-15T12:00:00Z'), historySample: true, historyMore: true });
  let page = (await session.clients.history.run('page')).page!;
  const first = page, rows = [...page.rows], sizes = [page.rows.length];
  while (page.next) {
    const cursor = page.next;
    page = (await session.clients.history.run('page', { afterAt: cursor.at, afterKey: cursor.key, direction: 'older', revision: first.revision, timeZone: first.timeZone })).page!;
    rows.push(...page.rows); sizes.push(page.rows.length);
  }
  expect(sizes).toEqual([40, 40, 12]);
  expect(new Set(rows.map(row => row.key)).size).toBe(92);
  expect(rows.every(row => !('body' in row))).toBe(true);
  await session.clients.history.run('deleteReasons');
  expect((await session.clients.history.run('page', { afterAt: first.next!.at, afterKey: first.next!.key, revision: first.revision, timeZone: first.timeZone })).code).toBe('changed');
  expect((await session.clients.history.run('reason', { commandID: rows.at(-1)!.commandID })).reason?.body).toBeUndefined();
});
