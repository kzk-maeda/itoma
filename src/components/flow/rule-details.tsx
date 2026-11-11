import { useEffect, useRef, useState } from 'react';
import { useScreenTime } from '@/state/screen-time';
import { back, useDraftGuard } from './navigation';
import { Body, Button, Field, FlowScreen, Heading, Notice, Panel } from './ui';

type Draft = { ruleID: string; title: string; goal: string; originalTitle: string; originalGoal: string; revision: string; policyRevision: string };
export function RuleDetailsScreen({ ruleID }: { ruleID?: string }) {
  const state = useScreenTime(), s = state.snapshot, rule = s?.rules.find(r => r.id === ruleID);
  const [draft, setDraft] = useState<Draft>();
  const [reviewRequired, setReviewRequired] = useState(false), [latest, setLatest] = useState<{ title: string; goal: string }>();
  const allowed = useRef(false), [exitAllowed, setExitAllowed] = useState(false);
  const mounted = useRef(true), pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (draft?.ruleID === ruleID || !rule || s?.ruleDetailsStatus !== 'ready' || s.ruleDetailsRevision === undefined) return;
    let active = true;
    queueMicrotask(() => { if (active) setDraft({ ruleID: rule.id, title: rule.title ?? '', goal: rule.goal ?? '', originalTitle: rule.title ?? '', originalGoal: rule.goal ?? '',
      revision: s.ruleDetailsRevision!, policyRevision: s.revision }); });
    return () => { active = false; };
  }, [ruleID, rule, s, draft?.ruleID]);
  const dirty = !!draft && (draft.title !== draft.originalTitle || draft.goal !== draft.originalGoal);
  useDraftGuard(dirty && !exitAllowed, () => allowed.current, () => { allowed.current = true; setExitAllowed(true); }, () => {});
  const invalid = !!draft && (draft.title.length > 80 || draft.goal.length > 1000 || (draft.title + draft.goal).includes('\0'));
  const save = async () => {
    if (!draft || invalid || !rule || reviewRequired || pending.current) return;
    // Save is explicit acceptance; leaving now does not cancel the native write.
    pending.current = true; allowed.current = true; setExitAllowed(true);
    const result = await state.run('saveRuleDetails', { details: { ruleID: draft.ruleID, title: draft.title, goal: draft.goal,
      expectedRevision: draft.revision, expectedPolicyRevision: draft.policyRevision } });
    pending.current = false;
    if (!mounted.current) return;
    if (result.status === 'ok' && result.snapshot?.ruleDetailsStatus === 'ready') {
      allowed.current = true; setExitAllowed(true); back();
    } else {
      allowed.current = false; setExitAllowed(false);
      if (result.code === 'changed' || result.status === 'ok') setReviewRequired(true);
    }
  };
  const reviewLatest = async () => {
    const result = await state.refresh(), snapshot = result.snapshot, current = snapshot?.rules.find(r => r.id === ruleID);
    if (!mounted.current) return;
    if (result.status !== 'ok' || !current || snapshot?.ruleDetailsStatus !== 'ready' || snapshot.ruleDetailsRevision === undefined) return;
    setLatest({ title: current.title ?? '', goal: current.goal ?? '' });
    setDraft(value => value && { ...value, revision: snapshot.ruleDetailsRevision!, policyRevision: snapshot.revision });
    setReviewRequired(false);
  };
  return <FlowScreen title="ルール名と行動目標" onBack={back}>
    <Body>このルールで、どんな時間を過ごしたいですか？ ご自身が大切にしたいことを残せます。</Body>
    {!state.loading && !rule && <Notice title="このルールを確認できません">設定へ戻って、現在のルールを確認してください。</Notice>}
    {s?.ruleDetailsStatus === 'unavailable' && <Notice title="保存した内容を読み取れません">入力は残っています。もう一度、最新の状態を確認できます。</Notice>}
    {draft && <>
      <Field label="ルール名（任意）" value={draft.title} editable={!state.busy} onChangeText={title => setDraft({ ...draft, title })} />
      <Body muted>未入力なら「時間帯」の名前を表示します。80文字以内で入力してください。</Body>
      <Field label="行動目標（任意）" value={draft.goal} editable={!state.busy} multiline onChangeText={goal => setDraft({ ...draft, goal })} />
      <Body muted>このルールを設定した理由や、この時間にしたいこと。1,000文字以内で入力してください。登録した内容はホームに表示します。</Body>
      {invalid && <Notice title="入力内容を確認してください">文字数の上限を超えているか、使用できない文字が含まれています。入力を短くしてから保存できます。</Notice>}
      {reviewRequired && <Notice title="保存内容が更新されています">入力は残っています。最新の保存内容を確認してから、保存し直せます。</Notice>}
      {latest && <Panel><Heading>現在保存されている内容</Heading><Body>{latest.title || 'ルール名は未入力です'}</Body><Body>{latest.goal || '行動目標は未入力です'}</Body></Panel>}
      <Button label="最新の保存内容を確認する" secondary disabled={!!state.busy} onPress={() => { void reviewLatest(); }} />
      <Button label={latest ? '入力した内容で保存する' : '保存する'} disabled={!dirty || invalid || !!state.busy || !rule || reviewRequired || s?.ruleDetailsStatus !== 'ready'} onPress={() => { void save(); }} />
    </>}
    <Button label="キャンセル" secondary disabled={!!state.busy} onPress={back} />
  </FlowScreen>;
}
