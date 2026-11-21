import identity from '../../../assets/brand/identity.json';
import { useAppNavigation } from '@/state/navigation';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useHomeTimeContext } from '@/hooks/use-home-time-context';
import { useVisibleClock } from '@/hooks/use-visible-clock';
import { useScreenTime } from '@/state/screen-time';
import { useOptionalOnboarding } from '@/state/onboarding';
import { completeNativeHomeSmoke } from '@/qa/native-smoke';
import { PoCRecoveryEntry } from '../home/poc-recovery-entry';
import { Body, Button, FlowScreen, Heading, Notice, Panel } from './ui';
import { CurrentRules } from '../home/rule-status-view';
import { hasFreshRestrictionState, targetScope, unlockCandidates } from '../home/rule-status';

export function ProductHome() {
  const state = useScreenTime(), setup = useOptionalOnboarding(), now = useVisibleClock(), navigation = useAppNavigation();
  const s = state.snapshot;
  const clockConfirmed = useHomeTimeContext(now);
  const { refresh } = state;
  const boundary = useRef('');
  const visited = useRef(false);
  const focused = useRef(false);
  const setupRun = setup?.run, setupProgress = setup?.progress;
  const availability = s?.availability, ruleCount = s?.rules.length ?? 0;
  useFocusEffect(useCallback(() => {
    if (!setupRun || !setupProgress || state.loading || availability !== 'device' || visited.current) return;
    if (!setupProgress.completed && !setupProgress.draft && ruleCount) {
      visited.current = true; void setupRun('onboardingAdopt');
    } else if (!setupProgress.seenIntro && !ruleCount) {
      visited.current = true;
      // Mark the introduction seen before navigation; returning never forces it repeatedly.
      void setupRun('onboardingDefer').then(result => { if (result.status === 'ok' && focused.current) navigation.start({ screen: 'onboarding' }, { screen: 'index' }); });
    }
  }, [setupRun, setupProgress, availability, ruleCount, state.loading, navigation]));
  useFocusEffect(useCallback(() => { focused.current = true; completeNativeHomeSmoke(); return () => { focused.current = false; }; }, []));
  useEffect(() => {
    if (!s) return;
    const times = [s.validUntil, s.nextPeriod?.startsAt, ...s.periods.map((p) => p.endsAt), ...s.targets.map((t) => t.grantEndsAt)].filter((n): n is number => n !== undefined);
    const passed = times.filter((n) => n * 1000 <= now);
    const key = `${s.sequence}:${passed.join(',')}`;
    if (passed.length && boundary.current !== key) { boundary.current = key; void refresh(); }
  }, [now, s, refresh]);
  const device = s?.availability === 'device';
  const observed = hasFreshRestrictionState(s, now) && !state.error && clockConfirmed;
  const firstRun = !!setup && !setup.progress?.completed;
  const create = () => { if (firstRun) { navigation.start({ screen: 'onboarding' }, { screen: 'index' }); return; } if (!state.ruleDraft?.dirty) state.beginRule(); navigation.start({ screen: s?.authorization === 'approved' ? 'rule' : 'onboarding' }, { screen: 'index' }); };
  const unlock = async (ruleID: string) => {
    if (state.busy || state.legacyActive) return;
    const session = state.unlockSession();
    if (state.unlockPreviewRef && (await state.run('cancelUnlock')).status !== 'ok') return;
    if (!focused.current || !state.ownsUnlockSession(session)) return;
    const draft = state.currentUnlockDraft(), snapshot = state.currentSnapshot(), at = Date.now();
    const target = unlockCandidates(snapshot, at, ruleID).find(t => t.ref === draft.targetRef);
    const keep = draft.ruleID === ruleID && !!target && draft.targetScope === targetScope(snapshot, target, at);
    state.resetUnlock(); // A new explicit entry owns late responses independently of earlier work.
    state.setUnlockDraft({ ...draft, ruleID, targetRef: keep ? draft.targetRef : undefined, targetScope: keep ? draft.targetScope : undefined });
    state.setUnlockExitAllowed(false);
    navigation.start({ screen: 'unlock' }, { screen: 'index' });
  };
  const stopLegacy = () => Alert.alert('手動検証の制限を停止しますか', '以前の手動検証で指定した制限だけを停止します。通常のルールと保存した対象は削除しません。', [
    { text: '戻る', style: 'cancel' }, { text: '手動検証の制限を停止', onPress: () => { void state.run('stopLegacy'); } },
  ]);
  return <FlowScreen title={identity.name} tab="home">
    {state.ruleDetailsState === 'unavailable' && <Notice title="ルール名と行動目標を確認できません">制限の設定は引き続き確認できます。設定タブからもう一度読み直せます。</Notice>}
    {state.ruleDetailsState === 'checking' && !state.loading && !!s?.rules.length && <Body muted>ルール名と行動目標を確認しています。</Body>}
    {state.loading && <Body muted>現在の設定を確認しています。</Body>}
    {device && setup?.draft && setup.busy && <Notice title="初回設定の結果を確認しています">受け付けた操作は、画面を離れても続きます。同じ操作を重ねず、処理結果を確認してください。</Notice>}
    {!state.loading && !device && <Notice title="iPhoneのITOMAで設定できます">
      {s?.availability === 'simulator' ? 'この環境ではスクリーンタイムの認可や実際の制限は行いません。対応するiPhone版で設定できます。'
        : 'この環境では制限機能を利用できません。対応するiPhone版をご利用ください。'}
    </Notice>}
    {state.legacyActive && <Notice title="手動検証の制限が残っています">
      通常の一時解除を使う前に、以前の手動検証の制限を停止してください。
    </Notice>}
    {state.legacyActive && <Button label="手動検証の制限を確認して停止" secondary disabled={!!state.busy} onPress={stopLegacy} />}
    {device && !!s.rules.length && s.authorization !== 'approved' && <Notice title="スクリーンタイムの許可が必要です">設定を残したまま、許可を確認できます。再開前に対象アプリと保存したルールを確認できます。</Notice>}
    {device && !!s.rules.length && s.authorization !== 'approved' && <Button label="許可を確認する" onPress={() => navigation.start({ screen: 'onboarding' }, { screen: 'index' })} />}
    {s?.activation === 'paused' && <Notice title="ルールの停止を保存しています">ルールは保存されています。再開にはご自身の操作が必要です。設定タブから現在の状態を確認できます。</Notice>}
    {s?.activation === 'awaitingReauthorizationConfirmation' && <Notice title="再開前に対象を確認してください">ルールの対象アプリを選び直してから、設定画面で明示的に再開できます。</Notice>}
    {device && !!s.rules.length && !state.loading && s.activation === 'enabled' && s.authorization === 'approved'
      && !s.needsSelectionReview && !observed && <Notice title="制限の状態を確認してください"
        action={<Button label="スクリーンタイムで確認する" secondary onPress={() => navigation.open({ screen: 'settings-screen-time' })} />}>
      {s.schedulesReady ? '制限の反映を確認できていません。画面の時間帯は保存した設定です。' : '自動切替の予定を確認できていません。'}
    </Notice>}
    {!!state.unlockDraft.reason && <Body muted>一時解除の入力を残しています。ルールを選ぶと続きを入力できます。</Body>}
    {!!s?.rules.length && <CurrentRules snapshot={s} now={now} clockConfirmed={clockConfirmed} ready={!state.loading && !state.busy && !state.error && !state.legacyActive && state.ruleDetailsState !== 'checking' && !setup?.loading && !setup?.draft && (!setup?.progress || setup.progress.completed)} onUnlock={ruleID => { void unlock(ruleID); }} />}
    {!s?.rules.length && <Heading>自分の時間を、ここから。</Heading>}
    {!s?.rules.length && setup?.draft && !setup.busy && <Notice title={setup.draft.submitted ? '初回設定の反映を確認してください' : '初回設定は途中です'}>{setup.draft.submitted
      ? '前の要求は完了を確認できていません。入力は残っています。設定を続けて、結果と再試行する内容を確認できます。'
      : '目的・曜日・時間の入力を残しています。許可と対象を確認し、最後に確定するまで制限は始まりません。'}</Notice>}
    {!s?.rules.length && <Panel><Heading>離れたいアプリと、時間を決める</Heading>
      <Body>いつ、どのアプリから離れたいか。あなたのペースで決めていきましょう。</Body>
      <Body muted>必要なときは、自分の言葉で理由を書いて一時解除できます。</Body>
    </Panel>}
    {!s?.rules.length && <Button label={firstRun ? setup.draft ? setup.busy || setup.draft.submitted ? '初回設定の結果を確認する' : '初回設定を続ける' : '初回設定を始める' : 'ルールをつくる'} disabled={!device || !!state.busy || !!setup?.busy || !!setup?.loading} onPress={create} />}
    {device && !!s?.rules.length && !!setup?.draft && <Button label="初回設定の結果を確認する" secondary onPress={() => navigation.start({ screen: 'onboarding' }, { screen: 'index' })} />}
    {!!s?.rules.length && state.ruleDraft?.dirty && <Button label="編集中のルールに戻る" secondary onPress={() => navigation.start(state.ruleDraft?.createdRuleID ? { screen: 'rule-details', ruleID: state.ruleDraft.createdRuleID } : { screen: 'rule' }, { screen: 'index' })} />}
    {!device && <PoCRecoveryEntry />}
  </FlowScreen>;
}
