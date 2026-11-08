import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { GraphiteColors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Build-time navigation only; opening the PoC does not change Screen Time settings. */
export function PoCRecoveryEntry() {
  const theme = GraphiteColors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  if (Platform.OS !== 'ios' || Constants.expoConfig?.ios?.infoPlist?.ITOMAScreenTimePoC !== true) {
    return null;
  }
  return (
    <View style={[styles.notice, { backgroundColor: theme.soft }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
        実機検証・制限の停止
      </Text>
      <Text style={[styles.body, { color: theme.text }]}>
        実機検証で開始した制限は、アプリを閉じても自動では停止しません。停止は検証画面で行えます。
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="実機検証の状態確認と停止操作がある画面を開きます"
        onPress={() => router.replace('/native-poc')}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: theme.surface, borderColor: theme.accent },
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.buttonText, { color: theme.text }]}>検証画面を開く</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { padding: Spacing.three, gap: Spacing.three, borderRadius: 16, marginBottom: Spacing.four },
  title: { fontSize: 18, lineHeight: 27, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24 },
  button: { minHeight: 48, padding: Spacing.three, borderWidth: 1, borderRadius: 12, justifyContent: 'center' },
  buttonText: { fontSize: 16, lineHeight: 24, fontWeight: '600', textAlign: 'center' },
  pressed: { opacity: 0.7 },
});
