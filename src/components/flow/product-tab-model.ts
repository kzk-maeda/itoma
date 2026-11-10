export const productTabs = [
  { key: 'home', route: 'index', label: 'ホーム', href: '/' },
  { key: 'reflection', route: 'reflection', label: '振り返り', href: '/reflection' },
  { key: 'settings', route: 'settings', label: '設定', href: '/settings' },
] as const;
export type ProductTab = (typeof productTabs)[number]['key'];
export const productTabIndex = (tab: ProductTab) => productTabs.findIndex(value => value.key === tab);
export function productTabFromRoute(route: string): ProductTab {
  const tab = productTabs.find(value => value.route === route);
  if (!tab) throw new Error('Unknown product tab route');
  return tab.key;
}

export type TabFrame = {
  bank: 0 | 1; target: number; animate: boolean;
  starts: number[]; ends: number[]; fromTab: number; toTab: number;
  visible: boolean[];
};
const slots = (index: number) => productTabs.map((_, n) => Math.sign(n - index));
const mix = (start: number, end: number, progress: number) => start + (end - start) * progress;
export function settledTabFrame(index: number, bank: 0 | 1 = 0): TabFrame {
  return { bank, target: index, animate: false, starts: slots(index), ends: slots(index), fromTab: index, toTab: index, visible: productTabs.map((_, n) => n === index) };
}
/** Continue from the actual painted positions, including an interrupted non-adjacent jump. */
export function nextTabFrame(previous: TabFrame, progress: number, index: number, animate: boolean): TabFrame {
  const bank = previous.bank === 0 ? 1 : 0;
  if (!animate || previous.target === index) return settledTabFrame(index, bank);
  const at = Math.min(1, Math.max(0, progress));
  const painted = previous.starts.map((start, n) => mix(start, previous.ends[n], at));
  const outgoing = previous.visible.map((visible, n) => visible && Math.abs(painted[n]) < 0.99999);
  const interrupted = outgoing.filter(Boolean).length > 1;
  const direction = Math.sign(index - previous.target);
  const starts = painted.map((value, n) => outgoing[n] ? value : n === index ? direction : Math.sign(n - index));
  // When interrupted, keep the already painted composite behind the incoming page. This avoids gaps.
  const ends = starts.map((value, n) => n === index ? 0 : outgoing[n] && !interrupted ? value - direction : value);
  return { bank, target: index, animate: true, starts, ends,
    fromTab: mix(previous.fromTab, previous.toTab, at), toTab: index, visible: outgoing.map((visible, n) => visible || n === index) };
}
