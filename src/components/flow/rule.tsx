import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Platform, Pressable, Switch, Text, View } from 'react-native';
import { ruleInput, useScreenTime, type RuleDraft } from '@/state/screen-time';
import { Applications } from './applications';
import { ScheduleFields } from './schedule-fields';
import { back, home, useDraftGuard } from './navigation';
import { weekdayNames, ruleText, endTime } from './presentation';
import { Body, Button, FlowScreen, Heading, Notice, Panel, flowStyles, useFlowTheme } from './ui';

// UI-only confirmation binding; ruleInput allowlists fields sent to native.
export type RulePreviewDraft = RuleDraft & { previewBaseRevision?: string };

function useDiscardRule() {
  const state = useScreenTime(), discarding = useRef(false);
  return async () => {
    if (discarding.current) return false;
    discarding.current = true;
    try {
      const ref = state.rulePreviewRef ?? state.ruleReview?.ref;
      if (ref) {
        const result = await state.run('cancelCandidate', { ref });
        if (result.status !== 'ok') return false;
      }
      state.setRuleDraft(undefined); state.setRuleReview(undefined); state.setRulePreviewRef(undefined);
      return true;
    } catch { return false; }
    finally { discarding.current = false; }
  };
}

export function RuleEditorScreen() {
  const state = useScreenTime(), theme = useFlowTheme(), draft = state.ruleDraft as RulePreviewDraft | undefined;
  const [unchanged, setUnchanged] = useState(false);
  // react-native-web 0.21 uses a separate on-state thumb prop. Native iOS uses thumbColor.
  const webSwitchColors = Platform.OS === 'web' ? { activeThumbColor: theme.onAccent } : {};
  const { setRuleExitAllowed, beginRule } = state;
  const discardRule = useDiscardRule();
  useFocusEffect(useCallback(() => { setRuleExitAllowed(false); if (!draft) beginRule(); }, [draft, beginRule, setRuleExitAllowed]));
  useDraftGuard(!!draft?.dirty && !state.ruleExitAllowed, state.canExitRule, () => state.setRuleExitAllowed(true), discardRule);
  if (!draft) return <FlowScreen title="ルールを確認しています"><Body>保存した設定を確認しています。</Body></FlowScreen>;
  const update = (patch: Partial<typeof draft>) => { setUnchanged(false); state.setRuleExitAllowed(false); state.setRuleDraft({ ...draft, ...patch, dirty: true }); state.setRuleReview(undefined); };
  const input = ruleInput(draft, state.snapshot?.revision ?? '0');
  const pick = async () => { const result = await state.run('pickApplications'); if (result.ref) update({ selectionRef: result.ref }); };
  const preview = async () => {
    if (!input) return;
    const submitted: RulePreviewDraft = { ...draft, previewBaseRevision: input.expectedRevision };
    state.setRuleDraft(submitted); state.setRuleReview(undefined);
    const ref = state.rulePreviewRef ?? state.ruleReview?.ref;
    const result = await state.run('previewRule', { rule: input, ...(ref ? { ref } : {}) });
    if (result.status === 'confirmation-required') { state.setRulePreviewRef(result.ref); state.setRuleReview(result); router.push('/rule-confirm'); }
    else if (result.status === 'ok' && !result.ref) {
      const saved = result.snapshot?.rules.find((rule) => rule.id === draft.id);
      state.setRuleDraft({ ...draft, selectionRef: saved?.selectionRef ?? draft.selectionRef, dirty: false });
      state.setRuleReview(undefined); state.setRulePreviewRef(undefined); setUnchanged(true);
    }
    else if (result.status === 'error' && result.ref) {
      state.setRulePreviewRef(result.ref); state.setRuleReview(undefined);
    }
  };
  const count = state.snapshot?.selections.find((s) => s.ref === draft.selectionRef)?.count ?? 0;
  return <FlowScreen title={draft.id ? '時間のルールを編集' : '時間のルールをつくる'} onBack={back}>
    <View style={flowStyles.section}><Heading>1. アプリ</Heading>
      <Body muted>選ぶだけでは制限は始まりません。最後に内容を確認して保存します。</Body>
      {count > 0 && <Panel><Applications selectionRef={draft.selectionRef} count={count} refreshKey={state.refreshKey} /><Body muted>{count}件を選択</Body></Panel>}
      <Button label={draft.selectionRef ? '対象アプリを選び直す' : '対象アプリを選ぶ'} secondary disabled={!!state.busy || state.snapshot?.authorization !== 'approved'} onPress={() => { void pick(); }} />
      {state.snapshot?.authorization !== 'approved' && <Button label="許可を確認する" secondary onPress={() => router.push('/onboarding')} />}
    </View>
    <View style={flowStyles.row}><Body>このルールを有効にする</Body><Switch {...webSwitchColors} accessibilityLabel="このルールを有効にする" accessibilityState={{ disabled: !!state.busy }} disabled={!!state.busy} value={draft.enabled} onValueChange={(enabled) => update({ enabled })} trackColor={{ false: theme.muted, true: theme.accent }} thumbColor={theme.onAccent} hitSlop={8} /></View>
    <View style={flowStyles.section}><Heading>2. 曜日</Heading><View style={flowStyles.row}>
      {weekdayNames.map((day, index) => { const value = index + 1, selected = draft.weekdays.includes(value); return <Pressable key={day}
        accessibilityRole="checkbox" accessibilityLabel={`${day}曜日`} disabled={!!state.busy} accessibilityState={{ checked: selected, disabled: !!state.busy }}
        onPress={() => update({ weekdays: selected ? draft.weekdays.filter((v) => v !== value) : [...draft.weekdays, value].sort() })}
        style={{ minWidth: 48, minHeight: 48, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.muted, backgroundColor: selected ? theme.soft : theme.surface, justifyContent: 'center' }}>
        <Text style={{ color: theme.text, fontSize: 16 }}>{selected ? '✓ ' : ''}{day}</Text>
      </Pressable>; })}
    </View></View>
    <View style={flowStyles.section}><Heading>3. 時間帯</Heading>
      <ScheduleFields start={draft.start} end={draft.end} disabled={!!state.busy} onChange={update} />
    </View>
    {!input && <Body muted>アプリ・曜日・正しい時刻を選ぶと、確認へ進めます。</Body>}
    {unchanged && <Notice title="変更はありません">保存済みのルールと同じ内容です。一時解除の期限は変更していません。</Notice>}
    <Button label="内容を確認する" disabled={!input || !!state.busy} onPress={() => { void preview(); }} />
    {unchanged && <Button label="保存したルールに戻る" secondary onPress={() => {
      state.setRuleExitAllowed(true); state.setRuleDraft(undefined); router.dismissTo('/settings-schedules');
    }} />}
  </FlowScreen>;
}

