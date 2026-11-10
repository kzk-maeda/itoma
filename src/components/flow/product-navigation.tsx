import { router } from 'expo-router';
import { useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { type GraphiteTheme, HomeLayout } from '@/constants/theme';
import { useProductTabs } from '@/state/product-tabs';
import { productTabIndex, productTabs, type ProductTab } from './product-tab-model';

export type { ProductTab } from './product-tab-model';

/** The hosted navigator shares its animation clock with the scenes; standalone previews keep links. */
export function ProductNavigation({ current, theme }: { current: ProductTab; theme: GraphiteTheme }) {
  const motion = useProductTabs(), [width, setWidth] = useState(0);
  const tabWidth = Math.max(0, (width - HomeLayout.gutter * 2 - 16) / 3), step = tabWidth + 8;
  return <View style={[styles.container, { backgroundColor: theme.surface, borderColor: theme.line }]}>
    <View testID="product-tab-bar" accessibilityRole="tablist" style={styles.tabs} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 && <Animated.View testID="product-tab-indicator" pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={[styles.indicator, { width: tabWidth, backgroundColor: theme.soft, transform: [{ translateX: motion
          ? motion.clock.interpolate({ inputRange: [0, 1], outputRange: [motion.frame.fromTab * step, motion.frame.toTab * step] })
          : productTabIndex(current) * step }] }]} />}
      {productTabs.map(({ key: tab, label }) => {
        const selected = current === tab;
        return <Pressable key={tab} accessibilityRole="tab" accessibilityLabel={label}
          accessibilityState={{ selected }} aria-selected={selected} onPress={() => {
            if (selected) return;
            if (motion) { motion.select(tab); return; }
            if (tab === 'home') router.dismissTo('/'); else router.navigate(tab === 'reflection' ? '/reflection' : '/settings');
          }} style={({ pressed }) => [styles.tab, { backgroundColor: width === 0 && selected ? theme.soft : 'transparent', opacity: pressed ? 0.75 : 1 }]}>
          <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={selected ? theme.text : theme.muted} strokeWidth={1.6}>
              {tab === 'home' ? <Path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9" strokeLinejoin="round" />
                : tab === 'reflection' ? <><Rect x={4} y={5} width={16} height={16} rx={2} /><Path d="M8 3v5m8-5v5M4 11h16M8 15h3m2 0h3M8 18h3" /></>
                  : <><Path d="M3 6h18M3 12h18M3 18h18" /><Circle cx={8} cy={6} r={2} fill={theme.surface} /><Circle cx={16} cy={12} r={2} fill={theme.surface} /><Circle cx={10} cy={18} r={2} fill={theme.surface} /></>}
            </Svg>
          </View>
          <Text style={[styles.label, { color: selected ? theme.text : theme.muted }]}>{label}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: { borderTopWidth: 1 },
  tabs: { width: '100%', maxWidth: HomeLayout.maxWidth, alignSelf: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: HomeLayout.gutter, paddingVertical: 8 },
  indicator: { position: 'absolute', left: HomeLayout.gutter, top: 8, bottom: 8, borderRadius: 12 },
  tab: { flex: 1, minHeight: 54, padding: 8, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 12 },
  label: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
