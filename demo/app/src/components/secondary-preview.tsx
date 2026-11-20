import { router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { Body, Button, Heading, useFlowTheme } from '@/components/flow/ui';
import { ProductNavigation, type ProductTab } from '@/components/flow/product-navigation';
import { useDemo } from '../state/demo';

export function SecondaryPreview({ tab }: { tab: Exclude<ProductTab, 'home'> }) {
  const theme = useFlowTheme(), { scenario } = useDemo();
  return <View style={{ flex: 1, backgroundColor: theme.surface }}>
    <ScrollView contentContainerStyle={{ width: '100%', maxWidth: 480, alignSelf: 'center', padding: 24, gap: 24 }}>
      <Heading>{tab === 'settings' ? '設定' : '振り返り'}</Heading>
      <Body>このデモはホームの時間外表示を比較するものです。</Body>
      {tab === 'settings' && <View style={{ gap: 12 }}><Body>{scenario.title ?? '夜の自分時間'}</Body>
        <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 22 }}>ルールは架空の設定です。編集・保存は行いません。</Text></View>}
      <Button label="ホームに戻る" secondary onPress={() => router.dismissTo('/')} />
    </ScrollView>
    <ProductNavigation current={tab} theme={theme} />
  </View>;
}
