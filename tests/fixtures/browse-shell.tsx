import type { ReactNode } from 'react';
import { ProductTabsProvider } from '../../src/state/product-tabs';
import { ProductNavigation } from '../../src/components/flow/product-navigation';
import { GraphiteColors } from '../../src/constants/theme';

/** Standalone component tests model the shared shell; real Router state is exercised separately. */
export function BrowseTestShell({ route, navigate, children }: { route: string; navigate: (path: '/' | '/reflection' | '/settings') => void; children: ReactNode }) {
  if (['/rule', '/rule-confirm', '/rule-details', '/unlock', '/unlock-confirm', '/onboarding'].includes(route)) return children;
  const tab = route.startsWith('/settings') ? 'settings' : ['/reflection', '/history', '/history-reason'].includes(route) ? 'reflection' : 'home';
  return <ProductTabsProvider current={tab} focused onSelect={next => navigate(next === 'home' ? '/' : next === 'reflection' ? '/reflection' : '/settings')}>
    {children}<ProductNavigation current={tab} theme={GraphiteColors.light} />
  </ProductTabsProvider>;
}
