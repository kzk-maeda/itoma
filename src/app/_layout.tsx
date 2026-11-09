import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { runNativeSmoke } from '@/qa/native-smoke';
import { ScreenTimeProvider } from '@/state/screen-time';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  useEffect(() => { runNativeSmoke(); }, []);
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <ScreenTimeProvider><Stack screenOptions={{ headerShown: false }} /></ScreenTimeProvider>
    </ThemeProvider>
  );
}