export function RuleConfirmationScreen() {
  const state = useScreenTime(), draft = state.ruleDraft as RulePreviewDraft | undefined, review = state.ruleReview;
  const [failed, setFailed] = useState(false);
  const [openedAt] = useState(Date.now);
  const discardRule = useDiscardRule();
  const input = draft && ruleInput(draft, review?.snapshot?.revision ?? state.snapshot?.revision ?? '0');
  const submit = async () => {
    if (!review?.ref) return;
    state.setRuleExitAllowed(true);
    const result = await state.run(review.retryable ? 'retryRule' : 'commitRule', { ref: review.ref });
    if (result.status === 'ok') { state.setRuleDraft(undefined); state.setRuleReview(undefined); state.setRulePreviewRef(undefined); home(); }
    else {
      // Settings may have committed even when OS application failed. That old candidate's
      // base revision cannot be confirmed again; keep the draft and recheck the saved policy.
      const baseRevision = draft?.previewBaseRevision ?? review.snapshot?.revision;
      if (result.snapshot && baseRevision !== undefined && result.snapshot.revision !== baseRevision) {
        state.setRuleReview(undefined); state.setRulePreviewRef(undefined);
      }
      setFailed(true);
    }
  };
  const recheck = async () => {
    const result = failed && review?.ref ? await state.run('reviewCandidate', { ref: review.ref }) : undefined;
    if (result?.status === 'confirmation-required') { state.setRuleReview(result); setFailed(false); }
    else if (draft) { state.setRuleReview(undefined); back(); }
  };
  const goBack = () => { void (async () => {
    if (draft?.remove) {
      if (!await discardRule()) return;
      state.setRuleExitAllowed(true);
    }
    back();
  })(); };
  return <FlowScreen title={draft?.remove ? 'このルールを削除しますか' : 'このルールで保存しますか'} onBack={goBack}>
    {draft && input && <Panel><Heading>曜日と時間帯</Heading><Body>{ruleText({ ...input, id: input.id ?? '' })}</Body>
      <Applications selectionRef={draft.selectionRef} count={state.snapshot?.selections.find((s) => s.ref === draft.selectionRef)?.count ?? 1} refreshKey={state.refreshKey} />
      <Body>解除方法：自分の言葉で理由を入力</Body>
      <Body>{draft.enabled ? 'このルールを有効にして保存します' : 'このルールを無効にして保存します'}</Body>
    </Panel>}
    {!!review?.impacts.length && <Notice title="一時解除への変更があります">{review.impacts.map((impact) => impact.kind === 'shorten'
      ? `一時解除の終了が${endTime(impact.endsAt!, openedAt)}に早まります。` : '継続中の一時解除が終了、または状態の再確認が必要になります。').join('\n')}</Notice>}
    <Body muted>設定の保存と、制限の反映は別に確認します。保存後、ホームで現在の状態を確認できます。</Body>
    {draft?.remove && <Body>このルールだけを削除します。別のルールや保存した理由は残ります。</Body>}
    {!failed && <Button label={review?.retryable ? '変更を確認して登録を再試行' : draft?.remove ? 'このルールを削除する' : 'この内容で保存する'} disabled={!review?.ref || !!state.busy} onPress={() => { void submit(); }} />}
    {failed && <Button label="最新の変更内容を確認し直す" disabled={!!state.busy} onPress={() => { void recheck(); }} />}
    <Button label={draft?.remove ? '削除せず戻る' : '編集へ戻る'} secondary disabled={!!state.busy} onPress={goBack} />
    <Button label="保存したルールを確認する" secondary onPress={() => { state.setRuleExitAllowed(true); router.dismissTo('/settings-schedules'); }} />
  </FlowScreen>;
}
