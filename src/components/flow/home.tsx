import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useVisibleClock } from '@/hooks/use-visible-clock';
import { useScreenTime } from '@/state/screen-time';
import { completeNativeHomeSmoke } from '@/qa/native-smoke';
import { PeriodRing } from '../home/period-ring';
import { presentPeriod } from '../home/period-presentation';
import { PoCRecoveryEntry } from '../home/poc-recovery-entry';
import { OpenCircle } from '../home/open-circle';
import { Applications } from './applications';
import { Body, Button, FlowScreen, Heading, LinkRow, Notice, Panel, useFlowTheme } from './ui';
import { endTime, grantRemaining, ruleText } from './presentation';

export function ProductHome() {
  const state = useScreenTime(), theme = useFlowTheme(), now = useVisibleClock();
  const s = state.snapshot;
  const { refresh } = state;
  const boundary = useRef('');
  useFocusEffect(useCallback(() => { completeNativeHomeSmoke(); }, []));
  useEffect(() => {
    if (!s) return;
    const times = [s.validUntil, ...s.periods.map((p) => p.endsAt), ...s.targets.map((t) => t.grantEndsAt)].filter((n): n is number => n !== undefined);
    const passed = times.filter((n) => n * 1000 <= now);
    const key = `${s.sequence}:${passed.join(',')}`;
    if (passed.length && boundary.current !== key) { boundary.current = key; void refresh(); }
  }, [now, s, refresh]);
  const device = s?.availability === 'device';
  const current = s?.periods.filter((p) => p.startsAt * 1000 <= now && p.endsAt * 1000 > now) ?? [];
  const observed = s?.authorization === 'approved' && s.activation === 'enabled'
    && s.observation === 'applied' && !!s.validUntil && s.validUntil * 1000 > now && !state.error;
  const create = () => { if (!state.ruleDraft?.dirty) state.beginRule(); router.navigate(s?.authorization === 'approved' ? '/rule' : '/onboarding'); };
  const unlock = () => { if (!state.unlockDraft.reason && !state.unlockDraft.targetRef) state.resetUnlock(); router.push('/unlock'); };
  const stopLegacy = () => Alert.alert('手動検証の制限を停止しますか', '以前の手動検証で指定した制限だけを停止します。通常のルールと保存した対象は削除しません。', [
    { text: '戻る', style: 'cancel' }, { text: '手動検証の制限を停止', onPress: () => { void state.run('stopLegacy'); } },
  ]);
  return <FlowScreen title="いとま" tab="home">
    {state.loading && <Body muted>現在の設定を確認しています。</Body>}
    {!state.loading && !device && <Notice title="iPhoneのITOMAで設定できます">
      {s?.availability === 'simulator' ? 'この環境ではスクリーンタイムの認可や実際の制限は行いません。対応するiPhone版で設定できます。'
        : 'この環境では制限機能を利用できません。対応するiPhone版をご利用ください。'}
    </Notice>}
    {state.legacyActive && <Notice title="手動検証の制限が残っています">
      通常の一時解除を使う前に、以前の手動検証の制限を停止してください。
    </Notice>}
    {state.legacyActive && <Button label="手動検証の制限を確認して停止" secondary disabled={!!state.busy} onPress={stopLegacy} />}
    {device && s.authorization !== 'approved' && <Notice title="スクリーンタイムの許可が必要です">設定を残したまま、許可を確認できます。再開前に対象アプリと保存したルールを確認できます。</Notice>}
    {device && s.authorization !== 'approved' && <Button label="許可を確認する" onPress={() => router.push('/onboarding')} />}
    {s?.activation === 'paused' && <Notice title="ルールの停止を保存しています">ルールは保存されています。再開にはご自身の操作が必要です。設定タブから現在の状態を確認できます。</Notice>}
    {s?.activation === 'awaitingReauthorizationConfirmation' && <Notice title="再開前に対象を確認してください">ルールの対象アプリを選び直してから、設定画面で明示的に再開できます。</Notice>}
    {device && !!s.rules.length && s.activation === 'enabled' && (!s.schedulesReady || !observed) && <Notice title="制限の状態を確認してください">
      {s.schedulesReady ? '反映を確認できていません。以下の時間帯は保存した設定です。設定タブから現在の状態を確認できます。' : '自動切替の予定を確認できていません。設定タブから現在の状態を確認できます。'}
    </Notice>}
    {current.map((p) => { const presentation = presentPeriod(p.startsAt * 1000, p.endsAt * 1000, now);
      const rule = s?.rules.find(r => r.id === p.ruleID);
      return <View key={`${p.ruleID}:${p.startsAt}`} style={styles.period}>
      <View style={styles.periodHeading}>
        <View style={styles.periodLabel}>
          {rule && <Text style={[styles.caption, { color: theme.muted }]}>{ruleText(rule)}</Text>}
          <Heading>時間帯 {Math.max(1, (s?.rules.findIndex((r) => r.id === p.ruleID) ?? 0) + 1)}</Heading>
        </View>
        <OpenCircle color={theme.accent} size={28} />
      </View>
      {presentation.state === 'current' && <PeriodRing period={presentation} theme={theme} />}
      <Text style={[styles.caption, styles.observation, { color: theme.muted }]}>{s?.activation === 'enabled' && observed ? '制限設定を反映しました' : '保存した設定上の時間'}</Text>
    </View>; })}
    {!current.length && !!s?.rules.length && <Panel><Heading>次の時間まで</Heading>
      <Body>{s.nextPeriod ? `${endTime(s.nextPeriod.startsAt, now)}から予定しています。` : '有効な次の時間帯はありません。ルールを確認できます。'}</Body>
    </Panel>}
    {!s?.rules.length && <Heading>自分の時間を、ここから。</Heading>}
    {!s?.rules.length && <Panel><Heading>離れたいアプリと、時間を決める</Heading>
      <Body>いつ、どのアプリから離れたいか。あなたのペースで決めていきましょう。</Body>
      <Body muted>必要なときは、自分の言葉で理由を書いて一時解除できます。</Body>
    </Panel>}
    {!s?.rules.length && <Button label="ルールをつくる" disabled={!device || !!state.busy} onPress={create} />}
    {!!s?.rules.length && state.ruleDraft?.dirty && <Button label="編集中のルールに戻る" secondary onPress={() => router.navigate('/rule')} />}
    {!!s?.rules.length && <View style={styles.targets}><Heading>対象のアプリ</Heading>
      {s.authorization === 'approved' ? s.targets.map((target) => <View key={target.ref} style={[styles.target, { borderColor: theme.line }]}>
        <View style={styles.targetLine}>
          <View style={styles.appIdentity}><Applications selectionRef={target.selectionRef} targetRef={target.ref} refreshKey={state.refreshKey} /></View>
          <Text style={[styles.targetStatus, { color: theme.muted }]}>{s.activation === 'paused' ? '停止を保存済み' : s.activation === 'awaitingReauthorizationConfirmation' ? '再開前の確認待ち' : target.grantCommandID ? target.grantStatus === 'active' && observed && (target.grantEndsAt ?? 0) * 1000 > now
            ? '一時解除中' : '解除の状態を確認'
            : target.restricted ? observed ? '制限設定を反映済み' : '設定上の制限対象' : '時間帯の対象外'}</Text>
        </View>
        {s.rules.length > 1 && target.ruleID && <Text style={[styles.caption, { color: theme.muted }]}>適用するルール：時間帯 {s.rules.findIndex((rule) => rule.id === target.ruleID) + 1}</Text>}
        {target.grantCommandID && <Text style={[styles.caption, { color: theme.muted }]}>{target.grantStatus === 'active' && observed && (target.grantEndsAt ?? 0) * 1000 > now
          ? `一時解除の残り ${grantRemaining(target.grantEndsAt!, now)} · ${endTime(target.grantEndsAt!, now)}まで`
          : '解除の要求・再制限の状態を確認できます。'}</Text>}
        {target.grantCommandID && <LinkRow label="解除の状況を見る" onPress={() => router.navigate('/grant')} />}
      </View>) : <Body muted>許可を確認すると、保存した対象を確認できます。</Body>}
      {s.targets.length === 0 && <Body muted>対象のアプリはありません。</Body>}
    </View>}
    {device && s.authorization === 'approved' && s.activation === 'enabled' && s.schedulesReady && s.targets.some((t) => t.unlockable)
      && <Button label="一時解除する" testID="home-unlock-entry" disabled={!!state.busy} onPress={unlock} />}
    {!device && <PoCRecoveryEntry />}
  </FlowScreen>;
}

const styles = StyleSheet.create({
  period: { gap: 12 }, periodHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, periodLabel: { flex: 1, gap: 4 },
  caption: { fontSize: 13, lineHeight: 20 }, observation: { textAlign: 'center' },
  targets: { gap: 8 }, target: { paddingVertical: 10, borderBottomWidth: 1, gap: 4 },
  targetLine: { flexDirection: 'row', alignItems: 'center', gap: 12 }, appIdentity: { flex: 1, minWidth: 0 },
  targetStatus: { maxWidth: '43%', flexShrink: 1, textAlign: 'right', fontSize: 13, lineHeight: 21 },
});
