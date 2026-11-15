import { type ReactNode, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { HistoricalChoices } from '@/runtime/history-context';
import { ProductProviders } from '@/runtime/product-providers';
import { ApplicationLabels, ApplicationSymbols } from '@/runtime/application-labels';
import { GraphiteColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createDemoSession, demoScenarios, readDemoScenario, type DemoOutcome } from './session';

const labels = { normal: '通常', uncertain: '反映未確認', paused: '停止中', denied: '許可なし' };
export function DemoProviders({ children }: { children: ReactNode }) {
  const [session] = useState(() => createDemoSession({ scenario: readDemoScenario(typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('scenario')), historySample: process.env.EXPO_PUBLIC_ITOMA_DEMO_STUDY === 'history' && (typeof window === 'undefined' || new URLSearchParams(window.location.search).get('history') !== 'empty') }));
  const [contextsEnabled] = useState(() => typeof window === 'undefined' || new URLSearchParams(window.location.search).get('context') !== 'missing');
  const [expanded, setExpanded] = useState(false), [outcome, setOutcome] = useState<DemoOutcome>('success');
  const theme = GraphiteColors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const reload = (scenario: string, history?: 'sample' | 'empty', context?: 'sample' | 'missing') => {
    // A document reload isolates provider drafts, the ordered control store, and private sample reasons.
    if (!window.confirm('入力とデモ内の記録を消して、シナリオを切り替えますか？')) return;
    const base = process.env.EXPO_PUBLIC_ITOMA_DEMO_BASE_PATH || '';
    const query = new URLSearchParams({ scenario });
    const mode = history ?? new URLSearchParams(window.location.search).get('history');
    if (mode === 'sample' || mode === 'empty') query.set('history', mode);
    const contextMode = context ?? new URLSearchParams(window.location.search).get('context');
    if (contextMode === 'sample' || contextMode === 'missing') query.set('context', contextMode);
    window.location.assign(`${base}/?${query}`);
  };
  return <View style={{ flex: 1, backgroundColor: theme.surface }}>
    <View style={[styles.banner, { backgroundColor: theme.background }]}>
      <Text style={[styles.caption, { color: theme.text }]} testID="shared-demo-banner">共有UIデモ · 架空データ / OS操作なし</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.control}>
        <Text style={{ color: theme.text }}>{expanded ? 'デモ操作を閉じる' : 'シナリオ・操作結果を選ぶ'}</Text>
      </Pressable>
      {expanded && <ScrollView style={styles.controls}>
        <Text style={[styles.caption, { color: theme.muted }]}>同じ本体画面・部品を表示しています。データ接続だけがデモ用です。</Text>
        <View style={styles.row}>{demoScenarios.map(scenario => <Pressable key={scenario} accessibilityRole="button" onPress={() => reload(scenario)} style={[styles.chip, { borderColor: theme.muted }]}><Text style={{ color: theme.text }}>{labels[scenario]}</Text></Pressable>)}</View>
        <Text style={[styles.caption, { color: theme.muted }]}>次の一時解除の結果</Text>
        <View style={styles.row}>{(['success', 'schedule-failed', 'uncertain'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: outcome === value }} onPress={() => { setOutcome(value); session.setOutcome(value); }} style={[styles.chip, { borderColor: theme.muted, backgroundColor: outcome === value ? theme.soft : 'transparent' }]}><Text style={{ color: theme.text }}>{value === 'success' ? '反映確認' : value === 'schedule-failed' ? '予定登録失敗' : '反映未確認'}</Text></Pressable>)}</View>
        <View style={styles.row}><Pressable accessibilityRole="button" onPress={() => router.navigate('/history')} style={[styles.chip, { borderColor: theme.muted }]}><Text style={{ color: theme.text }}>操作の記録へ</Text></Pressable><Pressable accessibilityRole="button" onPress={() => reload('normal')} style={[styles.chip, { borderColor: theme.muted }]}><Text style={{ color: theme.text }}>最初から</Text></Pressable></View>
        {process.env.EXPO_PUBLIC_ITOMA_DEMO_STUDY === 'history' && <View style={styles.row}><Pressable accessibilityRole="button" onPress={() => reload('normal', 'sample')} style={[styles.chip, { borderColor: theme.muted }]}><Text style={{ color: theme.text }}>過去の記録サンプル</Text></Pressable><Pressable accessibilityRole="button" onPress={() => reload('normal', 'empty')} style={[styles.chip, { borderColor: theme.muted }]}><Text style={{ color: theme.text }}>記録のない状態</Text></Pressable></View>}
        {process.env.EXPO_PUBLIC_ITOMA_DEMO_STUDY === 'history' && <View style={styles.row}><Pressable accessibilityRole="button" onPress={() => reload('normal', undefined, 'sample')} style={[styles.chip, { borderColor: theme.muted }]}><Text style={{ color: theme.text }}>当時情報の保存案で表示</Text></Pressable><Pressable accessibilityRole="button" onPress={() => reload('normal', undefined, 'missing')} style={[styles.chip, { borderColor: theme.muted }]}><Text style={{ color: theme.text }}>現行の項目だけで表示</Text></Pressable></View>}
        <Text style={[styles.caption, { color: theme.muted }]}>理由はタブ内メモリーのみ。再読込で消えます。ルールの追加・曜日/時間編集・対象選び直し・オンボーディングは未対応で、完了を装いません。時間集計も未提供です。iOSとWebの表示・キーボード・操作感には差があります。</Text>
      </ScrollView>}
    </View>
    <ApplicationLabels.Provider value={session.applicationLabel}><ApplicationSymbols.Provider value={session.applicationSymbol}><HistoricalChoices.Provider value={contextsEnabled ? session.historicalChoice : undefined}><ProductProviders clients={session.clients}>{children}</ProductProviders></HistoricalChoices.Provider></ApplicationSymbols.Provider></ApplicationLabels.Provider>
  </View>;
}
const styles = StyleSheet.create({ banner: { paddingHorizontal: 16, paddingTop: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#8888' },
  caption: { fontSize: 12, lineHeight: 20 }, control: { minHeight: 44, justifyContent: 'center' }, controls: { maxHeight: 310 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 10 },
  chip: { minHeight: 44, padding: 10, borderWidth: 1, borderRadius: 8, justifyContent: 'center' } });
