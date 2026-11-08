import { presentPeriod } from '../src/components/home/period-presentation';

const start = new Date(2026, 10, 8, 21).getTime();
const minute = 60_000;

test('21:00-23:00 at 21:30 has 90 minutes, 75% remaining and one absolute deadline', () => {
  expect(presentPeriod(start, start + 120 * minute, start + 30 * minute)).toEqual({
    state: 'current', remaining: '1時間30分', fraction: 0.75, endLabel: '23:00に終了',
  });
});
test.each([[60_000, '1分'], [59_999, '1分未満'], [60_001, '2分'], [3_600_000, '1時間']])(
  'remaining %d ms is presented as %s', (remaining, text) => {
    expect(presentPeriod(start, start + remaining, start)).toMatchObject({ state: 'current', remaining: text });
  });
test.each([[start, start], [start + 1, start], [NaN, start], [start, Infinity], [start, 1e20]])(
  'invalid periods have no ring: %j', (from, to) => {
    expect(presentPeriod(from, to, start)).toEqual({ state: 'invalid' });
  });
test('future and ended intervals cannot be rendered as active', () => {
  expect(presentPeriod(start, start + minute, start - 1)).toEqual({ state: 'upcoming' });
  expect(presentPeriod(start, start + minute, start + minute)).toEqual({ state: 'expired' });
  expect(presentPeriod(start, start + minute, start + minute + 1)).toEqual({ state: 'expired' });
});
test('a night crossing midnight identifies the next day', () => {
  const end = new Date(2026, 10, 9, 2).getTime();
  expect(presentPeriod(start, end, start)).toMatchObject({ endLabel: '翌02:00に終了' });
});
