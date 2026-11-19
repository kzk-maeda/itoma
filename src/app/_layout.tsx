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
import { edgeBackOptions } from '@/lib/stack-options';
import { MultiRuleDemoProvider } from '@/demo/multi-rule/provider';
import { useMultiRuleDemo } from '@/demo/multi-rule/context';
import { MultiRuleDemoToolbar } from '@/demo/multi-rule/toolbar';

SplashScreen.preventAutoHideAsync();
export const unstable_settings = { anchor: '(main)' };

export default function RootLayout() {
  const colorScheme = useColorScheme();
  useEffect(() => { runNativeSmoke(); }, []);
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <MultiRuleDemoProvider><Application /></MultiRuleDemoProvider>
    </ThemeProvider>
  );
}

function Application() {
  const demo = useMultiRuleDemo();
  return (
      <View style={{ flex: 1 }} onLayout={() => { void SplashScreen.hideAsync(); }}>
        <ScreenTimeProvider client={demo?.client}><OnboardingProvider client={demo?.onboarding}><HistoryProvider><ReflectionProvider><AppNavigationProvider><MultiRuleDemoToolbar /><Stack UNSTABLE_router={rootNavigationRouter} screenOptions={edgeBackOptions}>
          <Stack.Screen name="(main)" options={{ animation: 'none' }} />
          <Stack.Screen name="(work)" options={{ presentation: 'card' }} />
        </Stack></AppNavigationProvider></ReflectionProvider></HistoryProvider></OnboardingProvider></ScreenTimeProvider>
      </View>
  );
}
