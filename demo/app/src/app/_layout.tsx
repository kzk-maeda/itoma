import { Stack } from 'expo-router';
import { View } from 'react-native';
import { useFlowTheme } from '@/components/flow/ui';
import { DemoProvider } from '../state/demo';
import { DemoToolbar } from '../components/demo-toolbar';
export default function Layout() {
  const theme = useFlowTheme();
  return <DemoProvider><View style={{ flex: 1, backgroundColor: theme.surface }}><DemoToolbar /><Stack screenOptions={{ headerShown: false, animation: 'none', contentStyle: { backgroundColor: theme.surface } }} /></View></DemoProvider>;
}
