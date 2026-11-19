import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { Animated, PanResponder, type PanResponderCallbacks, Text } from 'react-native';
import { RuleDeck } from '../src/components/home/rule-deck';

jest.mock('../src/global.css', () => ({}));
let mockReduced = true;
jest.mock('../src/hooks/use-reduced-motion', () => ({ useReducedMotion: () => mockReduced }));
let gesture: PanResponderCallbacks;
let finish: ((result: { finished: boolean }) => void) | undefined;
let mounted: string[];
function Card({ id }: { id: string }) { useEffect(() => { mounted.push(id); return () => { mounted.splice(mounted.indexOf(id), 1); }; }, [id]); return <Text>{id}本文</Text>; }
function Deck({ ids = ['a', 'b', 'c'] }: { ids?: string[] }) {
  const [selected, setSelected] = useState<string>();
  return <RuleDeck items={ids.map(id => ({ id, title: id, content: <Card id={id} /> }))} selectedID={selected} onSelect={setSelected} />;
}
beforeEach(() => {
  mockReduced = true; mounted = []; finish = undefined;
  const original = PanResponder.create;
  jest.spyOn(PanResponder, 'create').mockImplementation(config => { gesture = config; return original(config); });
  jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start: callback => { finish = callback; }, stop: jest.fn(), reset: jest.fn() }));
  jest.spyOn(Animated, 'spring').mockImplementation(() => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() }));
});
afterEach(() => jest.restoreAllMocks());
async function drag(dx: number, dy = 0, vx = 0) {
  await act(async () => {
    const event = {} as never, state = { dx, dy, vx } as never;
    if (gesture.onMoveShouldSetPanResponder?.(event, state)) { gesture.onPanResponderGrant?.(event, state); gesture.onPanResponderMove?.(event, state); gesture.onPanResponderRelease?.(event, state); }
  });
}
test('single/empty decks omit switching controls, and only the active card body mounts', async () => {
  const view = await render(<Deck ids={['a']} />);
  expect(screen.queryByRole('button', { name: '次のルール' })).toBeNull(); expect(mounted).toEqual(['a']);
  await view.rerender(<Deck ids={[]} />); expect(mounted).toEqual([]); expect(screen.queryByTestId('rule-deck')).toBeNull();
});
test('static swipes/buttons agree, cannot wrap, ignore vertical/small/cancelled gestures, and 100 round trips retain one card', async () => {
  const view = await render(<Deck />);
  expect(screen.getByRole('button', { name: '前のルール' })).toBeDisabled(); expect(mounted).toEqual(['a']);
  await drag(-80, 90); await drag(-15); expect(screen.getByText('a本文')).toBeTruthy();
  await drag(-100); expect(screen.getByText('b本文')).toBeTruthy(); expect(screen.queryByText('a本文')).toBeNull(); expect(mounted).toEqual(['b']);
  await act(async () => gesture.onPanResponderTerminate?.({} as never, {} as never)); expect(screen.getByText('b本文')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: '次のルール' })); await drag(-100);
  expect(screen.getByText('c本文')).toBeTruthy(); expect(screen.getByRole('button', { name: '次のルール' })).toBeDisabled();
  for (let i = 0; i < 100; i++) { await drag(100); await drag(-100); }
  expect(mounted).toEqual(['c']); expect(Animated.timing).not.toHaveBeenCalled();
  await view.unmount(); expect(mounted).toEqual([]);
});
test('selection follows identity on reorder, normalizes removal, and does not resurrect when the old card returns', async () => {
  const view = await render(<Deck />); await drag(-100); expect(screen.getByText('b本文')).toBeTruthy();
  await view.rerender(<Deck ids={['c', 'b', 'a']} />); expect(screen.getByText('b本文')).toBeTruthy();
  await view.rerender(<Deck ids={['c', 'a']} />); expect(screen.getByText('c本文')).toBeTruthy();
  await view.rerender(<Deck ids={['c', 'b', 'a']} />); expect(screen.getByText('c本文')).toBeTruthy();
});
test('an outgoing card disappearing during animation cannot select a stale destination; a cancelled animation stays put', async () => {
  mockReduced = false;
  const view = await render(<Deck />); await drag(-100);
  expect(screen.getByText('a本文')).toBeTruthy(); expect(screen.getByRole('button', { name: '次のルール' })).toBeDisabled();
  const oldFinish = finish;
  await view.rerender(<Deck ids={['c', 'b']} />);
  await act(async () => oldFinish?.({ finished: true })); expect(screen.getByText('c本文')).toBeTruthy();
  await drag(-100); await act(async () => finish?.({ finished: false })); expect(screen.getByText('c本文')).toBeTruthy();
  await drag(-100); await act(async () => finish?.({ finished: true })); expect(screen.getByText('b本文')).toBeTruthy();
});
