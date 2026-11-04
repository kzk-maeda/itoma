import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const mockApps = ['Instagram', 'YouTube', 'TikTok', 'X'] as const;
type MockApp = (typeof mockApps)[number];
const modes = [
  {
    id: 'gentle',
    title: 'ひと呼吸',
    description: '開く前に立ち止まるモードのサンプルです。',
  },
  { id: 'focus', title: '集中', description: '制限を強めるモードのサンプルです。' },
] as const;
type Mode = (typeof modes)[number]['id'];
type Editor = 'apps' | 'mode' | null;

const palettes = {
  light: {
    background: '#F6F5F0',
    surface: '#FFFFFF',
    text: '#263D33',
    muted: '#626B63',
    line: '#DBE1D8',
    accent: '#355C49',
    soft: '#E8EDE4',
    onAccent: '#FFFFFF',
  },
  dark: {
    background: '#171E1A',
    surface: '#242E27',
    text: '#EDF1E7',
    muted: '#B5C0B4',
    line: '#465347',
    accent: '#BED1B8',
    soft: '#303F33',
    onAccent: '#1A2C20',
  },
};

export function HomeScreen() {
  const colors = palettes[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const [apps, setApps] = useState<MockApp[]>([]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [draftApps, setDraftApps] = useState<MockApp[]>([]);
  const [draftMode, setDraftMode] = useState<Mode | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [feedback, setFeedback] = useState('');
  const modeTitle = modes.find((item) => item.id === mode)?.title ?? '未設定';
  const appSummary = apps.length ? apps.join('・') : '未選択';
  const isApps = editor === 'apps';
  const editorTitle = isApps ? '制限するアプリを選択' : '制限モードを設定';

  function openEditor(next: Exclude<Editor, null>) {
    setFeedback('');
    setDraftApps([...apps]);
    setDraftMode(mode);
    setEditor(next);
  }

  function save() {
    if (isApps) setApps(draftApps);
    else setMode(draftMode);
    setFeedback(isApps ? 'アプリの選択を反映しました。' : 'モードの選択を反映しました。');
    setEditor(null);
  }

  function cancel() {
    setEditor(null);
    setFeedback('変更を反映せずに閉じました。');
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.brand}>
          <View style={[styles.brandMark, { backgroundColor: colors.soft }]} accessible={false}>
            <Text style={[styles.markText, { color: colors.accent }]}>い</Text>
          </View>
          <Text style={[styles.brandName, { color: colors.text }]}>
            いとま <Text style={styles.wordmark}>ITOMA</Text>
          </Text>
        </View>
        <View style={styles.hero}>
          <Text accessibilityRole="header" style={[styles.headline, { color: colors.text }]}>
            自分の時間をつくる準備
          </Text>
          <Text style={[styles.body, { color: colors.muted }]}>
            対象のアプリと、使い方に合うモードを選びましょう。
          </Text>
        </View>
        <View style={[styles.note, { backgroundColor: colors.soft }]}>
          <Text style={[styles.noteTitle, { color: colors.text }]}>設定のお試し</Text>
          <Text style={[styles.caption, { color: colors.muted }]}>
            実際のアプリは制限されません。選択はこの画面を開いている間だけ保持されます。
          </Text>
        </View>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>
          現在の選択
        </Text>
        <View style={styles.cards}>
          <Pressable
            testID="select-apps-button"
            accessibilityRole="button"
            accessibilityLabel="制限するアプリを選択"
            accessibilityValue={{
              text: apps.length ? `${apps.length}個選択中。${appSummary}` : '未選択',
            }}
            accessibilityHint="サンプルアプリの選択画面を開きます"
            onPress={() => openEditor('apps')}
            style={({ pressed }) => [
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.line },
              pressed && styles.pressed,
            ]}
          >

            <View style={styles.cardText}>
              <Text style={[styles.caption, { color: colors.muted }]}>対象のアプリ</Text>
              <Text
                testID="selected-apps-summary"
                style={[styles.cardTitle, { color: colors.text }]}
              >
                {appSummary}
              </Text>
            </View>
            <Text accessible={false} style={[styles.chevron, { color: colors.muted }]}>
              変更 ›
            </Text>
          </Pressable>
          <Pressable
            testID="set-mode-button"
            accessibilityRole="button"
            accessibilityLabel="制限モードを設定"
            accessibilityValue={{ text: modeTitle }}
            accessibilityHint="制限モードのサンプルを選びます"
            onPress={() => openEditor('mode')}
            style={({ pressed }) => [
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.line },
              pressed && styles.pressed,
            ]}
          >

            <View style={styles.cardText}>
              <Text style={[styles.caption, { color: colors.muted }]}>モード</Text>
              <Text
                testID="selected-mode-summary"
                style={[styles.cardTitle, { color: colors.text }]}
              >
                {modeTitle}
              </Text>
            </View>
            <Text accessible={false} style={[styles.chevron, { color: colors.muted }]}>
              変更 ›
            </Text>
          </Pressable>
        </View>
        <Text
          testID="settings-feedback"
          accessibilityLiveRegion="polite"
          style={[styles.caption, styles.feedback, { color: colors.text }]}>
          {feedback || '選択内容は、あとから変更できます。'}
        </Text>
      </ScrollView>
      <Modal
        visible={editor !== null}
        animationType="none"
        presentationStyle="pageSheet"
        onRequestClose={cancel}
      >
        <SafeAreaView accessibilityViewIsModal style={[styles.screen, { backgroundColor: colors.background }]}>
          <ScrollView style={styles.editorScroll} contentContainerStyle={styles.editorContent}>
            <Text accessibilityRole="header" style={[styles.editorTitle, { color: colors.text }]}>
              {editorTitle}
            </Text>
            <Text style={[styles.body, { color: colors.muted }]}>
              {isApps
                ? '複数選択できます。選び直すと選択を外せます。'
                : 'どちらか1つを選べます。今は使い心地のお試しです。'}
              {'\n'}実際のアプリ制限は行われません。
            </Text>
            <View style={styles.cards}>
              {isApps
                ? mockApps.map((app) => {
                    const selected = draftApps.includes(app);
                    return (
                      <Pressable
                        key={app}
                        testID={`mock-app-${app.toLowerCase()}`}
                        accessibilityRole="checkbox"
                        accessibilityLabel={app}
                        accessibilityState={{ checked: selected }}
                        aria-checked={selected}
                        onPress={() =>
                          setDraftApps((current) =>
                            current.includes(app)
                              ? current.filter((item) => item !== app)
                              : [...current, app]
                          )
                        }
                        style={({ pressed }) => [
                          styles.option,
                          {
                            backgroundColor: selected ? colors.soft : colors.surface,
                            borderColor: selected ? colors.accent : colors.line,
                          },
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={[styles.cardTitle, { color: colors.text }]}>{app}</Text>
                        <Text accessible={false} style={[styles.check, { color: colors.accent }]}>
                          {selected ? '✓' : '○'}
                        </Text>
                      </Pressable>
                    );
                  })
                : modes.map((item) => (
                    <Pressable
                      key={item.id}
                      testID={`mock-mode-${item.id}`}
                      accessibilityRole="radio"
                      accessibilityLabel={`${item.title}。${item.description}`}
                      accessibilityState={{ checked: draftMode === item.id }}
                      aria-checked={draftMode === item.id}
                      onPress={() => setDraftMode(item.id)}
                      style={({ pressed }) => [
                        styles.option,
                        {
                          backgroundColor: draftMode === item.id ? colors.soft : colors.surface,
                          borderColor: draftMode === item.id ? colors.accent : colors.line,
                        },
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.cardText}>
                        <Text style={[styles.cardTitle, { color: colors.text }]}>{item.title}</Text>
                        <Text style={[styles.caption, { color: colors.muted }]}>
                          {item.description}
                        </Text>
                      </View>
                      <Text accessible={false} style={[styles.check, { color: colors.accent }]}>
                        {draftMode === item.id ? '✓' : '○'}
                      </Text>
                    </Pressable>
                  ))}
            </View>
          </ScrollView>
          <View style={[styles.editorActions, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <Text style={[styles.caption, { color: colors.muted }]}>
              {isApps ? `${draftApps.length}個選択中` : `選択中：${modes.find((item) => item.id === draftMode)?.title ?? '未設定'}`}
            </Text>
            <Pressable
              testID="save-settings-button"
              accessibilityRole="button"
              accessibilityLabel="選択を反映"
              onPress={save}
              style={({ pressed }) => [
                styles.saveButton,
                { backgroundColor: colors.accent },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.buttonText, { color: colors.onAccent }]}>選択を反映</Text>
            </Pressable>
            <Pressable
              testID="cancel-settings-button"
              accessibilityRole="button"
              accessibilityLabel="変更をキャンセル"
              onPress={cancel}
              style={({ pressed }) => [styles.cancelButton, { borderColor: colors.accent }, pressed && styles.pressed]}
            >
              <Text style={[styles.buttonText, { color: colors.text }]}>キャンセル</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 32,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandMark: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: { fontSize: 24, fontWeight: '500' },
  brandName: { fontSize: 22, fontWeight: '600', letterSpacing: 2 },
  wordmark: { fontSize: 11, letterSpacing: 3 },
  hero: { paddingTop: 28, paddingBottom: 20, gap: 8 },
  headline: {
    fontSize: 24,
    lineHeight: 36,
    fontWeight: '600',
  },
  body: { fontSize: 15, lineHeight: 27 },
  sectionTitle: { fontSize: 14, fontWeight: '600', marginTop: 28, marginBottom: 12 },
  cards: { gap: 12 },
  card: {
    minHeight: 88,
    padding: 18,
    borderWidth: 1,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  cardText: { flex: 1, minWidth: 0, gap: 6 },
  cardTitle: { fontSize: 16, fontWeight: '600', lineHeight: 24 },
  caption: { fontSize: 13, lineHeight: 23 },
  chevron: { fontSize: 14, flexShrink: 0 },
  note: { padding: 16, borderRadius: 16, gap: 4 },
  noteTitle: { fontSize: 14, fontWeight: '600', lineHeight: 22 },
  feedback: { marginTop: 16 },
  editorActions: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    padding: 16,
    gap: 8,
    borderTopWidth: 1,
    flexShrink: 0,
  },
  editorScroll: { flex: 1 },
  editorContent: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    padding: 24,
    paddingBottom: 40,
    gap: 24,
  },
  editorTitle: { fontSize: 24, fontWeight: '600', lineHeight: 36 },
  option: {
    minHeight: 64,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  check: { fontSize: 22 },
  saveButton: {
    minHeight: 52,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.65 },
});
