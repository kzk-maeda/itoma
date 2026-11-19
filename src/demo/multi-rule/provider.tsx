import Constants from 'expo-constants';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, type AlertButton } from 'react-native';
import { createMultiRuleDemo, type ScenarioID } from './fixture';
import { MultiRuleContext } from './context';

/** Opt-in is only present in this branch's static demo build. Native always uses the real ports. */
export function MultiRuleDemoProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(createMultiRuleDemo), [scenario, setScenario] = useState<ScenarioID>('overlap');
  const runtime = useMemo(() => ({ ...controller, scenario, choose: (next: ScenarioID) => {
    controller.select(next); setScenario(next);
  } }), [controller, scenario]);
  const enabled = Platform.OS === 'web' && Constants.expoConfig?.extra?.multiRuleDemo === true;
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    // React Native Web has no native Alert. Map its callbacks to a browser confirmation
    // only in this explicit demo, preserving the real workflow's discard acknowledgement.
    const original = Alert.alert;
    Alert.alert = (title, message, buttons) => {
      const actions: AlertButton[] = buttons ?? [{ text: 'OK' }];
      const accepted = window.confirm([title, message].filter(Boolean).join('\n'));
      const action = accepted ? actions.filter(action => action.style !== 'cancel').at(-1)
        : actions.find(action => action.style === 'cancel');
      action?.onPress?.();
    };
    return () => { Alert.alert = original; };
  }, [enabled]);
  return <MultiRuleContext.Provider value={enabled ? runtime : undefined}>{children}</MultiRuleContext.Provider>;
}
