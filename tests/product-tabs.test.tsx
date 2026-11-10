import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Animated, AppState, type AppStateStatus, Pressable, Text } from 'react-native';
import { ProductTabsProvider, useProductTabs } from '../src/state/product-tabs';
import type { ProductTab } from '../src/components/flow/product-tab-model';

let mockReduced = false;
jest.mock('../src/global.css', () => ({}));
jest.mock('../src/hooks/use-reduced-motion', () => ({ useReducedMotion: () => mockReduced }));

function Probe() {
  const tabs = useProductTabs()!;
  return <>
    <Text testID="state">{JSON.stringify({ target: tabs.frame.target, moving: tabs.frame.animate, active: tabs.active })}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="home" onPress={() => tabs.select('home')} />
    <Pressable accessibilityRole="button" accessibilityLabel="settings" onPress={() => tabs.select('settings')} />
  </>;
}
const state = () => JSON.parse(screen.getByTestId('state').props.children);

test('selected tab is a no-op; rapid switches cancel previous motion and ignore stale completion', async () => {
  mockReduced = false;
  const running: { stop: jest.Mock; complete?: (result: { finished: boolean }) => void }[] = [];
  const timing = jest.spyOn(Animated, 'timing').mockImplementation(() => {
    const task = { stop: jest.fn(), complete: undefined as ((result: { finished: boolean }) => void) | undefined };
    running.push(task);
    return { start: callback => { task.complete = callback; }, stop: task.stop, reset: jest.fn() };
  });
  const select = jest.fn();
  const tree = (tab: ProductTab) => <ProductTabsProvider current={tab} focused onSelect={select}><Probe /></ProductTabsProvider>;
  const view = await render(tree('home'));
  await fireEvent.press(screen.getByRole('button', { name: 'home' }));
  expect(select).not.toHaveBeenCalled(); expect(timing).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'settings' }));
  expect(select).toHaveBeenCalledWith('settings');
  await view.rerender(tree('settings'));
  expect(state()).toMatchObject({ target: 2, moving: true });
  await view.rerender(tree('reflection'));
  expect(running[0].stop).toHaveBeenCalled();
  await act(() => { running[0].complete?.({ finished: true }); });
  expect(state()).toMatchObject({ target: 1, moving: true });
  await act(() => { running.at(-1)!.complete?.({ finished: true }); });
  expect(state()).toMatchObject({ target: 1, moving: false });
  await view.unmount(); timing.mockRestore();
});

test('background, focus loss and Reduce Motion settle on the current page without replay on return', async () => {
  mockReduced = false;
  let change: ((state: AppStateStatus) => void) | undefined;
  const remove = jest.fn();
  const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => { change = handler; return { remove }; });
  const stop = jest.fn();
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue({ start: jest.fn(), stop, reset: jest.fn() });
  const tree = (tab: ProductTab, focused = true) => <ProductTabsProvider current={tab} focused={focused} onSelect={jest.fn()}><Probe /></ProductTabsProvider>;
  const view = await render(tree('home'));
  await view.rerender(tree('settings'));
  await act(() => { change?.('background'); });
  expect(stop).toHaveBeenCalled(); expect(state()).toEqual({ target: 2, moving: false, active: false });
  const started = timing.mock.calls.length;
  await act(() => { change?.('active'); });
  expect(state()).toEqual({ target: 2, moving: false, active: true });
  expect(timing).toHaveBeenCalledTimes(started);
  await view.rerender(tree('reflection'));
  await view.rerender(tree('reflection', false));
  expect(state()).toEqual({ target: 1, moving: false, active: false });
  await view.rerender(tree('reflection'));
  await view.rerender(tree('home'));
  mockReduced = true; await view.rerender(tree('home'));
  expect(state()).toEqual({ target: 0, moving: false, active: true });
  const beforeReduced = timing.mock.calls.length;
  await view.rerender(tree('settings'));
  expect(state()).toMatchObject({ target: 2, moving: false });
  expect(timing).toHaveBeenCalledTimes(beforeReduced);
  await view.unmount(); expect(remove).toHaveBeenCalledTimes(1);
  timing.mockRestore(); listener.mockRestore();
});
