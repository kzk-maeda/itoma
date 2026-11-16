import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { runNativeSmoke } from '@/qa/native-smoke';
import { ScreenTimeProvider } from '@/state/screen-time';
import { HistoryProvider } from '@/state/history';
import { ReflectionProvider } from '@/state/reflection';
import { OnboardingProvider } from '@/state/onboarding';
import { AppNavigationProvider } from '@/state/navigation';
import { rootNavigationRouter } from '@/lib/root-navigation';

SplashScreen.preventAutoHideAsync();
export const unstable_settings = { anchor: '(main)' };

export default function RootLayout() {
  const colorScheme = useColorScheme();
  useEffect(() => { runNativeSmoke(); }, []);
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <View style={{ flex: 1 }} onLayout={() => { void SplashScreen.hideAsync(); }}>
        <ScreenTimeProvider><OnboardingProvider><HistoryProvider><ReflectionProvider><AppNavigationProvider><Stack UNSTABLE_router={rootNavigationRouter} screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(main)" options={{ animation: 'none' }} />
          <Stack.Screen name="(work)" options={{ presentation: 'fullScreenModal', gestureEnabled: true }} />
        </Stack></AppNavigationProvider></ReflectionProvider></HistoryProvider></OnboardingProvider></ScreenTimeProvider>
      </View>
    </ThemeProvider>
  );
}
