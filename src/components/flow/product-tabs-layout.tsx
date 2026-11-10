import { useIsFocused } from 'expo-router';
import { TabSlot, type TabsDescriptor, type TabsSlotRenderOptions, useTabTrigger, useTabsWithTriggers } from 'expo-router/ui';
import { type ReactNode } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProductTabsProvider, useProductTabs } from '@/state/product-tabs';
import { productTabFromRoute, productTabIndex, productTabs, type ProductTab } from './product-tab-model';
import { ProductNavigation } from './product-navigation';
import { useFlowTheme } from './ui';

const triggers = productTabs.map(tab => ({ type: 'internal' as const, name: tab.key, href: tab.href, activityEnabled: false }));
export function ProductTabsLayout() {
  const { state, NavigationContent } = useTabsWithTriggers({ triggers, backBehavior: 'none', activityEnabled: false });
  const current = productTabFromRoute(state.routes[state.index].name);
  return <NavigationContent><TabsFrame current={current} /></NavigationContent>;
}
function TabsFrame({ current }: { current: ProductTab }) {
  const focused = useIsFocused(), { switchTab } = useTabTrigger({ name: 'home' });
  return <ProductTabsProvider current={current} focused={focused} onSelect={tab => switchTab(tab, { resetOnFocus: false })}>
    <TabsSurface />
  </ProductTabsProvider>;
}
function TabsSurface() {
  const motion = useProductTabs()!, theme = useFlowTheme();
  return <SafeAreaView style={[styles.surface, { backgroundColor: theme.surface }]}>
    <View testID="product-tab-viewport" style={styles.viewport} onLayout={event => motion.setWidth(event.nativeEvent.layout.width)}>
      <TabSlot detachInactiveScreens={false} renderFn={renderTab} style={styles.viewport} />
    </View>
    <ProductNavigation current={motion.current} theme={theme} />
  </SafeAreaView>;
}
function renderTab(descriptor: TabsDescriptor, options: TabsSlotRenderOptions) {
  return <ProductTabScene tab={productTabFromRoute(descriptor.route.name)} focused={options.isFocused} loaded={options.loaded}>
    {descriptor.render()}
  </ProductTabScene>;
}
export function ProductTabScene({ tab, focused, loaded, children }: { tab: ProductTab; focused: boolean; loaded: boolean; children: ReactNode }) {
  const motion = useProductTabs()!, index = productTabIndex(tab);
  if (!loaded && !focused) return null;
  return <Animated.View testID={`product-tab-scene-${tab}`} pointerEvents={focused ? 'auto' : 'none'}
    accessibilityElementsHidden={!focused} importantForAccessibility={focused ? 'auto' : 'no-hide-descendants'} aria-hidden={!focused}
    style={[styles.scene, { zIndex: focused ? 1 : 0, opacity: motion.frame.visible[index] ? 1 : 0, transform: [{ translateX: motion.clock.interpolate({ inputRange: [0, 1],
      outputRange: [motion.frame.starts[index] * motion.width, motion.frame.ends[index] * motion.width] }) }] }]}>
    {children}
  </Animated.View>;
}
const styles = StyleSheet.create({ surface: { flex: 1 }, viewport: { flex: 1, overflow: 'hidden' }, scene: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } });
