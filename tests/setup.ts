import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);

// Keep the product TimeField/modal behavior; only the OS wheel is synthetic in Jest.
jest.mock('@expo/ui/swift-ui', () => ({
  Host: ({ children }: { children: React.ReactNode }) => children,
  DatePicker: (props: Record<string, unknown>) => require('react').createElement(require('react-native').View, { ...props, testID: 'native-time-picker' }),
}));
