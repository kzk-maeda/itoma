import { requireNativeViewManager } from 'expo-modules-core';
import { type ComponentType, memo, useState } from 'react';
import { type ViewProps, Pressable, Text, View } from 'react-native';
import { useFlowTheme } from './ui';
import { useMultiRuleDemo } from '@/demo/multi-rule/context';
import { demoAppIdentity } from '@/demo/multi-rule/fixture';

type Props = ViewProps & { selectionRef: string; targetRef: string; source: 'product'; refreshKey: number;
  selectable: boolean; selected: boolean; onSelect?: () => void; onContentSize: (event: { nativeEvent: { height: number } }) => void };
let native: ComponentType<Props> | undefined;
/** Apple provides both the visible app identity and its accessible button name. Events are bools. */
export const Applications = memo(function Applications({ selectionRef, targetRef = '', count = 1, refreshKey, selected = false, onSelect }: {
  selectionRef: string; targetRef?: string; count?: number; refreshKey: number; selected?: boolean; onSelect?: () => void;
}) {
  const theme = useFlowTheme(), demo = useMultiRuleDemo();
  const [height, setHeight] = useState(Math.max(48, count * 56));
  if (demo) {
    const apps = demoAppIdentity(selectionRef, targetRef);
    const identity = <View style={{ gap: 8 }}>{apps.map(app => <View key={app.name} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View accessible={false} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: theme.soft }}><Text style={{ fontSize: 22, color: theme.text }}>{app.glyph}</Text></View>
      <Text style={{ flex: 1, color: theme.text, fontSize: 17, lineHeight: 25 }}>{app.name}</Text>
      {onSelect && <Text accessible={false} style={{ fontSize: 22, color: theme.text }}>{selected ? '●' : '○'}</Text>}
    </View>)}</View>;
    return onSelect ? <Pressable accessibilityRole="radio" accessibilityLabel={apps.map(app => app.name).join('、')} accessibilityState={{ selected }} onPress={onSelect} style={{ minHeight: 48 }}>{identity}</Pressable> : identity;
  }
  try { native ??= requireNativeViewManager<Props>('ItomaNative'); } catch { /* Web/old binaries render a safe count only. */ }
  if (!native) return onSelect ? <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onSelect} style={{ minHeight: 48, justifyContent: 'center' }}>
    <Text style={{ color: theme.text, fontSize: 17 }}>{selected ? '✓ ' : ''}選択したアプリ（{count}件）</Text>
  </Pressable> : <Text style={{ color: theme.text, fontSize: 17 }}>選択したアプリ（{count}件）</Text>;
  const Native = native;
  return <Native source="product" selectionRef={selectionRef} targetRef={targetRef} refreshKey={refreshKey}
    selectable={!!onSelect && !!targetRef} selected={selected} onSelect={onSelect} style={{ width: '100%', height }}
    onContentSize={({ nativeEvent }) => { if (Number.isFinite(nativeEvent.height) && nativeEvent.height > 0 && nativeEvent.height <= 30000) setHeight(Math.ceil(nativeEvent.height)); }} />;
});
