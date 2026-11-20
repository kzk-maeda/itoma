import { nextEndText, nextStartText, offHoursPresentation } from '../src/components/home/off-hours-presentation';
import { offHoursNow as now, offHoursSnapshot } from './fixtures/off-hours';
import { ids, scopedSnapshot, at2130 } from './fixtures/scoped-rules';

const instant = (y: number, m: number, d: number, h: number, minute = 0) => new Date(y, m - 1, d, h, minute).getTime();
test('resolved start instants say today/tomorrow/dates and add the year when crossing years', () => {
  const today = instant(2026, 11, 20, 19);
  expect(nextStartText(instant(2026, 11, 20, 21) / 1000, today)).toEqual({ date: '今日', time: '21:00' });
  expect(nextStartText(instant(2026, 11, 21, 7) / 1000, today)).toEqual({ date: '明日', time: '07:00' });
  expect(nextStartText(instant(2026, 11, 27, 21) / 1000, today)).toEqual({ date: '11月27日(金)', time: '21:00' });
  expect(nextStartText(instant(2027, 1, 2, 21) / 1000, instant(2026, 12, 31, 12)).date).toBe('2027年1月2日(土)');
});
test('tomorrow uses civil dates across spring/fall DST, and month/year rollover', () => {
  for (const [y, m, d, yy, mm, dd] of [[2026, 3, 7, 2026, 3, 8], [2026, 10, 31, 2026, 11, 1], [2026, 1, 31, 2026, 2, 1], [2026, 12, 31, 2027, 1, 1]]) {
    expect(nextStartText(instant(yy, mm, dd, 23) / 1000, instant(y, m, d, 23, 30)).date).toBe('明日');
  }
});
test('the card repeats only the end and bases overnight copy on the native start day', () => {
  const period = { ruleID: ids.night, startsAt: instant(2026, 11, 21, 21) / 1000, endsAt: instant(2026, 11, 21, 23) / 1000 };
  expect(nextEndText(period)).toBe('23:00に終了');
  expect(nextEndText({ ...period, endsAt: instant(2026, 11, 22, 7) / 1000 })).toBe('翌日 07:00に終了');
});
test('future details and saved selection come from the same supplied native interval, independent of current targets/weekly fields', () => {
  const s = offHoursSnapshot();
  s.nextPeriod = { ruleID: ids.night, startsAt: instant(2026, 11, 20, 21) / 1000, endsAt: instant(2026, 11, 20, 23) / 1000 };
  s.rules[0] = { ...s.rules[0], startMinute: 60, weekdays: [1] };
  s.targets = []; // No current app winner is needed to show the saved next selection.
  expect(offHoursPresentation(s, now)).toMatchObject({ kind: 'next', period: s.nextPeriod, rule: s.rules[0], count: 4, start: { date: '今日', time: '21:00' }, end: '23:00に終了' });
  expect(offHoursPresentation({ ...s, rules: [...s.rules].reverse() }, now)).toMatchObject({ kind: 'next', rule: s.rules[0] });
});
test('nil from finite native search is unknown while enabled rules remain; disabled saved rules can confirm no next event', () => {
  const s = { ...offHoursSnapshot(), nextPeriod: undefined };
  expect(offHoursPresentation(s, now)).toEqual({ kind: 'checking' });
  expect(offHoursPresentation({ ...s, rules: s.rules.map(r => ({ ...r, enabled: false })) }, now)).toEqual({ kind: 'none' });
  expect(offHoursPresentation({ ...s, rules: [] }, now)).toEqual({ kind: 'hidden' });
});
test.each([
  { observation: 'unknown' }, { authorization: 'denied' }, { needsSelectionReview: true }, { storage: 'not-created' }, { schedulesReady: false }, { validUntil: now / 1000 },
] as const)('state %j cannot be called off-hours or no-next', patch => {
  expect(offHoursPresentation({ ...offHoursSnapshot(), ...patch }, now)).toEqual({ kind: 'unavailable' });
});
test('loading/busy/error context, stale intervals, invalid references, missing observation and saved selection never synthesize a next card', () => {
  const s = offHoursSnapshot();
  expect(offHoursPresentation(s, now, false)).toEqual({ kind: 'unavailable' });
  for (const broken of [
    { ...s, evaluatedAt: undefined }, { ...s, nextPeriod: { ...s.nextPeriod!, ruleID: 'missing' } }, { ...s, selections: [] },
    { ...s, nextPeriod: { ...s.nextPeriod!, startsAt: now / 1000 } }, { ...s, periods: [{ ruleID: ids.night, startsAt: now / 1000 - 3600, endsAt: now / 1000 - 1 }] },
  ]) expect(offHoursPresentation(broken, now)).toEqual({ kind: 'checking' });
  expect(offHoursPresentation({ ...s, activation: 'paused' }, now)).toEqual({ kind: 'hidden' });
});
test('active intervals stay active when all apps are granted or a lower priority rule has no winning targets', () => {
  const s = scopedSnapshot();
  expect(offHoursPresentation({ ...s, targets: [] }, at2130)).toEqual({ kind: 'hidden' });
  expect(offHoursPresentation({ ...s, targets: s.targets.map(t => ({ ...t, restricted: false, grantStatus: 'active' })) }, at2130)).toEqual({ kind: 'hidden' });
});
