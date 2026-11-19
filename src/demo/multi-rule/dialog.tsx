import { Pressable, Text, View, type AlertButton } from 'react-native';
import { GraphiteColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
export type DemoAlert = { title: string; message?: string; actions: AlertButton[] };
/** Demonstrates native Alert callbacks; the appearance is a Web-only adapter. */
export function DemoDialog({ dialog, choose }: { dialog: DemoAlert; choose: (action: AlertButton) => void }) {
  const theme = GraphiteColors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  return <View style={{ position: 'absolute', inset: 0, backgroundColor: theme.background, justifyContent: 'center', padding: 24 }}>
    <View accessibilityRole="alert" accessibilityViewIsModal style={{ width: '100%', maxWidth: 400, alignSelf: 'center', padding: 24, borderRadius: 20, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface, gap: 20 }}>
      <Text style={{ fontSize: 12, lineHeight: 20, color: theme.muted }}>デモ用の確認 · OS操作なし</Text>
      <Text accessibilityRole="header" style={{ fontSize: 22, lineHeight: 32, color: theme.text }}>{dialog.title}</Text>
      {!!dialog.message && <Text style={{ fontSize: 16, lineHeight: 26, color: theme.muted }}>{dialog.message}</Text>}
      {dialog.actions.map((action, index) => <Pressable key={index} accessibilityRole="button" accessibilityLabel={action.text} onPress={() => choose(action)}
        style={{ minHeight: 48, justifyContent: 'center', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.line, backgroundColor: action.style === 'cancel' ? theme.accent : theme.surface }}>
        <Text style={{ fontSize: 16, lineHeight: 26, textAlign: 'center', color: action.style === 'cancel' ? theme.onAccent : theme.text }}>{action.text}</Text>
      </Pressable>)}
    </View>
  </View>;
}
