import { type ReactNode } from 'react';
import { ProductProviders } from './product-providers';
import { DemoProviders } from '@/demo/demo-providers';

/** A URL/query cannot enable the simulator in an ordinary build. */
export function AppProviders({ children }: { children: ReactNode }) {
  return process.env.EXPO_PUBLIC_ITOMA_DEMO === '1'
    ? <DemoProviders>{children}</DemoProviders>
    : <ProductProviders>{children}</ProductProviders>;
}
