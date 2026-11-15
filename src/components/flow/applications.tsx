import { requireNativeViewManager } from 'expo-modules-core';
import { type ComponentType, memo, useContext, useState } from 'react';
import { type ViewProps, StyleSheet, Text, View } from 'react-native';
import { useFlowTheme } from './ui';
import { ApplicationLabels, ApplicationSymbols } from '@/runtime/application-labels';

type Props = ViewProps & { selectionRef: string; targetRef: string; source: 'product'; refreshKey: number;
  selectable: boolean; selected: boolean; onSelect?: () => void; onContentSize: (event: { nativeEvent: { height: number } }) => void };
let native: ComponentType<Props> | undefined;
/** Identity display only. Apple tokens stay native; ApplicationChoice owns the selection interaction. */
export const Applications = memo(function Applications({ selectionRef, targetRef = '', count = 1, refreshKey }: {
  selectionRef: string; targetRef?: string; count?: number; refreshKey: number;
}) {
  const theme = useFlowTheme();
  const labels = useContext(ApplicationLabels), symbols = useContext(ApplicationSymbols);
  const [height, setHeight] = useState(Math.max(48, count * 56));
  const label = labels?.(selectionRef, targetRef);
  if (label) return <View style={styles.previewIdentity}>
    {!!symbols?.(selectionRef, targetRef) && <View accessible={false} accessibilityElementsHidden aria-hidden style={[styles.previewIcon, { backgroundColor: theme.background, borderColor: theme.line }]}>
      <Text style={{ color: theme.text, fontSize: 20 }}>{symbols(selectionRef, targetRef)}</Text>
    </View>}
    <Text style={[styles.previewName, { color: theme.text }]}>{label}</Text>
  </View>;
  try { native ??= requireNativeViewManager<Props>('ItomaNative'); } catch { /* Web/old binaries render a safe count only. */ }
  if (!native) return <Text style={{ color: theme.text, fontSize: 17 }}>選択したアプリ（{count}件）</Text>;
  const Native = native;
  return <Native source="product" selectionRef={selectionRef} targetRef={targetRef} refreshKey={refreshKey}
    selectable={false} selected={false} style={{ width: '100%', height }}
    onContentSize={({ nativeEvent }) => { if (Number.isFinite(nativeEvent.height) && nativeEvent.height > 0 && nativeEvent.height <= 30000) setHeight(Math.ceil(nativeEvent.height)); }} />;
});

const styles = StyleSheet.create({
  previewIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  previewIcon: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  previewName: { fontSize: 17, lineHeight: 26, flexShrink: 1 },
});
