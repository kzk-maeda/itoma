import { useEffect, useRef, useState } from 'react';
import { useScreenTime } from '@/state/screen-time';
import { back, home, useDraftGuard } from './navigation';
import { invalidRuleIdentity, RuleIdentityFields } from './rule-identity';
import { Body, Button, FlowScreen, Heading, Notice, Panel } from './ui';

type Draft = { ruleID: string; title: string; goal: string; originalTitle: string; originalGoal: string; revision: string; policyRevision: string };
export function RuleDetailsScreen({ ruleID }: { ruleID?: string }) {
  const state = useScreenTime(), s = state.snapshot, rule = s?.rules.find(r => r.id === ruleID);
  const pendingCreation = ruleID !== undefined && state.ruleDraft?.createdRuleID === ruleID ? state.ruleDraft : undefined;
  const [draft, setDraft] = useState<Draft>();
  const [reviewRequired, setReviewRequired] = useState(!!pendingCreation), [reviewedLatest, setReviewedLatest] = useState(false);
  // Saved text follows current private availability; editable RAM input stays separate.
  const latest = reviewedLatest && s?.ruleDetailsStatus === 'ready' ? rule : undefined;
  const allowed = useRef(false), [exitAllowed, setExitAllowed] = useState(false);
  const mounted = useRef(true), pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (draft?.ruleID === ruleID || !rule || s?.ruleDetailsStatus !== 'ready' || s.ruleDetailsRevision === undefined) return;
    let active = true;
    queueMicrotask(() => { if (active) setDraft({ ruleID: rule.id, title: pendingCreation?.title ?? rule.title ?? '', goal: pendingCreation?.goal ?? rule.goal ?? '', originalTitle: rule.title ?? '', originalGoal: rule.goal ?? '',
      revision: s.ruleDetailsRevision!, policyRevision: s.revision }); });
    return () => { active = false; };
  }, [ruleID, rule, s, draft?.ruleID, pendingCreation]);
  const dirty = !!pendingCreation || (!!draft && (draft.title !== draft.originalTitle || draft.goal !== draft.originalGoal));
  useDraftGuard(dirty && !exitAllowed, () => allowed.current, () => { allowed.current = true; setExitAllowed(true); }, () => { if (pendingCreation) state.setRuleDraft(undefined); },
    pendingCreation ? '名前と行動目標の未保存入力を破棄します。保存済みの時間のルールは残ります。' : undefined);
  const leave = pendingCreation ? home : back;
  const invalid = !!draft && invalidRuleIdentity(draft.title, draft.goal);
  const save = async () => {
    if (!draft || invalid || !rule || reviewRequired || pending.current) return;
    // Save is explicit acceptance; leaving now does not cancel the native write.
    pending.current = true; allowed.current = true; setExitAllowed(true);
    const result = await state.run('saveRuleDetails', { details: { ruleID: draft.ruleID, title: draft.title, goal: draft.goal,
      expectedRevision: draft.revision, expectedPolicyRevision: draft.policyRevision } });
    pending.current = false;
    if (!mounted.current) return;
    if (result.status === 'ok' && result.snapshot?.ruleDetailsStatus === 'ready') {
      allowed.current = true; setExitAllowed(true);
      if (pendingCreation) { state.setRuleDraft(undefined); home(); } else back();
    } else {
      allowed.current = false; setExitAllowed(false);
      if (result.code === 'changed' || result.status === 'ok') setReviewRequired(true);
    }
  };
  const reviewLatest = async () => {
    const result = await state.refresh(), snapshot = result.snapshot, current = snapshot?.rules.find(r => r.id === ruleID);
    if (!mounted.current) return;
    if (result.status !== 'ok' || !current || snapshot?.ruleDetailsStatus !== 'ready' || snapshot.ruleDetailsRevision === undefined) return;
    setReviewedLatest(true);
    setDraft(value => value && { ...value, revision: snapshot.ruleDetailsRevision!, policyRevision: snapshot.revision });
    setReviewRequired(false);
  };
  return <FlowScreen title="ルール名と行動目標" onBack={leave}>
    <Body>このルールで、どんな時間を過ごしたいですか？ ご自身が大切にしたいことを残せます。</Body>
    {pendingCreation && <Notice title="時間のルールは保存済みです">名前と行動目標の保存を確認できていません。入力は残っています。現在の保存内容を確認してから、名前と行動目標だけを保存できます。</Notice>}
    {!state.loading && !rule && <Notice title="このルールを確認できません">設定へ戻って、現在のルールを確認してください。</Notice>}
    {s?.ruleDetailsStatus === 'unavailable' && <Notice title="保存した内容を読み取れません">入力は残っています。もう一度、最新の状態を確認できます。</Notice>}
    {!draft && s?.ruleDetailsStatus === 'unavailable' && <Button label="最新の保存内容を確認する" secondary disabled={!!state.busy} onPress={() => { void state.refresh(); }} />}
    {draft && <>
      <RuleIdentityFields title={draft.title} goal={draft.goal} disabled={!!state.busy} onChange={patch => {
        setDraft({ ...draft, ...patch });
        if (pendingCreation) state.setRuleDraft({ ...pendingCreation, ...patch });
      }} />
      {reviewRequired && <Notice title="保存内容が更新されています">入力は残っています。最新の保存内容を確認してから、保存し直せます。</Notice>}
      {latest && <Panel><Heading>現在保存されている内容</Heading><Body>{latest.title || 'ルール名は未入力です'}</Body><Body>{latest.goal || '行動目標は未入力です'}</Body></Panel>}
      <Button label="最新の保存内容を確認する" secondary disabled={!!state.busy} onPress={() => { void reviewLatest(); }} />
      <Button label={latest ? '入力した内容で保存する' : '保存する'} disabled={!dirty || invalid || !!state.busy || !rule || reviewRequired || s?.ruleDetailsStatus !== 'ready'} onPress={() => { void save(); }} />
    </>}
    <Button label={pendingCreation ? '名前と行動目標を保存せずホームへ' : 'キャンセル'} secondary disabled={!!state.busy} onPress={leave} />
  </FlowScreen>;
}
