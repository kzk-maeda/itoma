import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useScreenTime } from '@/state/screen-time';
import { Applications } from './applications';
import { back, useDraftGuard } from './navigation';
import { endTime, ruleText } from './presentation';
import { Body, Button, Field, FlowScreen, Heading, Notice, Panel, flowStyles } from './ui';
import { View } from 'react-native';

export function UnlockScreen() {
  const state = useScreenTime(), draft = state.unlockDraft;
  const { setUnlockExitAllowed } = state;
  useFocusEffect(useCallback(() => { setUnlockExitAllowed(false); }, [setUnlockExitAllowed]));
  useDraftGuard((!!draft.reason || !!draft.targetRef) && !state.unlockExitAllowed, state.canExitUnlock, () => state.setUnlockExitAllowed(true), () => { void state.run('cancelUnlock'); state.resetUnlock(); });
  const selected = state.snapshot?.targets.find((t) => t.ref === draft.targetRef);
  const available = state.snapshot?.authorization === 'approved' && state.snapshot.activation === 'enabled' && state.snapshot.schedulesReady;
  const valid = available && !!selected?.unlockable && !!draft.reason.trim() && /^(?:[1-9]|[12][0-9]|30)$/.test(draft.minutes);
  const preview = async () => {
    if (!valid) return;
    const result = await state.run('previewUnlock', { targetRef: draft.targetRef, reason: draft.reason, minutes: Number(draft.minutes) });
    if (result.status === 'confirmation-required') { state.setUnlockReview(result); router.push('/unlock-confirm'); }
  };
  return <FlowScreen title="必要な分だけ、一時解除" onBack={back}>
    <Body>使う目的と時間を、いったん言葉に。解除するかどうかは、内容を確認してから決められます。</Body>
    <View style={flowStyles.section}><Heading>解除するアプリ</Heading>
      {state.snapshot?.targets.map((target) => <Panel key={target.ref}>
        <Applications selectionRef={target.selectionRef} targetRef={target.ref} refreshKey={state.refreshKey}
          selected={draft.targetRef === target.ref} onSelect={available && target.unlockable && !state.busy ? () => {
            state.setUnlockExitAllowed(false); state.setUnlockDraft({ ...draft, targetRef: target.ref }); state.setUnlockReview(undefined);
          } : undefined} />
        <Body muted>{target.unlockable ? draft.targetRef === target.ref ? '✓ このアプリを選択中' : 'このアプリを選べます'
          : target.grantCommandID ? 'このアプリには進行中の要求があります。状況を確認できます。' : '現在、一時解除できる制限対象ではありません。'}</Body>
      </Panel>)}
      {!state.snapshot?.targets.length && <Body muted>解除できる対象がありません。ホームで現在の時間帯と許可を確認できます。</Body>}
    </View>
    <Field label="いま使う理由" testID="unlock-reason" value={draft.reason} multiline placeholder="自分の言葉で入力してください"
      onChangeText={(reason) => { state.setUnlockExitAllowed(false); state.setUnlockDraft({ ...draft, reason }); state.setUnlockReview(undefined); }} />
    <Field label="解除時間（1〜30分）" value={draft.minutes} keyboardType="number-pad"
      onChangeText={(minutes) => { state.setUnlockExitAllowed(false); state.setUnlockDraft({ ...draft, minutes }); state.setUnlockReview(undefined); }} />
    <Body muted>理由は確認後、端末内に保存します。時間帯の終了やルールの切替で、解除時間が短くなる場合があります。</Body>
    {!valid && <Body muted>対象のアプリ・空白以外の理由・1〜30分の時間を指定してください。</Body>}
    <Button label="解除内容を確認する" testID="unlock-review" disabled={!valid || !!state.busy} onPress={() => { void preview(); }} />
    <Button label="進行中の解除を確認する" secondary onPress={() => router.push('/grant')} />
  </FlowScreen>;
}

export function UnlockConfirmationScreen() {
  const state = useScreenTime(), draft = state.unlockDraft, review = state.unlockReview;
  const [failed, setFailed] = useState(false);
  const [openedAt] = useState(Date.now);
  const confirmed = review?.snapshot ?? state.snapshot;
  const target = confirmed?.targets.find((t) => t.ref === draft.targetRef);
  const rule = confirmed?.rules.find((r) => r.id === target?.ruleID);
  const submit = async () => {
    if (!review?.ref) return;
    state.setUnlockExitAllowed(true);
    const result = await state.run('unlock', { ref: review.ref, reason: draft.reason });
    const accepted = !!result.ref && result.snapshot?.targets.some((t) => t.grantCommandID === result.ref);
    if (result.status === 'ok' || accepted) {
      state.resetUnlock(); state.setUnlockExitAllowed(true);
      router.dismissTo('/grant');
    } else setFailed(true);
  };
  return <FlowScreen title="この内容で一時解除しますか" onBack={back}>
    {target && <Panel><Heading>このアプリだけを解除</Heading><Applications selectionRef={target.selectionRef} targetRef={target.ref} refreshKey={state.refreshKey} />
      <Body>ほかの対象アプリの設定は変更しません。</Body></Panel>}
    {rule ? <Panel><Heading>この解除に適用するルール</Heading><Body>時間帯 {(confirmed?.rules.findIndex((r) => r.id === rule.id) ?? 0) + 1}</Body><Body>{ruleText(rule)}</Body></Panel>
      : <Notice title="適用するルールを確認し直してください">入力へ戻って、最新の解除内容を確認できます。</Notice>}
    <Panel><Heading>あなたの理由</Heading><Body>{draft.reason}</Body></Panel>
    <Panel><Heading>解除の時間</Heading><Body>最大 {review?.minutes ?? draft.minutes}分</Body>
      {review?.previewEndsAt && <Body>{endTime(review.previewEndsAt, openedAt)}までが上限です。確定が遅れると、解除できる時間は短くなります。</Body>}
      {review?.shortened && <Notice title="時間が短くなります">時間帯の終了または優先ルールの切替に合わせて、解除の上限が早まっています。</Notice>}
    </Panel>
    <Body muted>再制限の予定を登録できた場合だけ解除を進めます。反映の結果は次の画面で確認できます。</Body>
    {!failed && <Button label="理由を保存して一時解除する" testID="unlock-submit" disabled={!review?.ref || !rule || !!state.busy} onPress={() => { void submit(); }} />}
    {failed && <Notice title="解除の完了を確認できません">入力は残っています。条件を確認し直せます。</Notice>}
    {failed && (state.error === 'busy' || state.error === 'storage-failed') && <Button label="同じ上限のまま受理を再試行する" disabled={!!state.busy} onPress={() => { void submit(); }} />}
    <Button label="入力に戻る" secondary disabled={!!state.busy} onPress={back} />
    <Button label="現在の解除状況を確認する" secondary onPress={() => { state.setUnlockExitAllowed(true); router.dismissTo('/grant'); }} />
  </FlowScreen>;
}
