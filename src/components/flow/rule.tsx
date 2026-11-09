import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, Switch, Text, View } from 'react-native';
import { ruleInput, useScreenTime } from '@/state/screen-time';
import { Applications } from './applications';
import { back, home, useDraftGuard } from './navigation';
import { weekdayNames, ruleText, endTime } from './presentation';
import { Body, Button, Field, FlowScreen, Heading, Notice, Panel, flowStyles, useFlowTheme } from './ui';

export function RuleEditorScreen() {
  const state = useScreenTime(), theme = useFlowTheme(), draft = state.ruleDraft;
  // react-native-web 0.21 uses a separate on-state thumb prop. Native iOS uses thumbColor.
  const webSwitchColors = Platform.OS === 'web' ? { activeThumbColor: theme.onAccent } : {};
  const { setRuleExitAllowed, beginRule } = state;
  useFocusEffect(useCallback(() => { setRuleExitAllowed(false); if (!draft) beginRule(); }, [draft, beginRule, setRuleExitAllowed]));
  useDraftGuard(!!draft?.dirty && !state.ruleExitAllowed, state.canExitRule, () => state.setRuleExitAllowed(true), () => { void state.run('cancelCandidate'); state.setRuleDraft(undefined); });
  if (!draft) return <FlowScreen title="ルールを確認しています"><Body>保存した設定を確認しています。</Body></FlowScreen>;
  const update = (patch: Partial<typeof draft>) => { state.setRuleExitAllowed(false); state.setRuleDraft({ ...draft, ...patch, dirty: true }); state.setRuleReview(undefined); };
  const input = ruleInput(draft, state.snapshot?.revision ?? '0');
  const pick = async () => { const result = await state.run('pickApplications'); if (result.ref) update({ selectionRef: result.ref }); };
  const preview = async () => {
    if (!input) return;
    const result = await state.run('previewRule', { rule: input });
    if (result.status === 'confirmation-required') { state.setRuleReview(result); router.push('/rule-confirm'); }
  };
  const count = state.snapshot?.selections.find((s) => s.ref === draft.selectionRef)?.count ?? 0;
  return <FlowScreen title={draft.id ? '時間のルールを編集' : '時間のルールをつくる'} onBack={back}>
    <View style={flowStyles.section}><Heading>1. アプリ</Heading>
      <Body muted>選ぶだけでは制限は始まりません。最後に内容を確認して保存します。</Body>
      {count > 0 && <Panel><Applications selectionRef={draft.selectionRef} count={count} refreshKey={state.refreshKey} /><Body muted>{count}件を選択</Body></Panel>}
      <Button label={draft.selectionRef ? '対象アプリを選び直す' : '対象アプリを選ぶ'} secondary disabled={!!state.busy || state.snapshot?.authorization !== 'approved'} onPress={() => { void pick(); }} />
      {state.snapshot?.authorization !== 'approved' && <Button label="許可を確認する" secondary onPress={() => router.push('/onboarding')} />}
    </View>
    <View style={flowStyles.row}><Body>このルールを有効にする</Body><Switch {...webSwitchColors} accessibilityLabel="このルールを有効にする" value={draft.enabled} onValueChange={(enabled) => update({ enabled })} trackColor={{ false: theme.muted, true: theme.accent }} thumbColor={theme.onAccent} hitSlop={8} /></View>
    <View style={flowStyles.section}><Heading>2. 曜日</Heading><View style={flowStyles.row}>
      {weekdayNames.map((day, index) => { const value = index + 1, selected = draft.weekdays.includes(value); return <Pressable key={day}
        accessibilityRole="checkbox" accessibilityLabel={`${day}曜日`} accessibilityState={{ checked: selected }}
        onPress={() => update({ weekdays: selected ? draft.weekdays.filter((v) => v !== value) : [...draft.weekdays, value].sort() })}
        style={{ minWidth: 48, minHeight: 48, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.muted, backgroundColor: selected ? theme.soft : theme.surface, justifyContent: 'center' }}>
        <Text style={{ color: theme.text, fontSize: 16 }}>{selected ? '✓ ' : ''}{day}</Text>
      </Pressable>; })}
    </View></View>
    <View style={flowStyles.section}><Heading>3. 時間帯</Heading>
      <Field label="開始時刻（24時間 HH:MM）" value={draft.start} onChangeText={(start) => update({ start })} keyboardType="numbers-and-punctuation" autoCapitalize="none" />
      <Field label="終了時刻（24時間 HH:MM）" value={draft.end} onChangeText={(end) => update({ end })} keyboardType="numbers-and-punctuation" autoCapitalize="none" />
      <View style={flowStyles.row}><Body>翌日に終了する</Body><Switch {...webSwitchColors} accessibilityLabel="翌日に終了する" value={draft.nextDay} onValueChange={(nextDay) => update({ nextDay })} trackColor={{ false: theme.muted, true: theme.accent }} thumbColor={theme.onAccent} hitSlop={8} /></View>
      <Body muted>この端末の現地時刻に従います。日付をまたぐ場合は「翌日に終了」を選んでください。</Body>
    </View>
    {!input && <Body muted>アプリ・曜日・正しい時刻を選ぶと、確認へ進めます。</Body>}
    <Button label="内容を確認する" disabled={!input || !!state.busy} onPress={() => { void preview(); }} />
  </FlowScreen>;
}

export function RuleConfirmationScreen() {
  const state = useScreenTime(), draft = state.ruleDraft, review = state.ruleReview;
  const [failed, setFailed] = useState(false);
  const [openedAt] = useState(Date.now);
  const input = draft && ruleInput(draft, review?.snapshot?.revision ?? state.snapshot?.revision ?? '0');
  const submit = async () => {
    if (!review?.ref) return;
    state.setRuleExitAllowed(true);
    const result = await state.run(review.retryable ? 'retryRule' : 'commitRule', { ref: review.ref });
    if (result.status === 'ok') { state.setRuleDraft(undefined); state.setRuleReview(undefined); home(); }
    else { setFailed(true); }
  };
  const recheck = async () => {
    const result = failed && review?.ref ? await state.run('reviewCandidate', { ref: review.ref }) : undefined;
    if (result?.status === 'confirmation-required') { state.setRuleReview(result); setFailed(false); }
    else if (draft) { state.setRuleReview(undefined); back(); }
  };
  const goBack = () => { if (draft?.remove) { void state.run('cancelCandidate'); state.setRuleDraft(undefined); state.setRuleReview(undefined); } back(); };
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
    <Button label="保存したルールを確認する" secondary onPress={() => { state.setRuleExitAllowed(true); router.dismissTo('/settings'); }} />
  </FlowScreen>;
}
