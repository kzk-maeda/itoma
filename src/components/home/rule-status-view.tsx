import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ScreenTimeSnapshot, ScreenTimeTarget } from '../../../modules/itoma-native';
import { useScreenTime } from '@/state/screen-time';
import { useAppNavigation } from '@/state/navigation';
import { Applications } from '../flow/applications';
import { Body, Heading, LinkRow, Panel, useFlowTheme } from '../flow/ui';
import { endTime } from '../flow/presentation';
import { ruleTitle, RuleGoal } from '../flow/rule-identity';
import { PeriodRing } from './period-ring';
import { presentPeriod } from './period-presentation';
import { currentRulePeriods, currentRuleTargets, hasFreshRestrictionState, nextScheduleChanges, savedDaySchedule } from './rule-status';

export function CurrentRules({ snapshot: s, now, action }: { snapshot: ScreenTimeSnapshot; now: number; action?: ReactNode }) {
  const theme = useFlowTheme(), state = useScreenTime(), navigation = useAppNavigation();
  const current = currentRulePeriods(s, now), targets = currentRuleTargets(s, now);
  const fresh = hasFreshRestrictionState(s, now) && !state.error, running = s.activation === 'enabled';
  const restricted = targets.filter(target => target.restricted);
  const grants = targets.filter(target => target.grantStatus === 'active' && (target.grantEndsAt ?? 0) * 1000 > now);
  const changes = nextScheduleChanges(current, savedDaySchedule(s.rules, now), now);
  const status = !running ? s.activation === 'paused' ? '制限は停止中です' : '再開前の確認が必要です'
    : s.authorization !== 'approved' ? 'スクリーンタイムの許可を確認してください' : !fresh ? '現在の反映を確認できません'
    : restricted.length ? `いま、${restricted.length}つのアプリを制限中` : grants.length ? '対象アプリは一時解除中です' : current.length ? '現在、制限中のアプリはありません' : 'いまは制限時間外です';
  return <>
    <View style={styles.summary}>
      <Text style={[styles.caption, { color: theme.muted }]}>いまの状態 · {endTime(now / 1000, now)}</Text>
      <Text accessibilityRole="header" style={[styles.summaryTitle, { color: theme.text }]}>{status}</Text>
      {running && fresh && <Body muted>{current.length ? `${current.length}つのルールが時間内です。${grants.length ? `${grants.length}つのアプリを一時解除中。` : ''}` : '次の時間までは、アプリの制限はありません。'}</Body>}
      {running && changes.length > 0 && <View style={[styles.next, { borderColor: theme.line }]}>
        <Text style={[styles.caption, { color: theme.muted }]}>次の切替（予定） · {endTime(changes[0].at, now)}</Text>
        {changes.map(change => <Text key={change.kind + change.ruleID} style={[styles.caption, { color: theme.text }]}>
          {ruleTitle(s.rules.find(rule => rule.id === change.ruleID), s.rules.findIndex(rule => rule.id === change.ruleID))}が{change.kind === 'start' ? '始まります' : '終了します'}
        </Text>)}
      </View>}
    </View>
    {action}
    {running && current.length > 0 && <View style={styles.section}>
      <Heading>{fresh ? 'いま適用しているルール' : '設定上、時間内のルール'}</Heading>
      {current.length > 1 && <Text style={[styles.caption, { color: theme.muted }]}>アプリが重なる場合は、現在適用されているルールの中に表示します。</Text>}
      {current.map(period => {
        const rule = s.rules.find(rule => rule.id === period.ruleID)!;
        const apps = targets.filter(target => target.ruleID === rule.id);
        const presentation = presentPeriod(period.startsAt * 1000, period.endsAt * 1000, now);
        return <Panel key={period.ruleID + ':' + period.startsAt}>
          <View style={styles.heading}>
            <View style={{ flex: 1, gap: 4 }}><Heading>{ruleTitle(rule, s.rules.indexOf(rule))}</Heading>
              <Text style={[styles.caption, { color: theme.muted }]}>{endTime(period.startsAt, now)}〜{endTime(period.endsAt, now)}</Text></View>
            <Text style={[styles.badge, { backgroundColor: theme.soft, color: theme.text }]}>{fresh ? apps.length ? '適用中' : '時間内・適用対象なし' : '反映未確認'}</Text>
          </View>
          {presentation.state === 'current' && <PeriodRing period={presentation} theme={theme} compact={current.length > 1} />}
          <RuleGoal goal={rule.goal} />
          <View style={styles.section}>
            <Text style={[styles.caption, { color: theme.muted }]}>このルールを適用するアプリ</Text>
            {s.authorization === 'approved' ? apps.map(target => <RuleTarget key={target.ref} target={target} now={now} fresh={fresh} />) : <Body muted>許可の確認後に対象を表示します。</Body>}
            {s.authorization === 'approved' && !apps.length && <Body muted>現在、このルールが適用されているアプリはありません。</Body>}
          </View>
        </Panel>;
      })}
    </View>}
    {running && grants.length > 0 && <LinkRow label="一時解除の状況を見る" detail="選んだアプリだけを解除しています" onPress={() => navigation.open({ screen: 'grant' })} />}
  </>;
}
function RuleTarget({ target, now, fresh }: { target: ScreenTimeTarget; now: number; fresh: boolean }) {
  const state = useScreenTime(), theme = useFlowTheme();
  const activeGrant = target.grantStatus === 'active' && (target.grantEndsAt ?? 0) * 1000 > now;
  return <View style={[styles.target, { borderColor: theme.line }]}>
    <View style={{ flex: 1, minWidth: 110 }}><Applications selectionRef={target.selectionRef} targetRef={target.ref} refreshKey={state.refreshKey} /></View>
    <Text style={[styles.targetState, { color: theme.muted }]}>{!fresh ? '反映未確認' : activeGrant ? `一時解除中\n${endTime(target.grantEndsAt!, now)}まで` : target.grantCommandID ? '解除・再制限を確認中' : target.restricted ? '制限中' : '制限なし'}</Text>
  </View>;
}
export function DaySchedule({ snapshot: s, now }: { snapshot: ScreenTimeSnapshot; now: number }) {
  const theme = useFlowTheme(), navigation = useAppNavigation(), rows = savedDaySchedule(s.rules, now);
  return <View style={styles.section}>
    <Heading>今日のスケジュール</Heading>
    <Text style={[styles.caption, { color: theme.muted }]}>保存した予定です。実際の適用状態は上で確認できます。</Text>
    {rows.map(row => <View key={row.rule.id + ':' + row.startsAt} style={[styles.scheduleRow, { borderColor: theme.line }]}>
      <View style={[styles.dot, { borderColor: theme.muted, backgroundColor: row.status === 'current' && s.activation === 'enabled' ? theme.text : theme.surface }]} />
      <View style={{ flex: 1, gap: 5 }}>
        <Text style={[styles.scheduleTitle, { color: theme.text }]}>{ruleTitle(row.rule, s.rules.indexOf(row.rule))}</Text>
        <Text style={[styles.caption, { color: theme.muted }]}>{endTime(row.startsAt, now)}〜{endTime(row.endsAt, now)} · {s.selections.find(selection => selection.ref === row.rule.selectionRef)?.count ?? '—'}アプリ</Text>
      </View>
      <Text style={[styles.caption, { color: theme.muted }]}>{s.activation !== 'enabled' ? '停止中' : row.status === 'past' ? '時間終了' : row.status === 'current' ? '時間内' : '開始前'}</Text>
    </View>)}
    {!rows.length && <Body muted>今日の予定はありません。</Body>}
    <LinkRow label="スケジュールを確認する" detail="曜日・対象アプリ・時間の確認" onPress={() => navigation.open({ screen: 'settings-schedules' })} />
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: 12 }, summary: { gap: 12, paddingVertical: 8 },
  summaryTitle: { fontSize: 26, lineHeight: 38, fontWeight: '500' }, next: { borderLeftWidth: 2, paddingLeft: 12, gap: 4, marginTop: 2 },
  caption: { fontSize: 13, lineHeight: 21 }, heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 10 },
  badge: { fontSize: 12, lineHeight: 20, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 },
  target: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, paddingVertical: 6, borderTopWidth: 1 },
  targetState: { fontSize: 13, lineHeight: 21, textAlign: 'right', flexShrink: 1 },
  scheduleRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', borderBottomWidth: 1, paddingVertical: 14 },
  dot: { width: 9, height: 9, borderWidth: 1, borderRadius: 5, marginTop: 7 }, scheduleTitle: { fontSize: 16, lineHeight: 24, fontWeight: '500' },
});
