import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';
import { AppState } from 'react-native';
import { controlSnapshots } from '../modules/itoma-native/src/control-snapshot';

// Each fixture models a different native store; production uses one runtime session.
beforeEach(() => {
  controlSnapshots.reset();
  // jest-expo stubs this scalar as a function; UI fixtures explicitly run in foreground.
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true });
});

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);

// Keep the product TimeField/modal behavior; only the OS wheel is synthetic in Jest.
jest.mock('@expo/ui/swift-ui', () => ({
  Host: ({ children }: { children: React.ReactNode }) => children,
  DatePicker: (props: Record<string, unknown>) => require('react').createElement(require('react-native').View, { ...props, testID: 'native-time-picker' }),
}));
