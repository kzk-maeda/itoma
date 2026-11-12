import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { ruleInput, useScreenTime } from '@/state/screen-time';
import type { RulePreviewDraft } from './rule';
import { useOptionalOnboarding } from '@/state/onboarding';
import type { ScreenTimeRule } from '../../../modules/itoma-native';
import { Applications } from './applications';
import { clockText, ruleText } from './presentation';
import { RuleGoal, ruleTitle } from './rule-identity';
import { ReflectionManagement } from './reflection-management';
import { Body, Button, FlowScreen, Heading, Notice, Panel } from './ui';

export function SettingsScreen() {
  const state = useScreenTime(), setup = useOptionalOnboarding(), s = state.snapshot;
  const { refresh } = state;
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const [deleted, setDeleted] = useState(false);
  const device = s?.availability === 'device';
  const withDraftChoice = (proceed: () => void) => {
    if (!state.ruleDraft?.dirty) { proceed(); return; }
    Alert.alert('編集中の入力があります', '入力を続けるか、破棄して別の操作へ進むかを選べます。', [
      { text: '入力を続ける', style: 'cancel', onPress: () => router.navigate('/rule') },
      { text: '破棄して進む', style: 'destructive', onPress: () => {
        void state.run('cancelCandidate', { ref: state.rulePreviewRef ?? state.ruleReview?.ref }).then((r) => {
          if (r.status === 'ok') { state.setRuleDraft(undefined); state.setRuleReview(undefined); state.setRulePreviewRef(undefined); proceed(); }
        });
      } },
    ]);
  };
  const firstRun = !!setup && !setup.progress?.completed && !s?.rules.length;
  const edit = (rule?: ScreenTimeRule) => withDraftChoice(() => { if (firstRun && !rule) { router.navigate('/onboarding'); return; } state.beginRule(rule); router.navigate(s?.authorization === 'approved' ? '/rule' : '/onboarding'); });
  const prepareRemoval = async (rule: ScreenTimeRule) => {
    state.beginRule(rule);
    const draft: RulePreviewDraft = { ...rule, start: clockText(rule.startMinute), end: clockText(rule.endMinute), dirty: true, remove: true, previewBaseRevision: s!.revision };
    state.setRuleDraft(draft);
    const response = await state.run('previewRule', { rule: ruleInput(draft, s!.revision) });
    if (response.status === 'confirmation-required') { state.setRulePreviewRef(response.ref); state.setRuleReview(response); router.push('/rule-confirm'); }
    else if (response.status === 'error' && response.ref) { state.setRulePreviewRef(response.ref); state.setRuleReview(undefined); }
  };
  const stop = () => Alert.alert('すべてのルールを停止しますか', '時間帯の制限を停止し、進行中の一時解除も終了します。保存したルールは残り、ご自身で再開できます。', [
    { text: '戻る', style: 'cancel' }, { text: 'すべて停止する', onPress: () => { void state.run('stop'); } },
  ]);
  const resume = () => Alert.alert('保存したルールを再開しますか', '現在の曜日・時間帯の設定を確認して反映します。終了した一時解除は復活しません。', [
    { text: '戻る', style: 'cancel' }, { text: '確認して再開する', onPress: () => { void state.run('resume'); } },
  ]);
  const deleteReasons = () => Alert.alert('保存した理由をすべて削除しますか', '理由本文を削除します。ルールや現在の一時解除は変わりません。この操作は元に戻せません。', [
    { text: '戻る', style: 'cancel' }, { text: '理由をすべて削除する', style: 'destructive', onPress: () => { void state.run('deleteReasons').then((r) => setDeleted(r.status === 'ok')); } },
  ]);
  return <FlowScreen title="ルールと設定" tab="settings">
    <Panel><Heading>現在の状態</Heading>
      <Body>{!device ? 'この環境では制限機能を利用できません' : !s.rules.length ? '保存したルールはありません' : s.activation === 'paused' ? 'ルールの停止を保存しています' : s.activation === 'awaitingReauthorizationConfirmation' ? '再開前の確認待ちです' : 'ルールの設定を保存しています'}</Body>
      <Body muted>スクリーンタイム：{s?.authorization === 'approved' ? '許可されています' : '許可の確認が必要です'}</Body>
      <Button label="現在の状態を確認する" secondary disabled={!device || !!state.busy} onPress={() => { void state.run('reconcile'); }} />
    </Panel>
    <Body muted>ここで確認できるのはITOMAが指定した制限の設定です。ほかの制限が重なると、一時解除後も対象アプリを使えない場合があります。</Body>
    {s?.needsSelectionReview && <Notice title="対象を選び直してください">各ルールの編集画面で、対象アプリを選び直して保存できます。確認後、ご自身で再開できます。</Notice>}
    {s?.rules.map((rule, index) => <Panel key={rule.id}><Heading>{ruleTitle(rule, index)}</Heading><RuleGoal goal={rule.goal} /><Body>{ruleText(rule)}</Body><Body muted>{rule.enabled ? '有効なルール' : '無効なルール'}</Body>
      {s.authorization === 'approved' && <Applications selectionRef={rule.selectionRef} count={s.selections.find((selection) => selection.ref === rule.selectionRef)?.count ?? 1} refreshKey={state.refreshKey} />}
      <Button label={`${ruleTitle(rule, index)}の名前と行動目標を編集`} secondary disabled={!!state.busy || s.ruleDetailsStatus !== 'ready'} onPress={() => router.push({ pathname: '/rule-details', params: { ruleID: rule.id } })} />
      <Button label={`${ruleTitle(rule, index)}を編集`} secondary disabled={!!state.busy} onPress={() => edit(rule)} />
      <Button label={`${ruleTitle(rule, index)}を削除する内容を確認`} secondary disabled={!!state.busy} onPress={() => withDraftChoice(() => { void prepareRemoval(rule); })} />
    </Panel>)}
    {!!s?.rules.length && s.ruleDetailsStatus !== 'ready' && <Body muted>{s.ruleDetailsStatus === 'unavailable' ? 'ルール名と行動目標を読み取れませんでした。現在の状態を確認すると読み直せます。' : '名前と行動目標を編集するには、アプリの更新が必要です。'}</Body>}
    {!s?.rules.length && <Body muted>保存したルールはありません。</Body>}
    <Button label={firstRun ? setup.draft ? '初回設定を続ける' : '初回設定を始める' : 'ルールを追加する'} disabled={!device || !!state.busy || !!setup?.loading || !!setup?.busy} onPress={() => edit()} />
    {s?.authorization !== 'approved' && device && !firstRun && <Button label="スクリーンタイムの許可を確認" secondary onPress={() => router.push('/onboarding')} />}
    {!!s?.rules.length && (s.activation === 'enabled' ? <Button label="すべてのルールの停止を確認" secondary disabled={!device || !!state.busy} onPress={stop} />
      : <Button label="保存したルールの再開を確認" disabled={!device || !!state.busy || !!s.needsSelectionReview || s.authorization !== 'approved'} onPress={resume} />)}
    <Panel><Heading>理由の保存と削除</Heading><Body>確定した理由はこの端末内に保存します。削除しても制限の設定は変わりません。</Body>
      {deleted && <Body>保存した理由を削除しました。</Body>}
      <Button label="保存した理由の削除を確認" secondary disabled={!device || !!state.busy} onPress={deleteReasons} />
    </Panel>
    <Panel><Heading>記録と振り返りの管理</Heading><Button label="選択の記録を見る" secondary onPress={() => router.navigate('/history')} /><ReflectionManagement /></Panel>
    {s?.historyIncomplete && <Notice title="操作記録の一部を保存できませんでした">現在の制限の状態は、上の確認操作で取得できます。</Notice>}
    {state.error === 'storage-failed' && <Body muted>停止を確認できない場合は、iOSの設定でITOMAへのスクリーンタイムの許可を取り消せます。</Body>}
  </FlowScreen>;
}
