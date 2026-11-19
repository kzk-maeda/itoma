import { useAppNavigation } from '@/state/navigation';
import { useWorkLifetime } from '@/hooks/use-work-lifetime';
import { useWorkScope } from '@/state/work-scope';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useScreenTime } from '@/state/screen-time';
import { Applications } from './applications';
import { back, useDraftGuard } from './navigation';
import { endTime, ruleText } from './presentation';
import { ruleTitle } from './rule-identity';
import { Body, Button, Field, FlowScreen, Heading, Notice, Panel, flowStyles } from './ui';
import { Alert, View } from 'react-native';
import { useVisibleClock } from '@/hooks/use-visible-clock';
import { hasFreshRestrictionState, targetPeriod, targetScope, unlockCandidates } from '../home/rule-status';

/** Finish only after the shared root discard guards have committed the clean draft.
 * Two commits separate acknowledgement from navigation; no timer changes domain state. */
function useFinishUnlock(screen: 'index' | 'grant') {
  const state = useScreenTime(), navigation = useAppNavigation();
  const [pending, setPending] = useState(false), [ready, setReady] = useState(false);
  useEffect(() => {
    if (pending && state.unlockExitAllowed && !state.busy) setReady(true);
  }, [pending, state.unlockExitAllowed, state.busy]);
  useEffect(() => {
    if (ready && state.unlockExitAllowed && !state.busy) navigation.finish({ screen });
  }, [ready, state.unlockExitAllowed, state.busy, navigation, screen]);
  return useCallback(() => setPending(true), []);
}

function useContinueRestrictions() {
  const state = useScreenTime(), draft = state.unlockDraft, finish = useFinishUnlock('index');
  return () => {
    if (state.busy) return;
    const discard = async () => {
      const result = await state.run('cancelUnlock');
      if (result.status !== 'ok') return;
      state.resetUnlock(); state.setUnlockExitAllowed(true); finish();
    };
    if (draft.reason || draft.targetRef || draft.minutes !== '5') {
      Alert.alert('入力を破棄して制限を続けますか', '理由の保存や一時解除は行いません。入力を続けることもできます。', [
        { text: '入力を続ける', style: 'cancel' },
        { text: '破棄して制限を続ける', onPress: () => { void discard(); } },
      ]);
    } else void discard();
  };
}

export function UnlockScreen() {
  const alive = useWorkLifetime();
  const previous = useWorkScope()?.back ?? back;
  const state = useScreenTime(), navigation = useAppNavigation(), draft = state.unlockDraft;
  const continueRestrictions = useContinueRestrictions();
  const { setUnlockExitAllowed } = state;
  useFocusEffect(useCallback(() => { setUnlockExitAllowed(false); }, [setUnlockExitAllowed]));
  useDraftGuard((!!draft.reason || !!draft.targetRef || draft.minutes !== '5') && !state.unlockExitAllowed, state.canExitUnlock, () => state.setUnlockExitAllowed(true), async () => { const result = await state.run('cancelUnlock'); if (result.status !== 'ok') return false; state.resetUnlock(); return true; });
  const now = useVisibleClock(), candidates = unlockCandidates(state.snapshot, now);
  const selected = candidates.find(target => target.ref === draft.targetRef);
  const selectedScope = useRef('');
  const [changed, setChanged] = useState(false);
  const scope = targetScope(state.snapshot, selected, now);
  useEffect(() => {
    if (!draft.targetRef || state.loading) return;
    if (!selected || (selectedScope.current && selectedScope.current !== scope)) {
      selectedScope.current = ''; setChanged(true);
      state.setUnlockDraft({ ...draft, targetRef: undefined }); state.setUnlockReview(undefined);
    } else selectedScope.current = scope;
  }, [scope, selected, draft, state]);
  const valid = !!selected && !!draft.reason.trim() && /^(?:[1-9]|[12][0-9]|30)$/.test(draft.minutes);
  const preview = async () => {
    if (!valid) return;
    const session = state.unlockSession();
    const result = await state.run('previewUnlock', { targetRef: draft.targetRef, reason: draft.reason, minutes: Number(draft.minutes) });
    if (result.status === 'confirmation-required' && alive() && state.ownsUnlockSession(session)) { state.setUnlockReview(result); router.push('/unlock-confirm'); }
  };
  return <FlowScreen title="必要な分だけ、一時解除" onBack={previous}>
    <Body>使う目的と時間を、いったん言葉に。解除するかどうかは、内容を確認してから決められます。</Body>
    {changed && <Notice title="アプリを選び直してください">適用ルールまたは制限の状態が変わりました。入力した理由と時間は残しています。</Notice>}
    <View style={flowStyles.section}><Heading>いま制限中のアプリ</Heading>
      <Body muted>現在、一時解除できるアプリだけを表示しています。解除中や時間外のアプリは含みません。</Body>
      {candidates.map(target => {
        const period = targetPeriod(state.snapshot, target, now);
        const rule = state.snapshot?.rules.find(rule => rule.id === target.ruleID);
        return <Panel key={target.ref}>
          <Applications selectionRef={target.selectionRef} targetRef={target.ref} refreshKey={state.refreshKey}
            selected={draft.targetRef === target.ref} onSelect={!state.busy ? () => {
              selectedScope.current = targetScope(state.snapshot, target, now); setChanged(false);
              state.setUnlockExitAllowed(false); state.setUnlockDraft({ ...draft, targetRef: target.ref }); state.setUnlockReview(undefined);
            } : undefined} />
          <Body>{ruleTitle(rule, state.snapshot?.rules.findIndex(r => r.id === target.ruleID) ?? 0)}</Body>
          {period && <Body muted>{endTime(period.startsAt, now)}〜{endTime(period.endsAt, now)}の制限</Body>}
          <Body muted>{draft.targetRef === target.ref ? '✓ このアプリを選択中' : 'このアプリだけを一時解除'}</Body>
        </Panel>;
      })}
      {!candidates.length && <Notice title={hasFreshRestrictionState(state.snapshot, now) ? 'いま一時解除できるアプリはありません' : '現在の制限状態を確認してください'}>時間外・解除中のアプリは候補に表示しません。ホームで適用ルールと現在の状態を確認できます。</Notice>}
    </View>
    <Field label="いま使う理由" testID="unlock-reason" value={draft.reason} multiline placeholder="自分の言葉で入力してください"
      onChangeText={(reason) => { state.setUnlockExitAllowed(false); state.setUnlockDraft({ ...draft, reason }); state.setUnlockReview(undefined); }} />
    <Field label="解除時間（1〜30分）" value={draft.minutes} keyboardType="number-pad"
      onChangeText={(minutes) => { state.setUnlockExitAllowed(false); state.setUnlockDraft({ ...draft, minutes }); state.setUnlockReview(undefined); }} />
    <Body muted>理由は確認後、端末内に保存します。時間帯の終了やルールの切替で、解除時間が短くなる場合があります。</Body>
    {!valid && <Body muted>対象のアプリ・空白以外の理由・1〜30分の時間を指定してください。</Body>}
    <Button label="制限を続ける" disabled={!!state.busy} onPress={continueRestrictions} />
    <Button label="解除内容を確認する" testID="unlock-review" secondary disabled={!valid || !!state.busy} onPress={() => { void preview(); }} />
    {state.snapshot?.targets.some(target => target.grantCommandID) && <Button label="進行中の解除を確認する" secondary onPress={() => navigation.open({ screen: 'grant' })} />}
  </FlowScreen>;
}

