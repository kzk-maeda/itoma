import { router, useNavigationContainerRef, useRootNavigationState, type NavigationState } from 'expo-router';
import { CommonActions } from 'expo-router/react-navigation';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { activeBrowse, appStack, canonicalStack, defaultWorkReturn, destinationHref, type BrowseDestination, type NavigationTree, type ReturnContext, type WorkDestination } from '@/lib/navigation-state';

type Actions = { open: (destination: BrowseDestination) => void; start: (destination: WorkDestination, origin?: BrowseDestination) => void;
  finish: (destination: BrowseDestination) => void; close: (fallback?: BrowseDestination) => void; stepBack: (fallback: BrowseDestination) => void; returnContext?: ReturnContext };
const Context = createContext<Actions | undefined>(undefined);
const preview: Actions = { open: destination => router.navigate(destinationHref(destination)), start: destination => router.navigate(destinationHref(destination)),
  finish: destination => router.dismissTo(destinationHref(destination)), close: destination => router.dismissTo(destinationHref(destination ?? { screen: 'index' })), stepBack: () => router.back() };
export const useAppNavigation = () => useContext(Context) ?? preview;

/** Navigation owns only typed RAM return context. Domain Providers remain above all routes. */
export function AppNavigationProvider({ children }: { children: ReactNode }) {
  const navigation = useNavigationContainerRef(), root = useRootNavigationState(), [returnContext, setReturnContext] = useState<ReturnContext>();
  useEffect(() => {
    if (!root || !navigation.current?.isReady()) return;
    const current = activeBrowse(root as unknown as NavigationTree);
    if (!current) return;
    const next = canonicalStack(current.stack, current.destination);
    if (next) navigation.current.dispatch({ ...CommonActions.reset(next as NavigationState), target: current.stack.key });
  }, [root, navigation]);
  const open = useCallback((destination: BrowseDestination) => {
    const root = navigation.current?.getRootState(), state = root && appStack(root as unknown as NavigationTree);
    if (state?.routes.some(route => route.name === '(work)')) router.dismissTo(destinationHref(destination), { withAnchor: true });
    else router.navigate(destinationHref(destination), { withAnchor: true });
  }, [navigation]);
  const actions = useMemo<Actions>(() => ({ open, finish: destination => router.dismissTo(destinationHref(destination), { withAnchor: true }), returnContext,
    start: (destination, origin) => {
      if (origin) setReturnContext({ destination: origin });
      else {
        const root = navigation.current?.getRootState();
        if (!root || !appStack(root as unknown as NavigationTree)?.routes.some(route => route.name === '(work)')) setReturnContext({ destination: defaultWorkReturn(destination.screen) });
      }
      router.navigate(destinationHref(destination));
    },
    close: fallback => router.dismissTo(destinationHref(returnContext?.destination ?? fallback ?? { screen: 'index' }), { withAnchor: true }),
    stepBack: fallback => {
      const root = navigation.current?.getRootState(), work = root && appStack(root as unknown as NavigationTree)?.routes.find(route => route.name === '(work)');
      if ((work?.state?.index ?? 0) > 0) router.back();
      else router.dismissTo(destinationHref(returnContext?.destination ?? fallback), { withAnchor: true });
    },
  }), [navigation, open, returnContext]);
  return <Context.Provider value={actions}>{children}</Context.Provider>;
}
