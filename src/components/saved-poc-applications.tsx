import { requireNativeViewManager } from 'expo-modules-core';
import { type ComponentType, useState } from 'react';
import { Text, type ViewProps } from 'react-native';

import { GraphiteColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { supportsSavedSelectionUI } from '../../modules/itoma-native';

type Props = ViewProps & {
  selectionRef: string;
  refreshKey: number;
  onContentSize?: (event: { nativeEvent: { height: number } }) => void;
};
let nativeView: ComponentType<Props> | undefined;

/** References and numeric layout only; app names and icons are rendered entirely by Apple. */
export function SavedPoCApplications({ selectionRef, applicationCount, refreshKey }: {
  selectionRef: string; applicationCount: number; refreshKey: number;
}) {
  const theme = GraphiteColors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const [height, setHeight] = useState(Math.max(48, applicationCount * 48));
  if (!supportsSavedSelectionUI()) return null;
  try { nativeView ??= requireNativeViewManager<Props>('ItomaNative'); }
  catch { return <Text style={{ color: theme.text, fontSize: 16 }}>対象表示には新しい実機ビルドが必要です。</Text>; }
  const NativeView = nativeView;
  return <NativeView selectionRef={selectionRef} refreshKey={refreshKey} style={{ width: '100%', height }} onContentSize={({ nativeEvent }) => {
    if (Number.isFinite(nativeEvent.height) && nativeEvent.height > 0 && nativeEvent.height <= 30000) {
      setHeight(Math.ceil(nativeEvent.height));
    }
  }} />;
}
