import type { Href } from 'expo-router';
import { productTabs, type ProductTab } from '@/components/flow/product-tab-model';

export type BrowseDestination = { screen: 'index' | 'grant' | 'reflection' | 'history' | 'history-reason' | 'settings' | 'settings-schedules' | 'settings-screen-time' | 'settings-records' | 'settings-storage' | 'settings-delete' | 'settings-about' }
  | { screen: 'settings-schedule'; ruleID: string };
export type WorkDestination = { screen: 'rule' | 'rule-confirm' | 'unlock' | 'unlock-confirm' | 'onboarding' } | { screen: 'rule-details'; ruleID: string };
export type ReturnContext = { destination: BrowseDestination };
export type NavigationRoute = { key?: string; name: string; params?: Readonly<Record<string, unknown>>; state?: NavigationTree };
export type NavigationTree = { key?: string; index?: number; routes: readonly NavigationRoute[] };

const route = (name: string): NavigationRoute => ({ name });
export function browsePath(destination: BrowseDestination) {
  const root = destination.screen === 'index' || destination.screen === 'grant' ? 'home'
    : ['reflection', 'history', 'history-reason'].includes(destination.screen) ? 'reflection' : 'settings';
  const chain = [route(root === 'home' ? 'index' : root)];
  if (destination.screen === chain[0].name) return { tab: root as ProductTab, chain };
  if (destination.screen === 'settings-schedule') chain.push(route('settings-schedules'), { name: destination.screen, params: { ruleID: destination.ruleID } });
  else if (destination.screen === 'settings-storage' || destination.screen === 'settings-delete') chain.push(route('settings-records'), route(destination.screen));
  else if (destination.screen === 'history-reason') chain.push(route('history'), route(destination.screen));
  else chain.push(route(destination.screen));
  return { tab: root as ProductTab, chain };
}
const sameRoute = (a: NavigationRoute, b: NavigationRoute) => a.name === b.name && a.params?.ruleID === b.params?.ruleID;

/** Rebuild only the destination's logical parents. Other tabs retain their exact state/keys. */
export function browsingState(root: NavigationTree, destination: BrowseDestination): NavigationTree {
  const { tab, chain } = browsePath(destination), target = productTabs.findIndex(item => item.key === tab);
  const main = root.routes.find(item => item.name === '(main)') ?? route('(main)');
  const previous = main.state;
  const tabs = productTabs.map((item, index) => {
    const existing = previous?.routes.find(value => value.name === item.route) ?? route(item.route);
    if (index !== target) return existing;
    const oldRoutes = existing.state?.routes ?? [];
    return { ...existing, state: { ...existing.state, index: chain.length - 1,
      routes: chain.map(value => oldRoutes.find(old => sameRoute(old, value)) ?? value) } };
  });
  return { ...root, index: 0, routes: [{ ...main, state: { ...previous, index: target, routes: tabs } }] };
}

export function destinationHref(destination: BrowseDestination | WorkDestination): Href {
  const pathname = destination.screen === 'index' ? '/' : `/${destination.screen}`;
  return 'ruleID' in destination ? { pathname, params: { ruleID: destination.ruleID } } as Href : pathname as Href;
}
export const defaultWorkReturn = (screen: WorkDestination['screen']): BrowseDestination => screen.startsWith('rule') ? { screen: 'settings-schedules' } : { screen: 'index' };
