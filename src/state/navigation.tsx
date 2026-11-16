import { router, useNavigationContainerRef, type NavigationState } from 'expo-router';
import { CommonActions } from 'expo-router/react-navigation';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { browsingState, defaultWorkReturn, destinationHref, type BrowseDestination, type NavigationTree, type ReturnContext, type WorkDestination } from '@/lib/navigation-state';

type Actions = { open: (destination: BrowseDestination) => void; start: (destination: WorkDestination, origin?: BrowseDestination) => void;
  finish: (destination: BrowseDestination) => void; close: (fallback?: BrowseDestination) => void; returnContext?: ReturnContext };
const Context = createContext<Actions | undefined>(undefined);
const preview: Actions = { open: destination => router.navigate(destinationHref(destination)), start: destination => router.navigate(destinationHref(destination)),
  finish: destination => router.dismissTo(destinationHref(destination)), close: destination => router.dismissTo(destinationHref(destination ?? { screen: 'index' })) };
export const useAppNavigation = () => useContext(Context) ?? preview;

/** Navigation owns only typed RAM return context. Domain Providers remain above all routes. */
export function AppNavigationProvider({ children }: { children: ReactNode }) {
  const navigation = useNavigationContainerRef(), [returnContext, setReturnContext] = useState<ReturnContext>();
  const open = useCallback((destination: BrowseDestination) => {
    if (!navigation.current?.isReady()) return;
    const current = navigation.current.getRootState();
    const next = browsingState(current as unknown as NavigationTree, destination);
    navigation.current.dispatch({ ...CommonActions.reset(next as NavigationState), target: current.key });
  }, [navigation]);
  const actions = useMemo<Actions>(() => ({ open, finish: open, returnContext,
    start: (destination, origin) => {
      if (origin) setReturnContext({ destination: origin });
      else if (!navigation.current?.getRootState().routes.some(route => route.name === '(work)')) setReturnContext({ destination: defaultWorkReturn(destination.screen) });
      router.navigate(destinationHref(destination));
    },
    close: fallback => open(returnContext?.destination ?? fallback ?? { screen: 'index' }),
  }), [navigation, open, returnContext]);
  return <Context.Provider value={actions}>{children}</Context.Provider>;
}
