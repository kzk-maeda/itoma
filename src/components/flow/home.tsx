import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Alert, View } from 'react-native';
import { useVisibleClock } from '@/hooks/use-visible-clock';
import { useScreenTime } from '@/state/screen-time';
import { completeNativeHomeSmoke } from '@/qa/native-smoke';
import { PeriodRing } from '../home/period-ring';
import { presentPeriod } from '../home/period-presentation';
import { PoCRecoveryEntry } from '../home/poc-recovery-entry';
import { Applications } from './applications';
import { Body, Button, FlowScreen, Heading, Notice, Panel, useFlowTheme, flowStyles } from './ui';
import { endTime, grantRemaining } from './presentation';

export function ProductHome() {
  const state = useScreenTime(), theme = useFlowTheme(), now = useVisibleClock();
  const s = state.snapshot;
  const { refresh } = state;
  const boundary = useRef('');
  useEffect(() => { completeNativeHomeSmoke(); }, []);
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
  return <FlowScreen title={s?.rules.length ? '自分で決めた時間' : '自分の時間を、ここから。'}>
    {state.loading && <Body muted>現在の設定を確認しています。</Body>}
    {!state.loading && !device && <Notice title="iPhoneのITOMAで設定できます">
      {s?.availability === 'simulator' ? 'この環境ではスクリーンタイムの認可や実際の制限は行いません。対応するiPhone版で設定できます。'
        : 'この環境では制限機能を利用できません。対応するiPhone版をご利用ください。'}
    </Notice>}
    {state.legacyActive && <Notice title="手動検証の制限が残っています">
      通常の一時解除を使う前に、以前の手動検証の制限を停止してください。
    </Notice>}
    {state.legacyActive && <Button label="手動検証の制限を確認して停止" secondary disabled={!!state.busy} onPress={stopLegacy} />}
    {device && s.authorization !== 'approved' && <Notice title="スクリーンタイムの許可が必要です">設定を残したまま、許可を確認できます。許可だけで制限を再開することはありません。</Notice>}
    {device && s.authorization !== 'approved' && <Button label="許可を確認する" onPress={() => router.push('/onboarding')} />}
    {s?.activation === 'paused' && <Notice title="ルールの停止を保存しています">ルールは保存されています。再開にはご自身の操作が必要です。停止の反映は、現在の状態の確認から取得できます。</Notice>}
    {s?.activation === 'awaitingReauthorizationConfirmation' && <Notice title="再開前に対象を確認してください">ルールの対象アプリを選び直してから、設定画面で明示的に再開できます。</Notice>}
    {device && !!s.rules.length && s.activation === 'enabled' && (!s.schedulesReady || !observed) && <Notice title="制限の状態を確認してください">
      {s.schedulesReady ? '反映を確認できていません。以下の時間帯は保存した設定です。' : '自動切替の予定を確認できていません。現在の制限と今後の予定を確認できます。'}
    </Notice>}
    {current.map((p) => { const presentation = presentPeriod(p.startsAt * 1000, p.endsAt * 1000, now); return <View key={`${p.ruleID}:${p.startsAt}`} style={flowStyles.center}>
      <Heading>時間帯 {Math.max(1, (s?.rules.findIndex((r) => r.id === p.ruleID) ?? 0) + 1)}</Heading>
      <Body muted>{s?.activation === 'enabled' && observed ? '制限設定を反映しました' : '保存した設定上の時間'}</Body>
      {presentation.state === 'current' && <PeriodRing period={presentation} theme={theme} />}
    </View>; })}
    {!current.length && !!s?.rules.length && <Panel><Heading>次の時間まで</Heading>
      <Body>{s.nextPeriod ? `${endTime(s.nextPeriod.startsAt, now)}から予定しています。` : '有効な次の時間帯はありません。ルールを確認できます。'}</Body>
    </Panel>}
    {!s?.rules.length && <Panel><Heading>離れたいアプリと、時間を決める</Heading>
      <Body>いつ、どのアプリから離れたいか。あなたのペースで決めていきましょう。</Body>
      <Body muted>必要なときは、自分の言葉で理由を書いて一時解除できます。</Body>
    </Panel>}
    {!s?.rules.length && <Button label="ルールをつくる" disabled={!device || !!state.busy} onPress={create} />}
    {!!s?.rules.length && state.ruleDraft?.dirty && <Button label="編集中のルールに戻る" secondary onPress={() => router.navigate('/rule')} />}
    {!!s?.rules.length && <View style={flowStyles.section}><Heading>対象のアプリ</Heading>
      {s.authorization === 'approved' ? s.targets.map((target) => <Panel key={target.ref}>
        <Applications selectionRef={target.selectionRef} targetRef={target.ref} refreshKey={state.refreshKey} />
        {target.ruleID && <Body muted>適用するルール：時間帯 {s.rules.findIndex((rule) => rule.id === target.ruleID) + 1}</Body>}
        <Body muted>{s.activation === 'paused' ? 'ルールの停止を保存しています' : s.activation === 'awaitingReauthorizationConfirmation' ? '再開前の確認待ちです' : target.grantCommandID ? target.grantStatus === 'active' && observed && (target.grantEndsAt ?? 0) * 1000 > now
          ? `一時解除の残り ${grantRemaining(target.grantEndsAt!, now)} · ${endTime(target.grantEndsAt!, now)}まで`
          : '解除の要求・再制限の状態を確認できます。'
          : target.restricted ? observed ? 'この時間帯の制限設定を反映しました' : '設定上の制限対象です' : '現在の時間帯の制限対象ではありません'}</Body>
        {target.grantCommandID && <Button label="解除の状況を見る" secondary onPress={() => router.push('/grant')} />}
      </Panel>) : <Body muted>許可を確認すると、保存した対象を確認できます。</Body>}
      {s.targets.length === 0 && <Body muted>対象のアプリはありません。</Body>}
    </View>}
    {device && s.authorization === 'approved' && s.activation === 'enabled' && s.schedulesReady && s.targets.some((t) => t.unlockable)
      && <Button label="一時解除する" testID="home-unlock-entry" disabled={!!state.busy} onPress={unlock} />}
    <Button label="ルールと設定" secondary onPress={() => router.push('/settings')} />
    {device && <Button label="現在の状態を確認する" secondary disabled={!!state.busy} onPress={() => { void state.run('reconcile'); }} />}
    {!device && <PoCRecoveryEntry />}
  </FlowScreen>;
}
