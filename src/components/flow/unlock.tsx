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
import { Body, Button, Field, FlowScreen, Heading, LinkRow, Notice, Panel, flowStyles, useFlowTheme } from './ui';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useVisibleClock } from '@/hooks/use-visible-clock';
import { currentRulePeriods, currentRuleTargets, hasFreshRestrictionState, targetPeriod, targetScope, unlockCandidates } from '../home/rule-status';

/** An async response may update native state, but a hidden/old flow cannot redirect. */
function useUnlockLifetime() {
  const mounted = useWorkLifetime(), focused = useRef(false);
  useFocusEffect(useCallback(() => { focused.current = true; return () => { focused.current = false; }; }, []));
  return useCallback(() => mounted() && focused.current, [mounted]);
}

/** Wait for clean/allowed drafts and the root guards to commit before typed completion. */
function useFinishUnlock(screen: 'index' | 'grant') {
  const state = useScreenTime(), navigation = useAppNavigation(), alive = useUnlockLifetime();
  const [pending, setPending] = useState<number>(), [ready, setReady] = useState(false);
  const done = useRef(false);
  useEffect(() => {
    if (pending === undefined || !state.unlockExitAllowed || state.busy) return;
    let active = true;
    queueMicrotask(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [pending, state.unlockExitAllowed, state.busy]);
  useEffect(() => {
    if (ready && pending !== undefined && !done.current && state.unlockExitAllowed && !state.busy
      && state.ownsUnlockSession(pending) && alive()) {
      done.current = true; navigation.finish({ screen });
    }
  }, [ready, pending, state, navigation, screen, alive]);
  return useCallback(() => { done.current = false; setReady(false); setPending(state.unlockSession()); }, [state]);
}

function useContinueRestrictions() {
  const state = useScreenTime(), draft = state.unlockDraft, finish = useFinishUnlock('index'), alive = useUnlockLifetime();
  return () => {
    if (state.busy) return;
    const session = state.unlockSession();
    const discard = async () => {
      if (!alive() || !state.ownsUnlockSession(session)) return;
      const result = await state.run('cancelUnlock');
      if (result.status !== 'ok' || !state.ownsUnlockSession(session) || !alive()) return;
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
  const alive = useUnlockLifetime();
  const previous = useWorkScope()?.back ?? back;
  const state = useScreenTime(), navigation = useAppNavigation(), draft = state.unlockDraft;
  const continueRestrictions = useContinueRestrictions();
  const returnHome = useFinishUnlock('index');
  const { setUnlockExitAllowed } = state;
  useFocusEffect(useCallback(() => { setUnlockExitAllowed(false); }, [setUnlockExitAllowed]));
  useDraftGuard((!!draft.reason || !!draft.targetRef || draft.minutes !== '5') && !state.unlockExitAllowed, state.canExitUnlock, () => state.setUnlockExitAllowed(true), async () => { const session = state.unlockSession(); const result = await state.run('cancelUnlock'); if (result.status !== 'ok' || !state.ownsUnlockSession(session)) return false; state.resetUnlock(); return true; });
  const now = useVisibleClock();
  const chosenRule = state.snapshot?.rules.find(rule => rule.id === draft.ruleID);
  const candidates = !state.legacyActive ? unlockCandidates(state.snapshot, now, draft.ruleID) : [];
  const chosenPeriod = currentRulePeriods(state.snapshot, now).find(period => period.ruleID === draft.ruleID);
  const chooseRuleAgain = async () => {
    const session = state.unlockSession();
    if (state.unlockPreviewRef && (await state.run('cancelUnlock')).status !== 'ok') return;
    if (!alive() || !state.ownsUnlockSession(session)) return;
    state.setUnlockReview(undefined); state.setUnlockPreviewRef(undefined); state.setUnlockExitAllowed(true); returnHome();
  };
  const selected = candidates.find(target => target.ref === draft.targetRef);
  const [changed, setChanged] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const scope = targetScope(state.snapshot, selected, now);
  useEffect(() => {
    if (!draft.targetRef || state.loading || (selected && draft.targetScope === scope)) return;
    let active = true;
    queueMicrotask(() => {
      if (!active || !alive() || state.currentUnlockDraft() !== draft) return;
      setChanged(true);
      state.setUnlockDraft({ ...draft, targetRef: undefined, targetScope: undefined }); state.setUnlockReview(undefined);
    });
    return () => { active = false; };
  }, [scope, selected, draft, state, alive]);
  const valid = !!selected && draft.targetScope === scope && !!draft.reason.trim() && /^(?:[1-9]|[12][0-9]|30)$/.test(draft.minutes);
  const preview = async () => {
    if (!valid || state.busy) return;
    setPreviewFailed(false);
    state.setUnlockReview(undefined);
    const session = state.unlockSession();
    const result = await state.run('previewUnlock', { targetRef: draft.targetRef, reason: draft.reason, minutes: Number(draft.minutes) });
    if (result.status !== 'confirmation-required' || !state.ownsUnlockSession(session)) return;
    const { ref, snapshot: previewSnapshot, previewEndsAt } = result;
    if (ref) state.setUnlockPreviewRef(ref);
    const snapshot = state.currentSnapshot(), at = Date.now();
    const current = unlockCandidates(snapshot, at, draft.ruleID).find(t => t.ref === draft.targetRef);
    const confirmed = previewSnapshot?.targets.find(t => t.ref === draft.targetRef);
    const stillEditing = () => alive() && state.ownsUnlockSession(session) && state.currentUnlockDraft() === draft;
    if (stillEditing() && ref && previewSnapshot && previewEndsAt !== undefined && current && confirmed
      && draft.targetScope === targetScope(snapshot, current, at)
      && draft.targetScope === targetScope(previewSnapshot, confirmed, at)
      && snapshot?.revision === previewSnapshot.revision && previewEndsAt * 1000 > at) {
      state.setUnlockReview({ ...result, ref, snapshot: previewSnapshot, previewEndsAt });
      router.push('/unlock-confirm');
      return;
    }
    if (stillEditing()) setPreviewFailed(true);
    const cancelled = await state.run('cancelUnlock');
    if (cancelled.status === 'ok' && state.ownsUnlockSession(session)) state.setUnlockPreviewRef(undefined);
  };
  return <FlowScreen title="必要な分だけ、一時解除" onBack={previous}>
    <Body>使う目的と時間を、いったん言葉に。解除するかどうかは、内容を確認してから決められます。</Body>
    {chosenRule && <Panel><Heading>{ruleTitle(chosenRule, state.snapshot?.rules.indexOf(chosenRule) ?? 0)}</Heading><Body muted>{chosenPeriod ? `${endTime(chosenPeriod.startsAt, now)}〜${endTime(chosenPeriod.endsAt, now)}` : ruleText(chosenRule)}</Body><Body muted>このルールで、いま制限中のアプリから選びます。</Body></Panel>}
    {changed && <Notice title="アプリを選び直してください">適用ルールまたは制限の状態が変わりました。入力した理由と時間は残しています。</Notice>}
    <View style={flowStyles.section}><Heading>いま制限中のアプリ</Heading>
      <Body muted>このルールで一時解除できるアプリだけを表示しています。</Body>
      {candidates.map(target => {
        return <Panel key={target.ref}>
          <Applications selectionRef={target.selectionRef} targetRef={target.ref} refreshKey={state.refreshKey}
            selected={draft.targetRef === target.ref} onSelect={!state.busy ? () => {
              setChanged(false);
              state.setUnlockExitAllowed(false); state.setUnlockDraft({ ...draft, targetRef: target.ref, targetScope: targetScope(state.snapshot, target, now) }); state.setUnlockReview(undefined);
            } : undefined} />
          <Body muted>{draft.targetRef === target.ref ? '✓ このアプリを選択中' : 'このアプリだけを一時解除'}</Body>
        </Panel>;
      })}
      {!candidates.length && <Notice title={!draft.ruleID ? 'ホームでルールを選んでください' : hasFreshRestrictionState(state.snapshot, now) ? 'このルールで一時解除できるアプリはありません' : '現在の制限状態を確認してください'}>ほかのルールのアプリは表示しません。入力した理由と時間を残して、ホームでルールを選び直せます。</Notice>}
      <LinkRow label="ホームでルールを選び直す" disabled={!!state.busy} onPress={() => { void chooseRuleAgain(); }} />
    </View>
    <Field label="いま使う理由" testID="unlock-reason" value={draft.reason} multiline placeholder="自分の言葉で入力してください"
      onChangeText={(reason) => { state.setUnlockExitAllowed(false); state.setUnlockDraft({ ...draft, reason }); state.setUnlockReview(undefined); }} />
    <Field label="解除時間（1〜30分）" value={draft.minutes} keyboardType="number-pad"
      onChangeText={(minutes) => { state.setUnlockExitAllowed(false); state.setUnlockDraft({ ...draft, minutes }); state.setUnlockReview(undefined); }} />
    <Body muted>理由は確認後、端末内に保存します。時間帯の終了やルールの切替で、解除時間が短くなる場合があります。</Body>
    {!valid && <Body muted>対象のアプリ・空白以外の理由・1〜30分の時間を指定してください。</Body>}
    {previewFailed && <Notice title="解除内容を確認できませんでした">理由と希望時間は残っています。対象アプリを確認して、もう一度お試しください。</Notice>}
    <Button label="制限を続ける" disabled={!!state.busy} onPress={continueRestrictions} />
    <Button label="解除内容を確認する" testID="unlock-review" secondary disabled={!valid || !!state.busy} onPress={() => { void preview(); }} />
    {state.snapshot?.targets.some(target => target.grantCommandID) && <Button label="進行中の解除を確認する" secondary onPress={() => navigation.open({ screen: 'grant' })} />}
  </FlowScreen>;
}

export function UnlockConfirmationScreen() {
  const alive = useUnlockLifetime();
  const previous = useWorkScope()?.back ?? back;
  const state = useScreenTime(), navigation = useAppNavigation(), draft = state.unlockDraft, review = state.unlockReview;
  const continueRestrictions = useContinueRestrictions();
  const finish = useFinishUnlock('grant');
  const [failed, setFailed] = useState(false);
  const submitting = useRef(false), theme = useFlowTheme();
  const now = useVisibleClock();
  const confirmed = review?.snapshot;
  const target = confirmed?.targets.find((t) => t.ref === draft.targetRef);
  const ruleIndex = confirmed?.rules.findIndex(r => r.id === target?.ruleID) ?? -1;
  const rule = confirmed?.rules[ruleIndex], ruleName = rule && ruleTitle(rule, ruleIndex);
  const expiry = review?.previewEndsAt ?? 0, remaining = expiry - now / 1000;
  const period = targetPeriod(confirmed, target, now);
  const current = (!state.legacyActive ? unlockCandidates(state.snapshot, now, draft.ruleID) : []).find(candidate => candidate.ref === draft.targetRef);
  const stillValid = !!review && !!rule && !!period && !!current && draft.targetScope === targetScope(confirmed, target, now)
    && state.snapshot?.revision === confirmed?.revision && targetScope(confirmed, target, now) === targetScope(state.snapshot, current, now)
    && remaining > 0;
  const otherRestrictions = stillValid && !state.error
    ? currentRuleTargets(state.snapshot, now).filter(app => app.ref !== target?.ref && app.restricted && !app.grantCommandID) : [];
  const cappedByRuleEnd = expiry === period?.endsAt && confirmed?.nextPeriod?.startsAt !== expiry;
  const submit = async () => {
    const snapshot = state.currentSnapshot(), at = Date.now();
    const candidate = unlockCandidates(snapshot, at, draft.ruleID).find(t => t.ref === draft.targetRef);
    if (submitting.current || state.busy || !review || !stillValid || !candidate || snapshot?.revision !== review.snapshot.revision
      || state.currentUnlockDraft() !== draft || draft.targetScope !== targetScope(snapshot, candidate, at) || expiry * 1000 <= at) return;
    const session = state.unlockSession();
    submitting.current = true;
    try {
      const result = await state.run('unlock', { ref: review.ref, reason: draft.reason });
      if (!state.ownsUnlockSession(session)) return;
      const accepted = !!result.ref && result.snapshot?.targets.some((t) => t.grantCommandID === result.ref);
      if (result.status === 'ok' || accepted) {
        state.resetUnlock(); state.setUnlockExitAllowed(true);
        if (alive()) finish();
      } else if (alive()) { state.setUnlockExitAllowed(false); setFailed(true); }
    } finally { submitting.current = false; }
  };
  return <FlowScreen title="一時解除の確認" onBack={previous}>
    {stillValid && target && <Panel>
      <Heading>このアプリだけを一時解除</Heading>
      <Applications selectionRef={target.selectionRef} targetRef={target.ref} refreshKey={state.refreshKey} />
      <Body muted>解除の上限</Body>
      <Text style={[styles.deadline, { color: theme.text }]}>{endTime(expiry, now)}まで</Text>
      <Body>{remaining < 60 ? 'いま確定すると1分未満' : `いま確定すると最大${Math.floor(remaining / 60)}分`}</Body>
      {review?.shortened && <Body muted>{cappedByRuleEnd ? `希望は${draft.minutes}分ですが、「${ruleName}」は${endTime(expiry, now)}に終了します。`
        : `希望は${draft.minutes}分です。時間帯の終了または優先ルールの切替に合わせて、解除の上限が早まっています。`}</Body>}
    </Panel>}
    {!state.busy && !state.unlockExitAllowed && !stillValid && <Notice title="解除内容を確認し直してください">{expiry > 0 && remaining <= 0 ? '確認した期限を過ぎました。' : '対象アプリ、適用ルール、または期限を確認できません。'}入力に戻って、最新の内容を確認できます。</Notice>}
    {stillValid && rule && <View style={flowStyles.section}><Heading>この解除に適用するルール</Heading><Body>{ruleName}</Body><Body muted>{ruleText(rule)}</Body></View>}
    {otherRestrictions.length > 0 && <View style={flowStyles.section}><Heading>引き続き制限するアプリ</Heading>
      {otherRestrictions.map(app => <Applications key={app.ref} selectionRef={app.selectionRef} targetRef={app.ref} refreshKey={state.refreshKey} />)}
    </View>}
    <View style={flowStyles.section}><Heading>あなたの理由</Heading><Body>{draft.reason}</Body></View>
    <Body muted>再制限の予定を登録できた場合だけ解除を進めます。反映の結果は次の画面で確認できます。</Body>
    <Button label="制限を続ける" disabled={!!state.busy} onPress={continueRestrictions} />
    {!failed && <Button label="理由を保存して一時解除する" testID="unlock-submit" secondary disabled={!stillValid || !!state.busy} onPress={() => { void submit(); }} />}
    {failed && <Notice title="解除の完了を確認できません">入力は残っています。条件を確認し直せます。</Notice>}
    {failed && (state.error === 'busy' || state.error === 'storage-failed') && <Button label="同じ上限のまま受理を再試行する" secondary disabled={!stillValid || !!state.busy} onPress={() => { void submit(); }} />}
    <Button label="入力に戻る" secondary disabled={!!state.busy} onPress={previous} />
    <Button label="現在の解除状況を確認する" secondary onPress={() => navigation.finish({ screen: 'grant' })} />
  </FlowScreen>;
}

const styles = StyleSheet.create({ deadline: { fontSize: 32, lineHeight: 44, fontVariant: ['tabular-nums'] } });
