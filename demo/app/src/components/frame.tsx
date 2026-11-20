import { type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useFlowTheme } from '@/components/flow/ui';
import { ProductNavigation, type ProductTab } from '@/components/flow/product-navigation';
import { HomeLayout } from '@/constants/theme';
export function Frame({ title, tab, children }: { title: string; tab: ProductTab; children: ReactNode }) {
  const theme = useFlowTheme();
  return <View style={{ flex: 1, backgroundColor: theme.surface }}><ScrollView testID="demo-scroll" contentContainerStyle={{ width: '100%', maxWidth: HomeLayout.maxWidth, alignSelf: 'center', paddingHorizontal: HomeLayout.gutter, paddingTop: 24, paddingBottom: 28, gap: 20 }}>
    <Text accessibilityRole="header" style={{ fontSize: 24, lineHeight: 36, fontWeight: '500', color: theme.text }}>{title}</Text>{children}
  </ScrollView><ProductNavigation current={tab} theme={theme} /></View>;
}
