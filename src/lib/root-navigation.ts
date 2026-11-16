import type { NativeStackNavigatorProps } from 'expo-router';

/** A browse link reuses the single main shell and removes the task modal, so its exit guard runs. */
export const rootNavigationRouter: NonNullable<NativeStackNavigatorProps['UNSTABLE_router']> = original => ({
  getStateForAction(state, action, options) {
    if ((action.type === 'NAVIGATE' || action.type === 'PUSH') && action.payload && 'name' in action.payload
      && action.payload.name === '(main)' && state.routes.some(route => route.name === '(main)')) {
      return original.getStateForAction(state, { ...action, type: 'NAVIGATE', payload: { ...action.payload, pop: true } } as typeof action, options);
    }
    return original.getStateForAction(state, action, options);
  },
});
