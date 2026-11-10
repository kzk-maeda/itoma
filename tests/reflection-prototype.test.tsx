import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseReflectionSnapshot, reflectionDuration, ReflectionPrototypeReadError, type ReflectionPeriod, type ReflectionPrototypeSource, type ReflectionRequest } from '../src/experiments/reflection/model';
import { ReflectionPrototypePreview } from '../src/experiments/reflection/preview';

jest.mock('../src/global.css', () => ({}));

type Fixture = { request: { period: ReflectionPeriod; day: string; clippedTo?: { from: number; until: number } }; response: unknown };
const fixtures = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/reflection-prototype.json'), 'utf8')) as Record<string, Fixture[]>;
const json = (scenario = 'recorded', request: ReflectionRequest = { period: 'week', day: '2026-11-09' }) => {
  const entry = fixtures[scenario].find(x => x.request.period === request.period && x.request.day === request.day
    && JSON.stringify(x.request.clippedTo) === JSON.stringify(request.clippedTo));
  if (!entry) throw new Error('fixture not exported by Swift');
  return JSON.stringify(entry.response);
};
const source = (scenario = 'recorded') => ({ read: jest.fn(async (request: ReflectionRequest) => json(scenario, request)) });
const press = async (name: string) => fireEvent.press(screen.getByRole('button', { name }));

