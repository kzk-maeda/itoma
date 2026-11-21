import { Stack, usePathname } from 'expo-router';
import { View } from 'react-native';
import { useFlowTheme } from '@/components/flow/ui';
import { DemoProvider } from '../state/demo';
import { DemoToolbar } from '../components/demo-toolbar';
import { GrowthProvider } from '../state/time-growth';
import { viewOptions } from '../scenarios/visual-options';
export default function Layout() {
  const theme = useFlowTheme(), path = usePathname(), legacy = viewOptions.some(option => path.endsWith(option.path));
  return <DemoProvider><GrowthProvider><View style={{ flex: 1, backgroundColor: theme.surface }}>{legacy ? <DemoToolbar /> : null}<Stack screenOptions={{ headerShown: false, animation: 'none', contentStyle: { backgroundColor: theme.surface } }} /></View></GrowthProvider></DemoProvider>;
}
