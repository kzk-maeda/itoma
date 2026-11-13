import { AppState } from 'react-native';
import { controlSnapshots } from '../../modules/itoma-native/src/control-snapshot';
export { controlSnapshots, currentControlSnapshot, withControlSnapshots } from '../../modules/itoma-native/src/control-snapshot';

let consumers = 0;
const foreground = new Set<() => void>();
const background = new Set<() => void>();
let subscription: ReturnType<typeof AppState.addEventListener> | undefined;
/** Screen Time and onboarding share one lifecycle owner, even when mounted alone. */
export function retainControlSnapshotLifecycle(onActive: () => void, onInactive?: () => void) {
  foreground.add(onActive);
  if (onInactive) background.add(onInactive);
  if (consumers++ === 0) {
    controlSnapshots.setActive(AppState.currentState === 'active');
    subscription = AppState.addEventListener('change', state => {
      controlSnapshots.setActive(state === 'active');
      if (state === 'active') { for (const refresh of foreground) refresh(); }
      else { for (const flush of background) flush(); }
    });
  }
  return () => {
    foreground.delete(onActive);
    if (onInactive) background.delete(onInactive);
    if (--consumers === 0) {
      subscription?.remove(); subscription = undefined;
      // Lifecycle transitions cannot be observed while no consumer owns the listener.
      controlSnapshots.setActive(false);
    }
  };
}
