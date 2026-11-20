import { StackRouter, isActionHandled, type StackNavigationState } from 'expo-router';
import { rootNavigationRouter } from '../src/lib/root-navigation';

const original = StackRouter({});
const extension = rootNavigationRouter(original);
const config = { routeNames: ['(main)', '(work)'], routeGetIdList: {} };
const initial: StackNavigationState<Record<string, object | undefined>> = { key: 'navigator:root', type: 'stack', stale: false, routeKeySeq: 2, index: 1,
  routeNames: config.routeNames, routes: [{ key: '(main):0', name: '(main)' }, { key: '(work):1', name: '(work)' }] };
test.each(['NAVIGATE', 'PUSH'] as const)('%s to a browsing deep link removes the work route so its native exit guard can intercept', type => {
  const result = extension.getStateForAction!(initial, { type, payload: { name: '(main)', params: { screen: '(settings)' } } }, config);
  expect(isActionHandled(result)).toBe(true);
  if (!isActionHandled(result)) throw Error('unhandled');
  expect(result.state.routes.map(route => route.name)).toEqual(['(main)']);
  expect(result.state.routes[0].key).toBe('(main):0');
  expect(result.state.routes.some(route => route.key === '(work):1')).toBe(false);
});
test('100 task/browse cycles retain one main shell and at most one task route', () => {
  let state = initial;
  for (let n = 0; n < 100; n++) {
    for (const name of ['(main)', '(work)']) {
      const result = extension.getStateForAction!(state, { type: 'NAVIGATE', payload: { name } }, config);
      if (!isActionHandled(result)) throw Error('unhandled');
      state = result.state as typeof initial;
      expect(state.routes).toHaveLength(name === '(main)' ? 1 : 2);
      expect(state.routes[0].key).toBe('(main):0');
    }
  }
});
