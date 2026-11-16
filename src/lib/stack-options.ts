import type { NativeStackNavigatorProps } from 'expo-router';

/** Standard iOS edge back, also on iOS 26+ where full-width swipes can default on. */
export const edgeBackOptions = {
  headerShown: false,
  gestureEnabled: true,
  gestureDirection: 'horizontal',
  fullScreenGestureEnabled: false,
} satisfies NonNullable<NativeStackNavigatorProps['screenOptions']>;
