import { StyleSheet, Text, View } from 'react-native';
import type { ScreenTimeSnapshot, ScreenTimeTarget } from '../../../modules/itoma-native';
import { useScreenTime } from '@/state/screen-time';
import { useAppNavigation } from '@/state/navigation';
import { Applications } from '../flow/applications';
import { Body, Button, Heading, LinkRow, Panel, useFlowTheme } from '../flow/ui';
import { endTime } from '../flow/presentation';
import { ruleTitle, RuleGoal } from '../flow/rule-identity';
import { PeriodRing } from './period-ring';
import { presentPeriod } from './period-presentation';
import { currentRulePeriods, currentRuleTargets, hasFreshRestrictionState, nextScheduleChanges, unlockCandidates } from './rule-status';
import { RuleDeck } from './rule-deck';
import { OffHoursHome } from './off-hours-home';

export function CurrentRules({ snapshot: s, now, onUnlock, ready = true, clockConfirmed = true }: { snapshot: ScreenTimeSnapshot; now: number; ready?: boolean; clockConfirmed?: boolean; onUnlock: (ruleID: string) => void }) {
  const theme = useFlowTheme(), state = useScreenTime(), navigation = useAppNavigation();
  const current = currentRulePeriods(s, now), targets = currentRuleTargets(s, now);
  const fresh = hasFreshRestrictionState(s, now) && !state.error && !state.legacyActive && clockConfirmed, running = s.activation === 'enabled';
  const changes = nextScheduleChanges(s, now);
  return <>
    {running && current.length > 0 && <View style={styles.section}>
      <Heading>{fresh ? 'いま適用しているルール' : '設定上、時間内のルール'}</Heading>
      <RuleDeck selectedID={state.homeRuleKey} onSelect={state.setHomeRuleKey} items={current.map(period => {
        const rule = s.rules.find(rule => rule.id === period.ruleID)!;
        const apps = targets.filter(target => target.ruleID === rule.id);
        const presentation = presentPeriod(period.startsAt * 1000, period.endsAt * 1000, now);
        return { id: period.ruleID + ':' + period.startsAt, title: ruleTitle(rule, s.rules.indexOf(rule)), content: <Panel>
          <View style={styles.heading}>
            <View style={{ flex: 1, gap: 4 }}><Heading>{ruleTitle(rule, s.rules.indexOf(rule))}</Heading>
              <Text style={[styles.caption, { color: theme.muted }]}>{endTime(period.startsAt, now)}〜{endTime(period.endsAt, now)}</Text></View>
            <Text style={[styles.badge, { backgroundColor: theme.soft, color: theme.text }]}>{fresh ? !apps.length ? '時間内・適用対象なし' : apps.every(target => target.grantStatus === 'active' && (target.grantEndsAt ?? 0) * 1000 > now) ? '一時解除中' : '適用中' : '反映未確認'}</Text>
          </View>
          {presentation.state === 'current' && <PeriodRing period={presentation} theme={theme} compact={current.length > 1} />}
          <RuleGoal goal={rule.goal} />
          <View style={styles.section}>
            <Text style={[styles.caption, { color: theme.muted }]}>このルールを適用するアプリ</Text>
            {s.authorization === 'approved' ? apps.map(target => <RuleTarget key={target.ref} target={target} now={now} fresh={fresh} />) : <Body muted>許可の確認後に対象を表示します。</Body>}
            {s.authorization === 'approved' && !apps.length && <Body muted>現在、このルールが適用されているアプリはありません。</Body>}
          </View>
          {fresh && unlockCandidates(s, now, rule.id).length > 0 && <View style={styles.section}>
            <Button label="一時解除する" testID="home-unlock-entry" disabled={!!state.busy} onPress={() => onUnlock(rule.id)} />
            <Text style={[styles.caption, { color: theme.muted }]}>このルールのアプリから、1つ選びます。</Text>
          </View>}
        </Panel> };
      })} />
    </View>}
      {running && current.length > 0 && changes.length > 0 && <View style={[styles.next, { borderColor: theme.line }]}>
        <Text style={[styles.caption, { color: theme.muted }]}>次の切替（予定） · {endTime(changes[0].at, now)}</Text>
        {changes.map(change => <Text key={change.kind + change.ruleID} style={[styles.caption, { color: theme.text }]}>
          {ruleTitle(s.rules.find(rule => rule.id === change.ruleID), s.rules.findIndex(rule => rule.id === change.ruleID))}が{change.kind === 'start' ? '始まります' : '終了します'}
        </Text>)}
      </View>}
    {running && current.length === 0 && <OffHoursHome snapshot={s} now={now} ready={ready} clockConfirmed={clockConfirmed} />}
    {s.targets.some(target => target.grantCommandID) && <LinkRow label="一時解除の状況を見る" detail="選んだアプリだけを解除しています" onPress={() => navigation.open({ screen: 'grant' })} />}
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
const styles = StyleSheet.create({
  section: { gap: 12 }, next: { borderLeftWidth: 2, paddingLeft: 12, gap: 4, marginTop: 2 },
  caption: { fontSize: 13, lineHeight: 21 }, heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 10 },
  badge: { fontSize: 12, lineHeight: 20, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 },
  target: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, paddingVertical: 6, borderTopWidth: 1 },
  targetState: { fontSize: 13, lineHeight: 21, textAlign: 'right', flexShrink: 1 },
});
