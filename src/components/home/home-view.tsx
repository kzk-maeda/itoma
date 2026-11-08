import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GraphiteColors, HomeLayout } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { OpenCircle } from './open-circle';
import { presentPeriod } from './period-presentation';
import { PeriodRing } from './period-ring';

/** Presentation input, not a native snapshot. The connected adapter belongs to #56. */
export type HomePeriod = {
  ruleName: string; startsAt: number; endsAt: number;
  observation: 'confirmed' | 'unverified'; stateText: string;
  purpose?: string;
  targets: { key: string; label: string; detail: string }[];
};

export function HomeView({ period, now, recoveryEntry, onUnlock, onCreateRule }: {
  period?: HomePeriod; now?: number; recoveryEntry?: ReactNode;
  onUnlock?: () => void; onCreateRule?: () => void;
}) {
  const theme = GraphiteColors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const presentation = period ? presentPeriod(period.startsAt, period.endsAt, now ?? NaN) : undefined;
  const current = presentation?.state === 'current';
  const unverified = !period || period.observation === 'unverified';
  const issue = !period ? '曜日・時間帯を指定する機能は準備中です。現在、このホームから制限の開始や変更はできません。'
    : !current ? presentation?.state === 'expired' ? 'この時間帯は終了しました。現在の制限状態を確認してください。'
      : presentation?.state === 'upcoming' ? 'この時間帯はまだ始まっていません。'
        : '時間帯を表示できません。ルールと制限の状態を確認してください。'
      : unverified ? '制限の状態を確認できません。以下は設定上の時間です。' : undefined;
  return <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
    <ScrollView contentContainerStyle={styles.content}>
      {recoveryEntry}
      <View style={styles.brand}>
        <OpenCircle color={theme.accent} />
        <Text style={[styles.brandName, { color: theme.text }]}>いとま</Text>
        <Text style={[styles.wordmark, { color: theme.muted }]}>ITOMA</Text>
      </View>

      {issue && <View style={[styles.notice, { borderColor: theme.line }]}>
        <Text style={[styles.noticeTitle, { color: theme.text }]}>{period ? '現在の状態' : '時間帯ルールは準備中です'}</Text>
        <Text style={[styles.body, { color: theme.muted }]}>{issue}</Text>
      </View>}

      <View style={styles.period}>
        <Text style={[styles.eyebrow, { color: theme.muted }]}>{period ? '自分で決めた時間' : '自分の時間を、ここから。'}</Text>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          {period?.ruleName ?? '制限する時間を決める'}
        </Text>
        {period && presentation?.state === 'current' && <>
          <Text style={[styles.body, styles.center, { color: theme.muted }]}>
            {unverified ? '設定上の時間' : period.stateText}
          </Text>
          <PeriodRing period={presentation} theme={theme} />
        </>}
        {!period && <Text style={[styles.body, styles.center, { color: theme.muted }]}>
          いつ、どのアプリから離れたいか。{'\n'}あなたのペースで決めていきましょう。
        </Text>}
      </View>

      {period?.purpose?.trim() && <View style={[styles.purpose, { backgroundColor: theme.purposeSurface }]}>
        <Text style={[styles.label, { color: theme.purposeMotif }]}>この時間に、大切にしたいこと</Text>
        <Text style={[styles.quote, { color: theme.text }]}>{period.purpose}</Text>
      </View>}

      <View style={styles.section}>
        <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
          {period ? '対象のアプリ' : '時間のルール'}
        </Text>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.line }]}>
          {period ? period.targets.map((target, index) => <View key={target.key}
            style={[styles.target, index > 0 && { borderTopWidth: 1, borderTopColor: theme.line }]}>
            <Text style={[styles.targetName, { color: theme.text }]}>{target.label}</Text>
            <Text style={[styles.body, { color: theme.muted }]}>{target.detail}</Text>
          </View>) : <>
            <Text style={[styles.targetName, { color: theme.text }]}>曜日と時間帯</Text>
            <Text style={[styles.body, { color: theme.muted }]}>設定できるようになると、ここにルールと対象アプリが表示されます。</Text>
          </>}
          {period && period.targets.length === 0 && <Text style={[styles.body, { color: theme.muted }]}>対象のアプリはありません。</Text>}
        </View>
      </View>

      {current && period && period.targets.length > 0 && onUnlock && <Pressable
        testID="home-unlock-entry" accessibilityRole="button" onPress={onUnlock}
        style={({ pressed }) => [styles.button, { backgroundColor: pressed ? theme.text : theme.accent }]}>
        <Text style={[styles.buttonText, { color: theme.onAccent }]}>一時解除する</Text>
      </Pressable>}
      {!period && <Pressable accessibilityRole="button" onPress={onCreateRule}
        disabled={!onCreateRule} accessibilityState={{ disabled: !onCreateRule }}
        style={({ pressed }) => [styles.button, { backgroundColor: !onCreateRule ? theme.soft : pressed ? theme.text : theme.accent }]}>
        <Text style={[styles.buttonText, { color: onCreateRule ? theme.onAccent : theme.muted }]}>ルールをつくる</Text>
      </Pressable>}
      {!period && <Text style={[styles.label, styles.center, { color: theme.muted }]}>
        理由を入力して一時解除する機能は準備中です。
      </Text>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, width: '100%', maxWidth: HomeLayout.maxWidth, alignSelf: 'center',
    paddingHorizontal: HomeLayout.gutter, paddingTop: 24, paddingBottom: 40, gap: HomeLayout.sectionGap },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 },
  brandName: { fontSize: 22, lineHeight: 32, fontWeight: '500', letterSpacing: 2 },
  wordmark: { fontSize: 11, lineHeight: 18, letterSpacing: 3 },
  notice: { gap: 8, borderBottomWidth: 1, paddingBottom: 20 },
  noticeTitle: { fontSize: 14, lineHeight: 22, fontWeight: '600' },
  period: { alignItems: 'center', gap: 12, paddingVertical: 8 },
  eyebrow: { fontSize: 13, lineHeight: 20, letterSpacing: 1 },
  title: { fontSize: 28, lineHeight: 40, fontWeight: '500', textAlign: 'center' },
  heading: { fontSize: 20, lineHeight: 30, fontWeight: '500' },
  body: { fontSize: 16, lineHeight: 26 },
  label: { fontSize: 13, lineHeight: 20 },
  center: { textAlign: 'center' },
  section: { gap: 12 },
  card: { borderWidth: 1, borderRadius: 20, padding: 20, gap: 8 },
  target: { paddingVertical: 12, gap: 4 },
  targetName: { fontSize: 16, lineHeight: 26, fontWeight: '500' },
  purpose: { borderRadius: 20, padding: 20, gap: 8 },
  quote: { fontSize: 18, lineHeight: 30 },
  button: { minHeight: 50, borderRadius: 12, padding: 16, justifyContent: 'center' },
  buttonText: { fontSize: 16, lineHeight: 26, fontWeight: '600', textAlign: 'center' },
});
