import { StyleSheet, Text, View } from 'react-native';
import type { ScreenTimeSnapshot } from '../../../modules/itoma-native';
import { useScreenTime } from '@/state/screen-time';
import { useAppNavigation } from '@/state/navigation';
import { Applications } from '../flow/applications';
import { Body, Button, Heading, LinkRow, Notice, useFlowTheme } from '../flow/ui';
import { ruleTitle, RuleGoal } from '../flow/rule-identity';
import { OffHoursCircle } from './off-hours-circle';
import { offHoursPresentation } from './off-hours-presentation';

export function OffHoursHome({ snapshot, now, ready, clockConfirmed }: { snapshot: ScreenTimeSnapshot; now: number; ready: boolean; clockConfirmed: boolean }) {
  const state = useScreenTime(), theme = useFlowTheme(), navigation = useAppNavigation();
  const view = offHoursPresentation(snapshot, now, ready);
  if (view.kind === 'hidden' || view.kind === 'unavailable') return null;
  if (view.kind === 'checking' || !clockConfirmed) return <View style={styles.section}><Notice title="次の予定を確認しています">
    次の日時とルールを確認してから表示します。設定タブでも保存したルールを確認できます。
  </Notice>
    <LinkRow label="予定を読み直す" disabled={!!state.busy} onPress={() => { void state.refresh(); }} />
  </View>;
  return <View style={styles.section}>
    <OffHoursCircle next={view.kind === 'next' ? view.start : undefined} />
    <View testID={view.kind === 'next' ? 'next-rule' : 'no-next-rule'} style={[styles.card, { backgroundColor: theme.background, borderColor: theme.line }]}>
      {view.kind === 'next' ? <>
        <View style={styles.label}><View aria-hidden accessible={false} style={[styles.dot, { backgroundColor: theme.muted }]} /><Text style={[styles.caption, { color: theme.muted }]}>次のルール</Text></View>
        <View style={{ gap: 6 }}><Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{ruleTitle(view.rule, view.ruleIndex)}</Text>
          <Text style={[styles.time, { color: theme.text }]}>{view.end}</Text></View>
        <Applications selectionRef={view.rule.selectionRef} count={view.count} refreshKey={state.refreshKey} />
        <RuleGoal goal={view.rule.goal} />
      </> : <>
        <Heading>ルールの設定</Heading><Body muted>設定したルールは、設定タブで確認できます。</Body>
        <Button secondary label="ルールを確認する" onPress={() => navigation.open({ screen: 'settings-schedules' })} />
      </>}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: 20 }, card: { padding: 20, borderWidth: 1, borderRadius: 20, gap: 16 }, label: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 5, height: 5, borderRadius: 3 }, caption: { fontSize: 13, lineHeight: 21 }, title: { fontSize: 21, lineHeight: 32, fontWeight: '500' },
  time: { fontSize: 16, lineHeight: 26, fontVariant: ['tabular-nums'] },
});
