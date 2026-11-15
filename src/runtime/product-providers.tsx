import { type ReactNode } from 'react';
import type { screenTime, historyRecords, reflectionRecords, onboardingRecords } from '../../modules/itoma-native';
import { ScreenTimeProvider } from '@/state/screen-time';
import { HistoryProvider } from '@/state/history';
import { ReflectionProvider } from '@/state/reflection';
import { OnboardingProvider } from '@/state/onboarding';
import { ProductAlertHost } from './product-alert';

export type ProductClients = {
  screenTime: Pick<typeof screenTime, 'run'>;
  history: Pick<typeof historyRecords, 'run'>;
  reflection: Pick<typeof reflectionRecords, 'run'>;
  onboarding: Pick<typeof onboardingRecords, 'run'>;
};
/** One production provider tree; only the external ports may be supplied by a preview/test. */
export function ProductProviders({ children, clients }: { children: ReactNode; clients?: ProductClients }) {
  return <ScreenTimeProvider client={clients?.screenTime}><OnboardingProvider client={clients?.onboarding}>
    <HistoryProvider client={clients?.history}><ReflectionProvider client={clients?.reflection}>
      {children}<ProductAlertHost />
    </ReflectionProvider></HistoryProvider>
  </OnboardingProvider></ScreenTimeProvider>;
}
