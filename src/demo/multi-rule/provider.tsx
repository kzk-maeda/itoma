import Constants from 'expo-constants';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, View, type AlertButton } from 'react-native';
import { createMultiRuleDemo, type ScenarioID } from './fixture';
import { MultiRuleContext } from './context';
import { DemoDialog, type DemoAlert } from './dialog';

/** Explicit Web demo only. Native always uses real ports and native Alerts. */
export function MultiRuleDemoProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(createMultiRuleDemo), [scenario, setScenario] = useState<ScenarioID>('overlap');
  const [dialog, setDialog] = useState<DemoAlert>();
  const runtime = useMemo(() => ({ ...controller, scenario, choose: (next: ScenarioID) => {
    controller.select(next); setScenario(next);
  } }), [controller, scenario]);
  const enabled = Platform.OS === 'web' && Constants.expoConfig?.extra?.multiRuleDemo === true;
  useEffect(() => {
    if (!enabled) return;
    const original = Alert.alert;
    // React Native Web has no native Alert. Keep its actual callbacks, but show an
    // asynchronous in-page confirmation so the shared discard guard can acknowledge it.
    Alert.alert = (title, message, buttons) => {
      const actions: AlertButton[] = buttons ?? [{ text: 'OK' }];
      setDialog({ title: title ?? '確認', message: message ?? undefined, actions });
    };
    return () => { Alert.alert = original; };
  }, [enabled]);
  return <MultiRuleContext.Provider value={enabled ? runtime : undefined}>
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }} aria-hidden={dialog ? true : undefined} pointerEvents={dialog ? 'none' : 'auto'}>{children}</View>
      {enabled && dialog && <DemoDialog dialog={dialog} choose={action => { setDialog(undefined); action.onPress?.(); }} />}
    </View>
  </MultiRuleContext.Provider>;
}
