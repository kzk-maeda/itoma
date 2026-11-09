import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { useScreenTime, type RuleDraft } from '@/state/screen-time';
import type { ScreenTimeRule } from '../../../modules/itoma-native';
import { Applications } from './applications';
import { home } from './navigation';
import { clockText, ruleText } from './presentation';
import { Body, Button, FlowScreen, Heading, Notice, Panel } from './ui';

export function SettingsScreen() {
  const state = useScreenTime(), s = state.snapshot;
  const [deleted, setDeleted] = useState(false);
  const device = s?.availability === 'device';
  const withDraftChoice = (proceed: () => void) => {
    if (!state.ruleDraft?.dirty) { proceed(); return; }
    Alert.alert('編集中の入力があります', '入力を続けるか、破棄して別の操作へ進むかを選べます。', [
      { text: '入力を続ける', style: 'cancel', onPress: () => router.navigate('/rule') },
      { text: '破棄して進む', style: 'destructive', onPress: () => { void state.run('cancelCandidate').then((r) => { if (r.status === 'ok') { state.setRuleDraft(undefined); proceed(); } }); } },
    ]);
  };
  const edit = (rule?: ScreenTimeRule) => withDraftChoice(() => { state.beginRule(rule); router.navigate(s?.authorization === 'approved' ? '/rule' : '/onboarding'); });
  const prepareRemoval = async (rule: ScreenTimeRule) => {
    state.beginRule(rule);
    const draft: RuleDraft = { ...rule, start: clockText(rule.startMinute), end: clockText(rule.endMinute), dirty: true, remove: true };
    state.setRuleDraft(draft);
    const response = await state.run('previewRule', { rule: { ...rule, expectedRevision: s!.revision, remove: true } });
    if (response.status === 'confirmation-required') { state.setRuleReview(response); router.push('/rule-confirm'); }
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
  return <FlowScreen title="ルールと設定" onBack={home}>
    <Panel><Heading>現在の状態</Heading>
      <Body>{!device ? 'この環境では制限機能を利用できません' : !s.rules.length ? '保存したルールはありません' : s.activation === 'paused' ? 'ルールの停止を保存しています' : s.activation === 'awaitingReauthorizationConfirmation' ? '再開前の確認待ちです' : 'ルールの設定を保存しています'}</Body>
      <Body muted>スクリーンタイム：{s?.authorization === 'approved' ? '許可されています' : '許可の確認が必要です'}</Body>
      <Button label="現在の反映を確認する" secondary disabled={!device || !!state.busy} onPress={() => { void state.run('reconcile'); }} />
    </Panel>
    {s?.needsSelectionReview && <Notice title="対象を選び直してください">各ルールの編集画面で、対象アプリを選び直して保存できます。確認後、ご自身で再開できます。</Notice>}
    {s?.rules.map((rule, index) => <Panel key={rule.id}><Heading>時間帯 {index + 1}</Heading><Body>{ruleText(rule)}</Body><Body muted>{rule.enabled ? '有効なルール' : '無効なルール'}</Body>
      {s.authorization === 'approved' && <Applications selectionRef={rule.selectionRef} count={s.selections.find((selection) => selection.ref === rule.selectionRef)?.count ?? 1} refreshKey={state.refreshKey} />}
      <Button label={`時間帯 ${index + 1}を編集`} secondary disabled={!!state.busy} onPress={() => edit(rule)} />
      <Button label={`時間帯 ${index + 1}を削除する内容を確認`} secondary disabled={!!state.busy} onPress={() => withDraftChoice(() => { void prepareRemoval(rule); })} />
    </Panel>)}
    {!s?.rules.length && <Body muted>保存したルールはありません。</Body>}
    <Button label="ルールを追加する" disabled={!device || !!state.busy} onPress={() => edit()} />
    {s?.authorization !== 'approved' && device && <Button label="スクリーンタイムの許可を確認" secondary onPress={() => router.push('/onboarding')} />}
    {!!s?.rules.length && (s.activation === 'enabled' ? <Button label="すべてのルールの停止を確認" secondary disabled={!device || !!state.busy} onPress={stop} />
      : <Button label="保存したルールの再開を確認" disabled={!device || !!state.busy || !!s.needsSelectionReview || s.authorization !== 'approved'} onPress={resume} />)}
    <Panel><Heading>理由の保存と削除</Heading><Body>確定した理由はこの端末内に保存します。削除しても制限の設定は変わりません。</Body>
      {deleted && <Body>保存した理由を削除しました。</Body>}
      <Button label="保存した理由の削除を確認" secondary disabled={!device || !!state.busy} onPress={deleteReasons} />
    </Panel>
    {s?.historyIncomplete && <Notice title="操作記録の一部を保存できませんでした">現在の制限の状態は、上の確認操作で取得できます。</Notice>}
    {state.error === 'storage-failed' && <Body muted>停止を確認できない場合は、iOSの設定でITOMAへのスクリーンタイムの許可を取り消せます。</Body>}
    <Button label="ホームへ戻る" secondary onPress={home} />
  </FlowScreen>;
}
