import { currentControlSnapshot } from '../src/state/control-snapshot';
import { unavailableSnapshot, type ScreenTimeSnapshot } from '../modules/itoma-native/src/screen-time';
const make = (sequence: string, revision: string, title: string): ScreenTimeSnapshot => ({ ...unavailableSnapshot('device'), storage: 'ready', sequence,
  ruleDetailsStatus: 'ready', ruleDetailsRevision: revision,
  rules: [{ id: 'rule', selectionRef: 'selection', weekdays: [1], startMinute: 0, endMinute: 1, nextDay: false, enabled: true, title }] });
test('a late snapshot keeps the latest private text without hiding a newer OS/control observation', () => {
  const latest = make('9', '10', 'new title');
  const result = currentControlSnapshot(latest, { ...make('10', '9', 'old title'), observation: 'uncertain' });
  expect(result.sequence).toBe('10'); expect(result.observation).toBe('uncertain');
  expect(result.rules[0].title).toBe('new title'); expect(result.ruleDetailsRevision).toBe('10');
  const reversed = currentControlSnapshot(make('10', '9', 'old title'), latest);
  expect(reversed.sequence).toBe('10'); expect(reversed.rules[0].title).toBe('new title');
});
test('unavailable private storage hides personal text; a late result cannot recreate deleted rules', () => {
  const old = make('1', '0', 'old title');
  const unavailable = { ...make('2', '1', ''), ruleDetailsStatus: 'unavailable' as const };
  expect(currentControlSnapshot(old, unavailable)).toBe(unavailable);
  const deleted = { ...make('3', '1', ''), rules: [] };
  expect(currentControlSnapshot(deleted, make('2', '2', 'late title')).rules).toEqual([]);
});
