import { render, screen } from '@testing-library/react-native';
import { Animated, Text } from 'react-native';
import { PeriodTransition } from '../src/components/flow/period-transition';
jest.mock('../src/global.css', () => ({}));

test('period motion does not queue on data updates, and Reduce Motion interrupts an active slide', async () => {
  const running: { start: jest.Mock; stop: jest.Mock; reset: jest.Mock }[] = [];
  const timing = jest.spyOn(Animated, 'timing').mockImplementation(() => {
    const animation = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() }; running.push(animation); return animation;
  });
  const tree = (key: string, reduced = false) => <PeriodTransition transitionKey={key} direction={1} reduced={reduced} busy={false}><Text>{key}</Text></PeriodTransition>;
  const view = await render(tree('November'));
  expect(timing).not.toHaveBeenCalled();
  await view.rerender(tree('December'));
  expect(timing).toHaveBeenCalledTimes(2);
  await view.rerender(tree('December'));
  expect(timing).toHaveBeenCalledTimes(2);
  await view.rerender(tree('December', true));
  expect(running.every(animation => animation.stop.mock.calls.length > 0)).toBe(true);
  expect(screen.getByText('December')).toBeTruthy();
  await view.rerender(tree('January', true));
  expect(timing).toHaveBeenCalledTimes(2);
  expect(screen.getByText('January')).toBeTruthy();
  await view.unmount(); timing.mockRestore();
});
