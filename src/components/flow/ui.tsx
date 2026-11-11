import { type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GraphiteColors, HomeLayout } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useScreenTime } from '@/state/screen-time';
import { useProductTabs } from '@/state/product-tabs';
import type { ScreenTimeCode } from '../../../modules/itoma-native';
import { OpenCircle } from '../home/open-circle';
import { ProductNavigation, type ProductTab } from './product-navigation';

export function useFlowTheme() { return GraphiteColors[useColorScheme() === 'dark' ? 'dark' : 'light']; }
export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  const theme = useFlowTheme(); return <Text style={[styles.body, { color: muted ? theme.muted : theme.text }]}>{children}</Text>;
}
export function Heading({ children }: { children: ReactNode }) {
  const theme = useFlowTheme(); return <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>{children}</Text>;
}
export function Panel({ children }: { children: ReactNode }) {
  const theme = useFlowTheme(); return <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.line }]}>{children}</View>;
}
export function Button({ label, onPress, disabled = false, secondary = false, testID }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; testID?: string }) {
  const theme = useFlowTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} testID={testID}
    style={({ pressed }) => [styles.button, { backgroundColor: disabled ? theme.soft : secondary ? 'transparent' : theme.accent,
      borderColor: secondary ? theme.muted : 'transparent', opacity: pressed ? 0.75 : 1 }]}>
    <Text style={[styles.buttonText, { color: disabled ? theme.muted : secondary ? theme.text : theme.onAccent }]}>{label}</Text>
  </Pressable>;
}
/** Quiet secondary destinations, matching the demo's flat rows. */
export function LinkRow({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  const theme = useFlowTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.link, { borderColor: theme.line, opacity: pressed ? 0.75 : 1 }]}>
    <Text style={[styles.linkText, { color: disabled ? theme.muted : theme.text }]}>{label}</Text>
    <Text accessible={false} style={{ color: theme.muted, fontSize: 20 }}>›</Text>
  </Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const theme = useFlowTheme(); return <View style={styles.field}>
    <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
    <TextInput accessibilityLabel={label} placeholderTextColor={theme.muted} autoCorrect={false} {...props}
      style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.muted, color: theme.text }, props.multiline && styles.multiline, props.style]} />
  </View>;
}
export function Notice({ title, children }: { title: string; children: ReactNode }) {
  const theme = useFlowTheme(); return <View style={[styles.notice, { borderColor: theme.muted }]}>
    <Text accessibilityRole="header" style={[styles.label, { color: theme.text }]}>{title}</Text><Body>{children}</Body>
  </View>;
}
export const errorText: Record<ScreenTimeCode, string> = {
  unavailable: '操作を完了できませんでした。状況を確認してから、もう一度お試しください。',
  busy: '前の操作を確認しています。結果が表示されるまでお待ちください。',
  'invalid-input': '曜日・時刻・解除時間を確認してください。終了が開始より前なら「翌日に終了」を選んでください。',
  changed: '確認中に条件が変わりました。入力は残っています。最新の内容を確認し直してください。',
  'authorization-required': 'スクリーンタイムの許可を確認してください。再許可後は対象を選び直し、ご自身で再開できます。',
  'selection-required': 'アプリを選び直してください。アプリだけを選択し、保存すると確認できます。',
  'schedule-failed': '自動切替の予定を登録できませんでした。新しい解除は行いません。現在の状態を確認できます。',
  'storage-failed': '保存状態を確認できません。完了したとは扱わず、状況を確認してください。',
  'reason-storage-full': '理由を保存する空きがないため、解除しませんでした。設定から不要な理由を削除できます。',
  'reason-required': '理由を自分の言葉で入力してください。空白だけでは進めません。',
  'application-uncertain': '反映を確認できません。解除済み・停止済みとは扱わず、現在の状態を確認してください。',
  'legacy-active': '以前の手動検証の制限が残っています。確認のうえ、手動検証の制限を停止してください。',
  'retry-required': '前の要求は完了していません。内容を確認して、明示的に再試行できます。',
};
export function FlowScreen({ title, children, onBack, footer, tab, eyebrow }: { title: string; children: ReactNode; onBack?: () => void; footer?: ReactNode; tab?: ProductTab; eyebrow?: string }) {
  const theme = useFlowTheme(), state = useScreenTime(), hosted = useProductTabs();
  return <SafeAreaView edges={hosted ? [] : undefined} style={[styles.screen, { backgroundColor: tab ? theme.surface : theme.background }]}>
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView testID="flow-scroll" style={styles.screen} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, tab && styles.productContent]}>
        {(!tab || onBack) && <View style={styles.top}>
          {onBack ? <Button label="‹ 戻る" secondary onPress={onBack} /> : <View style={styles.brand}><OpenCircle color={theme.accent} /><Text style={[styles.brandName, { color: theme.text }]}>いとま</Text></View>}
        </View>}
        <View style={{ gap: 6 }}>
          {eyebrow && <Text style={[styles.caption, { color: theme.muted }]}>{eyebrow}</Text>}
          <View style={tab === 'home' ? styles.brand : undefined}>{tab === 'home' && <OpenCircle color={theme.accent} size={28} />}<Text accessibilityRole="header" style={[styles.title, tab && styles.productTitle, tab === 'home' && styles.homeTitle, { color: theme.text }]}>{title}</Text></View>
        </View>
        {state.error && <View accessibilityLiveRegion="polite"><Notice title="状態を確認してください">{errorText[state.error]}</Notice></View>}
        {state.busy && <Body muted>操作の結果を確認しています。画面を離れても、受け付けた処理は続きます。</Body>}
        {children}{footer}
      </ScrollView>
      {tab && !hosted && <ProductNavigation current={tab} theme={theme} />}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
export const flowStyles = StyleSheet.create({ row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', minHeight: 44, gap: 8 }, section: { gap: 12 }, center: { alignItems: 'center', gap: 12 } });
const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { flexGrow: 1, width: '100%', maxWidth: HomeLayout.maxWidth, alignSelf: 'center', paddingHorizontal: HomeLayout.gutter, paddingTop: 20, paddingBottom: 40, gap: HomeLayout.sectionGap },
  productContent: { gap: 20, paddingBottom: 28 }, productTitle: { fontSize: 24, lineHeight: 36 }, homeTitle: { fontSize: 22, letterSpacing: 3 }, caption: { fontSize: 13, lineHeight: 20 },
  top: { minHeight: 44, alignItems: 'flex-start' }, brand: { flexDirection: 'row', gap: 12, alignItems: 'center' }, brandName: { fontSize: 22, fontWeight: '500', letterSpacing: 2 },
  title: { fontSize: 28, lineHeight: 40, fontWeight: '500' }, heading: { fontSize: 20, lineHeight: 30, fontWeight: '500' }, body: { fontSize: 16, lineHeight: 26 },
  panel: { padding: 20, borderWidth: 1, borderRadius: 20, gap: 12 }, notice: { gap: 8, paddingLeft: 16, borderLeftWidth: 3 },
  button: { minHeight: 50, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1, justifyContent: 'center' }, buttonText: { fontSize: 16, lineHeight: 26, fontWeight: '600', textAlign: 'center' },
  field: { gap: 8 }, label: { fontSize: 14, lineHeight: 22, fontWeight: '600' }, input: { fontSize: 17, lineHeight: 26, minHeight: 50, padding: 14, borderWidth: 1, borderRadius: 12 }, multiline: { minHeight: 150, textAlignVertical: 'top' },
  link: { minHeight: 52, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1 },
  linkText: { fontSize: 14, lineHeight: 23, flexShrink: 1 },
});
