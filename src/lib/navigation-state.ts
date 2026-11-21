import type { Href } from 'expo-router';
import { productTabs, type ProductTab } from '@/components/flow/product-tab-model';

export type BrowseDestination = { screen: 'index' | 'grant' | 'reflection' | 'history' | 'history-reason' | 'settings' | 'settings-schedules' | 'settings-screen-time' | 'settings-records' | 'settings-storage' | 'settings-delete' | 'settings-about' | 'settings-support' }
  | { screen: 'settings-schedule'; ruleID?: string };
export type WorkDestination = { screen: 'rule' | 'rule-confirm' | 'unlock' | 'unlock-confirm' | 'onboarding' } | { screen: 'rule-details'; ruleID: string };
export type ReturnContext = { destination: BrowseDestination };
export type NavigationRoute = { key?: string; name: string; params?: Readonly<Record<string, unknown>>; state?: NavigationTree };
export type NavigationTree = { key?: string; index?: number; routes: readonly NavigationRoute[] };

export function appStack(root: NavigationTree): NavigationTree | undefined {
  let state: NavigationTree | undefined = root;
  while (state) {
    if (state.routes.some(item => item.name === '(main)' || item.name === '(work)')) return state;
    state = state.routes[state.index ?? 0]?.state;
  }
}

const route = (name: string): NavigationRoute => ({ name });
const browseScreens: BrowseDestination['screen'][] = ['index', 'grant', 'reflection', 'history', 'history-reason', 'settings', 'settings-schedules', 'settings-schedule', 'settings-screen-time', 'settings-records', 'settings-storage', 'settings-delete', 'settings-about', 'settings-support'];
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

/** Complete existing Stack state only; SDK58 RESET cannot complete partial navigator trees. */
export function canonicalStack(stack: NavigationTree, destination: BrowseDestination): NavigationTree | undefined {
  const { chain } = browsePath(destination);
  const active = stack.routes.slice(0, (stack.index ?? 0) + 1);
  if (active.length === chain.length && active.every((item, index) => sameRoute(item, chain[index]))) return;
  return { ...stack, index: chain.length - 1, routes: chain.map(value => active.find(old => sameRoute(old, value)) ?? value) };
}
export function activeBrowse(root: NavigationTree): { stack: NavigationTree; destination: BrowseDestination } | undefined {
  const app = appStack(root), main = app?.routes[app.index ?? 0];
  if (main?.name !== '(main)' || !main.state) return;
  const tab = main.state.routes[main.state.index ?? 0];
  if (!tab?.state?.key) return;
  const leaf = tab.state.routes[tab.state.index ?? 0];
  if (!leaf || !browseScreens.includes(leaf.name as BrowseDestination['screen'])) return;
  const destination = (leaf.name === 'settings-schedule' ? { screen: leaf.name, ruleID: typeof leaf.params?.ruleID === 'string' ? leaf.params.ruleID : undefined }
    : { screen: leaf.name }) as BrowseDestination;
  const owner = productTabs.find(item => item.route === tab.name);
  if (!owner || browsePath(destination).tab !== owner.key) return;
  return { stack: tab.state, destination };
}

export function destinationHref(destination: BrowseDestination | WorkDestination): Href {
  const pathname = destination.screen === 'index' ? '/' : `/${destination.screen}`;
  return 'ruleID' in destination ? { pathname, params: { ruleID: destination.ruleID } } as Href : pathname as Href;
}
export const defaultWorkReturn = (screen: WorkDestination['screen'] | undefined): BrowseDestination => screen?.startsWith('rule') ? { screen: 'settings-schedules' } : { screen: 'index' };
