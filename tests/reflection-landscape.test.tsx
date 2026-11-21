import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ReflectionContent } from '../src/components/flow/reflection-content';
import { cumulativeAmount, dayLength } from '../src/lib/reflection-landscape';
import { landscapeFixture } from './fixtures/reflection-landscape';
import { parseReflectionSnapshot, ReflectionReadError, type ReflectionRequest, type ReflectionWeekRead } from '../modules/itoma-native/src/reflection-model';
import { createReflectionClient } from '../modules/itoma-native/src/reflection';

jest.mock('../src/global.css', () => ({}));
const label = () => screen.getByTestId('reflection-total').props.accessibilityLabel;
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const amount = (value?: number) => {
  const { number, unit, prefix, tail } = cumulativeAmount(value);
  return prefix + number + unit + tail;
};
test.each([
  [undefined, '—'], [0, '0分'], [59, '1分未満'], [4 * 3600 + 13 * 60, '4時間13分'],
  [dayLength - 1, '23時間59分'], [dayLength, '1日分'], [dayLength + 1, '1日分'],
  [30 * 3600, '1日分と6時間'], [30 * dayLength - 1, '29日分と23時間59分'], [30 * dayLength, '約1か月分'],
  [30 * dayLength + 1, '約1か月分'], [40 * dayLength, '約1か月分と10日'], [360 * dayLength, '約12か月分'],
  [365 * dayLength - 1, '約12か月分と4日23時間59分'], [365 * dayLength, '約1年分'],
  [365 * dayLength + 1, '約1年分'], [438 * dayLength, '約1年分と73日'],
])('display units use original seconds at %s', (seconds, expected) => expect(amount(seconds)).toBe(expected));

test('the bridge retains a distinct cumulative type and projects only the pinned week request', async () => {
  const f = landscapeFixture(7384, 438 * dayLength);
  const snapshot = f.snapshot();
  const parsed = parseReflectionSnapshot(JSON.stringify(snapshot));
  expect(parsed.landscape?.points).toHaveLength(64);
  expect(parsed.landscape?.points.at(-1)?.cumulativeSeconds).toBe(snapshot.total.knownSeconds);
  expect(parsed.inspectionWeek?.days.length).toBeLessThanOrEqual(7);
  expect(() => parseReflectionSnapshot(JSON.stringify({ ...snapshot, trend: [{ ...snapshot.total, knownSeconds: snapshot.total.until - snapshot.total.from + 1 }] }))).toThrow();
  expect(() => parseReflectionSnapshot(JSON.stringify({ ...snapshot, landscape: { ...snapshot.landscape, points: Array(65).fill(snapshot.landscape!.points[0]) } }))).toThrow();
  const day = snapshot.landscape!.startDay;
  const native = jest.fn(async (_action, _payload) => JSON.stringify({ status: 'ok', storage: 'ready', transfer: 'unavailable', inspection: { token: f.token, week: f.week(day) } }));
  const client = createReflectionClient('ios', () => ({ apiVersion: 1, reflectionVersion: 1, reflection: native }));
  const result = await client.run('readWeek', { day, expectedToken: f.token });
  expect(native).toHaveBeenCalledWith('readWeek', JSON.stringify({ day, expectedToken: f.token }));
  expect(result.inspection?.week.days).toHaveLength(7);
  expect(result.snapshot).toBeUndefined();
});

function makeSource() {
  const f = landscapeFixture(7384, 438 * dayLength);
  const pending: { day: string; resolve: (result: ReflectionWeekRead) => void; reject: (error: Error) => void }[] = [];
  const read = jest.fn(async (request: ReflectionRequest) =>
    JSON.stringify(f.snapshot(request.period, request.day || undefined, !request.expectedToken)));
  const readWeek = jest.fn((day: string, _token: string) => new Promise<ReflectionWeekRead>((resolve, reject) => pending.push({ day, resolve, reject })));
  return { f, pending, source: { read, readWeek } };
}

test('long history uses the local week, skips intermediate requests and keeps the selected day across lower period changes', async () => {
  const { f, pending, source } = makeSource();
  await render(<ReflectionContent source={source} />);
  await screen.findByText('全期間');
  expect(label()).toBe('約1年分と73日');
  expect(source.readWeek).not.toHaveBeenCalled();
  for (let i = 0; i < 4; i++) await press('前日');
  expect(source.readWeek).not.toHaveBeenCalled();
  for (let i = 0; i < 15; i++) await press('前日');
  expect(source.readWeek).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText('確認中')).toHaveLength(2);
  await act(async () => pending[0].resolve({ token: f.token, week: f.week(pending[0].day) }));
  expect(source.readWeek).toHaveBeenCalledTimes(2);
  expect(screen.getAllByText('確認中')).toHaveLength(2);
  await act(async () => pending[1].resolve({ token: f.token, week: f.week(pending[1].day) }));
  expect(screen.queryByText('確認中')).toBeNull();
  const selected = label();
  await press('月次');
  await screen.findByText('2026年11月');
  expect(label()).toBe(selected);
  expect(source.readWeek).toHaveBeenCalledTimes(2);
  await press('最新に戻す');
  expect(label()).toBe('約1年分と73日');
});

test('a dismissed week cannot restore values after a reset and a changed token reloads a coherent total', async () => {
  const { f, pending, source } = makeSource();
  await render(<ReflectionContent source={source} />);
  await screen.findByText('全期間');
  for (let i = 0; i < 5; i++) await press('前日');
  await press('最新に戻す');
  await act(async () => pending[0].resolve({ token: f.token, week: f.week(pending[0].day) }));
  expect(label()).toBe('約1年分と73日');
  expect(screen.getByText('全期間')).toBeTruthy();
  for (let i = 0; i < 5; i++) await press('前日');
  const next = landscapeFixture(30, 30 * 3600, 'reflection-v1:new-data');
  source.read.mockImplementation(async () => JSON.stringify(next.snapshot()));
  await act(async () => pending[1].reject(new ReflectionReadError('changed')));
  expect(label()).toBe('1日分と6時間');
  expect(screen.getByText('全期間')).toBeTruthy();
});

test('a full-day gap shows no number for the day or historical total and later dates carry partial coverage', async () => {
  const f = landscapeFixture(), snapshot = f.snapshot();
  const rows = snapshot.inspectionWeek!.days;
  rows[0] = { ...rows[0], knownSeconds: undefined, coverage: 'partial' };
  const source = { read: async () => JSON.stringify(snapshot), readWeek: jest.fn() };
  await render(<ReflectionContent source={source} />);
  await screen.findByText('全期間');
  for (let i = 0; i < 4; i++) await press('前日');
  expect(label()).toBe('—');
  expect(screen.getByText(/この日は未記録です/)).toBeTruthy();
  await press('翌日');
  expect(screen.getByText('一部未記録のため、確認できた分の累計です。')).toBeTruthy();
  expect(source.readWeek).not.toHaveBeenCalled();
});
