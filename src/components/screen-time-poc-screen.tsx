import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GraphiteColors, Spacing } from '@/constants/theme';
import { type PoCAction, type PoCCode, type PoCResult, screenTimePoC } from '../../modules/itoma-native';

const errors: Record<PoCCode, string> = {
  unavailable: 'このビルド・端末では実機操作を利用できません。', busy: '別の操作が進行中です。',
  'storage-failure': '保存先を利用できません。既存データは消去していません。',
  'authorization-failed': '認可の要求を完了できませんでした。現在の認可状態を確認してください。',
  'authorization-required': '本人の認可が必要です。', 'presentation-unavailable': '選択画面を開けませんでした。',
  'reselection-required': '今回の起動・認可後に対象を選び直してください。',
  'empty-selection': 'アプリを1つ以上選択してください。', 'applications-only': '検証ではカテゴリ・Webサイトを含めず、アプリだけを選択してください。',
  'too-many-applications': '選択がOSの上限を超えています。アプリを50個以内にしてください。',
  'invalid-action': '操作を受け付けられませんでした。',
};

export function ScreenTimePoCScreen() {
  const theme = GraphiteColors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const [result, setResult] = useState<PoCResult>();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false), active = useRef(false);
  const execute = useCallback(async (action: PoCAction, ref?: string) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const next = await screenTimePoC.run(action, ref);
      if (active.current) setResult(next);
    } finally { inFlight.current = false; if (active.current) setBusy(false); }
  }, []);
  useFocusEffect(useCallback(() => {
    active.current = true; void execute('snapshot');
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void execute('snapshot');
    });
    return () => { active.current = false; subscription.remove(); };
  }, [execute]));
  const snapshot = result?.status === 'snapshot' ? result.snapshot : undefined;
  const device = snapshot?.availability === 'device-poc';
  const label = { unknown: '未確認', denied: '拒否・取消', approved: '認可あり' };
  const storageLabel = { 'not-created': '未作成', ready: '保存先を読取可能', unavailable: '読取・保護を確認できません' };
  return <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>実機の接続を確かめる</Text>
      <Text style={[styles.body, { color: theme.muted }]}>検証用の画面です。選んだアプリへの手動制限だけを試します。曜日・時間帯や理由による一時解除は、まだ動作しません。</Text>
      <View style={[styles.summary, { backgroundColor: theme.soft }]}>
        <Text style={[styles.body, { color: theme.text }]}>{snapshot?.availability === 'simulator-unavailable'
          ? 'Simulatorでは認可・アプリ選択・実制限を利用できません。'
          : snapshot?.availability === 'disabled' ? '実機PoCを有効にしたビルドが必要です。'
            : snapshot?.availability === 'unsupported-os' ? 'このiOSでは検証を利用できません。' : '認可と保存・制限の要求結果を別々に確認します。'}</Text>
        <Text style={[styles.body, { color: theme.text }]}>認可：{label[snapshot?.authorization ?? 'unknown']}</Text>
        <Text style={[styles.body, { color: theme.text }]}>保存：{snapshot ? storageLabel[snapshot.storage] : result?.status === 'error' ? '確認できません' : '確認中'}</Text>
      </View>
      <View accessibilityLiveRegion="polite">
        {busy && <Text style={[styles.body, { color: theme.text }]}>操作の結果を確認しています…</Text>}
        {result?.status === 'error' && <Text style={[styles.body, { color: theme.text }]}>状態を取得できません（{result.code}）。制限の成功は未確認です。</Text>}
        {snapshot?.code && <Text style={[styles.body, { color: theme.text }]}>{errors[snapshot.code]}</Text>}
        {snapshot?.operation === 'cancelled' && <Text style={[styles.body, { color: theme.text }]}>選択を取り消しました。保存と制限は変更していません。</Text>}
        {snapshot?.operation === 'saved' && <Text style={[styles.body, { color: theme.text }]}>保存しました。制限は開始していません。</Text>}
        {snapshot?.observation === 'own-store-matches' && <Text style={[styles.body, { color: theme.text }]}>選択した対象の制限設定を読み返しました。対象アプリを開き、実際の制限を確認してください。</Text>}
        {snapshot?.observation === 'own-store-empty' && <Text style={[styles.body, { color: theme.text }]}>この検証用の制限設定を消去しました。他の制限元や実際の解除状態は未確認です。</Text>}
        {snapshot?.observation === 'uncertain' && <Text style={[styles.body, { color: theme.text }]}>要求後の制限設定を確認できません。対象アプリと「状態を再確認」で確かめてください。</Text>}
      </View>
      <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>1. 本人の認可</Text>
      <PoCButton theme={theme} disabled={busy || !device} title="Screen Timeの認可を要求" onPress={() => void execute('authorize')} />
      <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>2. 対象を選び、保存する</Text>
      <Text style={[styles.body, { color: theme.muted }]}>保存しても制限は開始しません。再起動・再認可・背景からの復帰後は、対象を選び直してから手動制限を試してください。</Text>
      {snapshot?.storage === 'not-created' && <PoCButton theme={theme} disabled={busy || !device} title="検証用の保存先を作成" onPress={() => void execute('initialize')} />}
      <PoCButton theme={theme} disabled={busy || !device || snapshot?.authorization !== 'approved' || snapshot?.storage !== 'ready'} title="アプリを選択して保存" onPress={() => void execute('pick')} />
      {snapshot?.selections.map((selection, index) => <View key={selection.ref} style={[styles.selection, { borderColor: theme.line }]}>
        <Text style={[styles.body, { color: theme.text }]}>{selection.confirmedThisSession ? 'いま選んだ対象' : `保存した選択 ${index + 1}`}：{selection.applicationCount}アプリ{!selection.confirmedThisSession ? '（再選択が必要）' : ''}</Text>
        {selection.confirmedThisSession && <PoCButton theme={theme} title="いま選んだ対象の手動制限を確認" onPress={() => Alert.alert('いま選んだ対象を手動で制限しますか',
          `${selection.applicationCount}アプリの制限を要求します。自動では終了しません。この画面の「検証用の制限を停止」で停止できます。`,
          [{ text: 'キャンセル', style: 'cancel' }, { text: '制限を要求', onPress: () => void execute('apply', selection.ref) }])}
          disabled={busy || !device || snapshot.authorization !== 'approved'} />}
      </View>)}
      <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>3. 停止と状態の確認</Text>
      <Text style={[styles.body, { color: theme.muted }]}>停止は検証用の制限だけを消去します。保存先が読めない場合も操作できます。画面を閉じても、自動では停止しません。</Text>
      <PoCButton theme={theme} disabled={busy} title="検証用の制限を停止" onPress={() => void execute('stop')} />
      <PoCButton theme={theme} disabled={busy} title="状態を再確認" onPress={() => void execute('snapshot')} />
      <PoCButton theme={theme} title="ホームへ戻る" onPress={() => router.replace('/')} />
    </ScrollView>
  </SafeAreaView>;
}

function PoCButton({ title, onPress, disabled = false, theme }: {
  title: string; onPress: () => void; disabled?: boolean; theme: { accent: string; surface: string; text: string };
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[styles.button, { borderColor: theme.accent, backgroundColor: theme.surface }]}>
    <Text style={[styles.buttonText, { color: theme.text }]}>{title}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, content: { padding: Spacing.four, gap: Spacing.three, maxWidth: 640, width: '100%', alignSelf: 'center' },
  title: { fontSize: 28, fontWeight: '600' }, heading: { fontSize: 20, fontWeight: '600', marginTop: Spacing.two },
  body: { fontSize: 16, lineHeight: 24 }, buttonText: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  button: { minHeight: 48, borderWidth: 1, borderRadius: 12, padding: Spacing.three, justifyContent: 'center' },
  summary: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  selection: { gap: Spacing.two, paddingVertical: Spacing.three, borderBottomWidth: 1 },
});
