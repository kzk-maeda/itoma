import { router } from 'expo-router';
import { View } from 'react-native';
import { Body, Button, useFlowTheme } from '@/components/flow/ui';
import { OpenCircle } from '@/components/home/open-circle';
import { Frame } from '../components/frame';
export default function Home() {
  const theme = useFlowTheme();
  return <Frame title="いとま" tab="home"><View style={{ paddingVertical: 24 }}><OpenCircle color={theme.accent} size={48} /></View><Body>振り返りの累計と、期間ごとの記録を確認できます。</Body><Button label="振り返りを見る" onPress={() => router.navigate('/reflection')} /></Frame>;
}