export function UnlockConfirmationScreen() {
  const alive = useWorkLifetime();
  const previous = useWorkScope()?.back ?? back;
  const state = useScreenTime(), navigation = useAppNavigation(), draft = state.unlockDraft, review = state.unlockReview;
  const continueRestrictions = useContinueRestrictions();
  const finish = useFinishUnlock('grant');
  const [failed, setFailed] = useState(false);
  const now = useVisibleClock();
  const [openedAt] = useState(now);
  const confirmed = review?.snapshot ?? state.snapshot;
  const target = confirmed?.targets.find((t) => t.ref === draft.targetRef);
  const rule = confirmed?.rules.find((r) => r.id === target?.ruleID);
  const current = unlockCandidates(state.snapshot, now).find(candidate => candidate.ref === draft.targetRef);
  const stillValid = !!current && targetScope(confirmed, target, now) === targetScope(state.snapshot, current, now)
    && (review?.previewEndsAt ?? 0) * 1000 > now;
  const submit = async () => {
    if (!review?.ref || !stillValid) return;
    const session = state.unlockSession();
    state.setUnlockExitAllowed(true);
    const result = await state.run('unlock', { ref: review.ref, reason: draft.reason });
    if (!state.ownsUnlockSession(session)) return;
    const accepted = !!result.ref && result.snapshot?.targets.some((t) => t.grantCommandID === result.ref);
    if (result.status === 'ok' || accepted) {
      state.resetUnlock(); state.setUnlockExitAllowed(true);
      if (alive()) finish();
    } else if (alive()) setFailed(true);
  };
  return <FlowScreen title="この内容で一時解除しますか" onBack={previous}>
    {target && <Panel><Heading>このアプリだけを解除</Heading><Applications selectionRef={target.selectionRef} targetRef={target.ref} refreshKey={state.refreshKey} />
      <Body>ほかの対象アプリの設定は変更しません。</Body></Panel>}
    {rule ? <Panel><Heading>この解除に適用するルール</Heading><Body>{ruleTitle(rule, confirmed?.rules.findIndex(r => r.id === rule.id) ?? 0)}</Body><Body>{ruleText(rule)}</Body></Panel>
      : <Notice title="適用するルールを確認し直してください">入力へ戻って、最新の解除内容を確認できます。</Notice>}
    <Panel><Heading>あなたの理由</Heading><Body>{draft.reason}</Body></Panel>
    <Panel><Heading>解除の時間</Heading><Body>最大 {review?.minutes ?? draft.minutes}分</Body>
      {review?.previewEndsAt && <Body>{endTime(review.previewEndsAt, openedAt)}までが上限です。確定が遅れると、解除できる時間は短くなります。</Body>}
      {review?.shortened && <Notice title="時間が短くなります">時間帯の終了または優先ルールの切替に合わせて、解除の上限が早まっています。</Notice>}
    </Panel>
    <Body muted>再制限の予定を登録できた場合だけ解除を進めます。反映の結果は次の画面で確認できます。</Body>
    <Button label="制限を続ける" disabled={!!state.busy} onPress={continueRestrictions} />
    {!stillValid && <Notice title="解除内容を確認し直してください">適用ルールや期限が変わっています。入力に戻って、今の対象と解除時間を確認できます。</Notice>}
    {!failed && <Button label="理由を保存して一時解除する" testID="unlock-submit" secondary disabled={!review?.ref || !rule || !stillValid || !!state.busy} onPress={() => { void submit(); }} />}
    {failed && <Notice title="解除の完了を確認できません">入力は残っています。条件を確認し直せます。</Notice>}
    {failed && (state.error === 'busy' || state.error === 'storage-failed') && <Button label="同じ上限のまま受理を再試行する" disabled={!!state.busy} onPress={() => { void submit(); }} />}
    <Button label="入力に戻る" secondary disabled={!!state.busy} onPress={previous} />
    <Button label="現在の解除状況を確認する" secondary onPress={() => navigation.finish({ screen: 'grant' })} />
  </FlowScreen>;
}