test('Swift-generated DTOs are bounded, scoped, and allowlisted without identity or body extras', () => {
  for (const entries of Object.values(fixtures)) for (const entry of entries) {
    const value = parseReflectionSnapshot(JSON.stringify(entry.response));
    expect(value.buckets.length).toBeLessThanOrEqual(value.period === 'week' ? 7 : 6);
    expect(value.trend.length).toBeLessThanOrEqual(64);
    if (value.proofScope === 'pointObservations') expect(value.total.knownSeconds).toBeUndefined();
  }
  const raw = JSON.parse(json()); raw.reason = 'private text'; raw.applicationToken = 'secret'; raw.total.body = 'private text';
  expect(JSON.stringify(parseReflectionSnapshot(JSON.stringify(raw)))).not.toContain('private text');
  expect(JSON.stringify(parseReflectionSnapshot(JSON.stringify(raw)))).not.toContain('secret');
});
test('rejects positive point observations, unsupported versions, impossible seconds and unbounded payload', () => {
  const raw = JSON.parse(json('observed')); raw.total.knownSeconds = 30;
  expect(() => parseReflectionSnapshot(JSON.stringify(raw))).toThrow('unqualified');
  const old = JSON.parse(json()); old.version = 0;
  expect(() => parseReflectionSnapshot(JSON.stringify(old))).toThrow('version');
  const large = JSON.parse(json()); large.buckets = Array(8).fill(large.buckets[0]);
  expect(() => parseReflectionSnapshot(JSON.stringify(large))).toThrow('bound');
  const invalid = JSON.parse(json()); invalid.total.knownSeconds = -1;
  expect(() => parseReflectionSnapshot(JSON.stringify(invalid))).toThrow('seconds');
  expect(() => parseReflectionSnapshot(' '.repeat(250_001))).toThrow('bound');
  expect(reflectionDuration(undefined)).toBe('—'); expect(reflectionDuration(0)).toBe('0分');
  expect(reflectionDuration(59)).toBe('1分未満'); expect(reflectionDuration(6900)).toBe('1時間55分');
});
test('keeps cumulative fixed while switching week/month and moving periods using native anchors', async () => {
  const client = source(); await render(<ReflectionPrototypePreview source={client} initialAnchor="2026-11-09" />);
  expect(await screen.findByText('この週の記録：1時間55分')).toBeTruthy();
  const total = screen.getByTestId('reflection-total').props.children;
  await press('月次'); expect(await screen.findByText('2026年11月')).toBeTruthy();
  expect(screen.getByTestId('reflection-total').props.children).toBe(total);
  expect(screen.queryByRole('button', { name: '全期間' })).toBeNull();
  await press('前の期間'); expect(await screen.findByText('2026年10月')).toBeTruthy();
  expect(screen.getByTestId('reflection-total').props.children).toBe(total);
  await press('週次'); expect(await screen.findByText('この週の記録：1時間55分')).toBeTruthy();
  await press('月次'); expect(await screen.findByText('2026年10月')).toBeTruthy();
  expect(client.read.mock.calls.slice(1).every(([r]) => Boolean(r.expectedToken))).toBe(true);
});
test('month row drills into its clipped week then selects a day without reason or identity in navigation', async () => {
  const onDay = jest.fn(), client = source();
  await render(<ReflectionPrototypePreview source={client} initialAnchor="2026-11-09" onDay={onDay} />);
  await screen.findByText('この週の記録：1時間55分'); await press('月次'); await screen.findByText('2026年11月');
  const row = screen.getAllByRole('button').find(node => String(node.props.accessibilityLabel).startsWith('11月2日、'))!;
  await fireEvent.press(row);
  await screen.findByText('11月2日からの週');
  const request = client.read.mock.calls.at(-1)![0];
  expect(request.clippedTo).toBeDefined(); expect(request.period).toBe('week');
  const dayRow = screen.getAllByRole('button').find(node => String(node.props.accessibilityLabel).startsWith('11月3日、'))!;
  await fireEvent.press(dayRow);
  expect(onDay.mock.calls[0][0]).toBe('2026-11-03');
  expect(onDay.mock.calls[0]).toHaveLength(2);
  expect(JSON.stringify(onDay.mock.calls)).not.toMatch(/reason|body|application|token=/);
});
test.each(['observed', 'notRecorded', 'deleted', 'zero', 'partial'])('distinguishes %s and always exposes prototype provenance', async scenario => {
  await render(<ReflectionPrototypePreview source={source(scenario)} initialAnchor="2026-11-09" />);
  await waitFor(() => expect(screen.queryByText('記録を確認しています。')).toBeNull());
  expect(screen.getByText('検証用プレビュー')).toBeTruthy();
  const expected = scenario === 'zero' ? '0分' : scenario === 'partial' ? reflectionDuration(parseReflectionSnapshot(json(scenario)).total.knownSeconds) : '—';
  expect(screen.getByTestId('reflection-total').props.children).toBe(expected);
  if (scenario === 'observed') expect(screen.getAllByText(/操作の観測だけでは/).length).toBeGreaterThan(0);
});
test('explicit refresh releases old token and typed changed failure does not cause permanent retry', async () => {
  let changed = false;
  const client = { read: jest.fn(async (request: ReflectionRequest) => {
    if (changed && request.expectedToken) throw new ReflectionPrototypeReadError('changed');
    return json('recorded', request);
  }) };
  await render(<ReflectionPrototypePreview source={client} initialAnchor="2026-11-09" />);
  await screen.findByText('この週の記録：1時間55分'); changed = true;
  await press('月次'); await screen.findByText('記録が更新されました');
  expect(screen.getByTestId('reflection-total').props.children).toBe('—');
  await press('最新の記録を確認する'); await screen.findByText('2026年11月');
  expect(client.read.mock.calls.at(-1)![0].expectedToken).toBeUndefined();
  await press('最新の記録を確認する'); await screen.findByText('2026年11月');
  expect(client.read.mock.calls.at(-1)![0].expectedToken).toBeUndefined();
});
test('malformed and synchronous source failures remain errors rather than empty history', async () => {
  let fail = true;
  const client: ReflectionPrototypeSource = { read: () => { if (fail) throw new Error('raw error stays private'); return Promise.resolve(json()); } };
  await render(<ReflectionPrototypePreview source={client} initialAnchor="2026-11-09" />);
  await screen.findByText('記録を読み取れませんでした');
  expect(screen.queryByText(/raw error stays private/)).toBeNull();
  fail = false; await press('最新の記録を確認する'); await screen.findByText('この週の記録：1時間55分');
});
test('source replacement hides old cumulative immediately and ignores a delayed old response', async () => {
  let resolve: ((value: string) => void) | undefined;
  const old = { read: jest.fn(() => new Promise<string>(r => { resolve = r; })) };
  const view = await render(<ReflectionPrototypePreview source={old} initialAnchor="2026-11-09" />);
  await view.rerender(<ReflectionPrototypePreview source={source('deleted')} initialAnchor="2026-11-09" />);
  await screen.findByText('記録は削除されています');
  await act(() => { resolve?.(json()); });
  expect(screen.getByTestId('reflection-total').props.children).toBe('—');
});
