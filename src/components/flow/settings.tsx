import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { Alert } from 'react-native';
import { ruleInput, useScreenTime } from '@/state/screen-time';
import type { RulePreviewDraft } from './rule';
import { useOptionalOnboarding } from '@/state/onboarding';
import type { ScreenTimeRule } from '../../../modules/itoma-native';
import { Applications } from './applications';
import { clockText, ruleText } from './presentation';
import { RuleGoal, ruleTitle } from './rule-identity';
import { back } from './navigation';
import { Body, Button, FlowScreen, Heading, LinkRow, Notice, Panel } from './ui';

function useSettings() {
  const state = useScreenTime(), setup = useOptionalOnboarding(), s = state.snapshot;
  const { refresh } = state;
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
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
    if (response.status === 'confirmation-required') { state.setRulePreviewRef(response.ref); state.setRuleReview(response); router.navigate('/rule-confirm'); }
    else if (response.status === 'error' && response.ref) { state.setRulePreviewRef(response.ref); state.setRuleReview(undefined); }
  };
  const stop = () => Alert.alert('すべてのルールを停止しますか', '時間帯の制限を停止し、進行中の一時解除も終了します。保存したルールは残り、ご自身で再開できます。', [
    { text: '戻る', style: 'cancel' }, { text: 'すべて停止する', onPress: () => { void state.run('stop'); } },
  ]);
  const resume = () => Alert.alert('保存したルールを再開しますか', '現在の曜日・時間帯の設定を確認して反映します。終了した一時解除は復活しません。', [
    { text: '戻る', style: 'cancel' }, { text: '確認して再開する', onPress: () => { void state.run('resume'); } },
  ]);
  return { state, setup, s, device, firstRun, edit, prepareRemoval, withDraftChoice, stop, resume };
}

export function SettingsScreen() {
  const { s, device, state } = useSettings();
  const known = device && !['storage-failed', 'unavailable'].includes(state.error ?? '');
  return <FlowScreen title="設定" tab="settings">
    <Body muted>自分で決めた時間と、記録の扱いを確認できます。</Body>
    <Panel>
      <LinkRow label="スケジュール" detail={!s && state.loading ? '保存状態を確認しています' : known && s ? `${s.rules.length}件 · ${s.activation === 'paused' ? '全体を停止中' : s.activation === 'awaitingReauthorizationConfirmation' ? '再開前の確認待ち' : '保存した時間の設定'}` : 'この環境では保存状態を確認できません'} onPress={() => router.navigate('/settings-schedules')} />
      <LinkRow label="スクリーンタイム" detail={!device ? '許可と反映はiPhoneで確認できます' : s?.authorization === 'approved' ? s.needsSelectionReview ? '対象の再選択が必要です' : '許可と反映の状態' : '許可の確認が必要です'} onPress={() => router.navigate('/settings-screen-time')} />
      <LinkRow label="記録とプライバシー" detail="選択の記録・保存容量・削除" onPress={() => router.navigate('/settings-records')} />
      <LinkRow label="使い方とこのアプリ" detail="制限と一時解除・端末内の保存" onPress={() => router.navigate('/settings-about')} />
    </Panel>
    {s?.needsSelectionReview && <Notice title="再開前の確認が必要です">スクリーンタイムから、許可・対象の選び直し・再開を順に確認できます。</Notice>}
  </FlowScreen>;
}

export function ScheduleListScreen() {
  const { state, setup, s, device, firstRun, edit, stop, resume } = useSettings();
  const known = device && !['storage-failed', 'unavailable'].includes(state.error ?? '');
  return <FlowScreen title="スケジュール" onBack={back}>
    <Body muted>各行は保存した曜日・時間・対象の設定です。現在の反映状態は「スクリーンタイム」で確認できます。</Body>
    {s?.rules.map((rule, index) => <LinkRow key={rule.id} label={ruleTitle(rule, index)} detail={`${ruleText(rule)} · ${rule.enabled ? '有効' : '無効'}`}
      onPress={() => router.navigate({ pathname: '/settings-schedule', params: { ruleID: rule.id } })} />)}
    {!s?.rules.length && <Body>{!s && state.loading ? '保存状態を確認しています。' : known ? '保存したルールはありません。' : 'この環境では保存状態を確認できません。iPhoneアプリで確認できます。'}</Body>}
    <Button label={firstRun ? setup?.draft ? '初回設定を続ける' : '初回設定を始める' : 'ルールを追加する'} disabled={!device || !!state.busy || !!setup?.loading || !!setup?.busy} onPress={() => edit()} />
    {!!s?.rules.length && <Panel><Heading>全体の操作</Heading>
      <Body>{s.activation === 'paused' ? '全体の停止を保存しています。' : s.activation === 'awaitingReauthorizationConfirmation' ? '再開前の確認待ちです。' : '全体の停止はすべてのルールに作用します。'}各ルールの設定は残ります。</Body>
      {s.activation === 'enabled' ? <Button label="すべてのルールの停止を確認" secondary disabled={!device || !!state.busy} onPress={stop} />
        : <Button label="保存したルールの再開を確認" disabled={!device || !!state.busy || !!s.needsSelectionReview || s.authorization !== 'approved'} onPress={resume} />}
      {(s.needsSelectionReview || s.authorization !== 'approved') && <LinkRow label="再開に必要な確認をする" onPress={() => router.navigate('/settings-screen-time')} />}
    </Panel>}
  </FlowScreen>;
}

export function ScheduleDetailScreen() {
  const { ruleID } = useLocalSearchParams<{ ruleID: string }>();
  const { state, s, device, edit, prepareRemoval, withDraftChoice } = useSettings();
  const index = s?.rules.findIndex(rule => rule.id === ruleID) ?? -1, rule = s?.rules[index];
  return <FlowScreen title={rule ? ruleTitle(rule, index) : 'スケジュールの詳細'} onBack={back}>
    {rule && s ? <>
      <RuleGoal goal={rule.goal} /><Body>{ruleText(rule)}</Body><Body muted>{rule.enabled ? '有効なルール' : '無効なルール'}</Body>
      {s.authorization === 'approved' && <Applications selectionRef={rule.selectionRef} count={s.selections.find(selection => selection.ref === rule.selectionRef)?.count ?? 1} refreshKey={state.refreshKey} />}
      <Panel><Heading>この時間の設定</Heading>
        <Body muted>名前と行動目標の保存は、曜日・時間・対象の変更とは別です。</Body>
        <Button label={`${ruleTitle(rule, index)}の名前と行動目標を編集`} secondary disabled={!!state.busy || s.ruleDetailsStatus !== 'ready'} onPress={() => router.navigate({ pathname: '/rule-details', params: { ruleID: rule.id } })} />
        <Button label={`${ruleTitle(rule, index)}を編集`} secondary disabled={!!state.busy} onPress={() => edit(rule)} />
      </Panel>
      {s.ruleDetailsStatus !== 'ready' && <Body muted>{s.ruleDetailsStatus === 'unavailable' ? '名前と行動目標を読み取れませんでした。最新の状態を確認し直せます。' : '名前と行動目標の編集にはアプリの更新が必要です。'}</Body>}
      {s.ruleDetailsStatus === 'unavailable' && <Button label="保存した名前と行動目標を読み直す" secondary disabled={!device || !!state.busy} onPress={() => { void state.refresh(); }} />}
      <Panel><Heading>このルールの削除</Heading><Body>削除する内容と一時解除への影響は、次の画面で確認できます。他のルールと記録は残ります。</Body>
        <Button label={`${ruleTitle(rule, index)}を削除する内容を確認`} secondary disabled={!!state.busy} onPress={() => withDraftChoice(() => { void prepareRemoval(rule); })} />
      </Panel>
    </> : <Notice title="このルールを確認できません">一覧へ戻り、最新の設定を確認してください。</Notice>}
  </FlowScreen>;
}

export function ScreenTimeSettingsScreen() {
  const { state, s, device } = useSettings();
  return <FlowScreen title="スクリーンタイム" onBack={back}>
    <Panel><Heading>許可と反映</Heading>
      <Body>{!device ? 'この環境では制限機能を利用できません' : s?.authorization === 'approved' ? 'スクリーンタイムは許可されています' : 'スクリーンタイムの許可を確認してください'}</Body>
      <Body>{s?.activation === 'paused' ? '全体の停止を保存しています' : s?.activation === 'awaitingReauthorizationConfirmation' ? '再開前の確認待ちです' : '保存した設定と、OSへの反映は別の状態です。'}</Body>
      <Body>{device && s?.observation === 'applied' && s.evaluatedAt !== undefined ? '取得時点でITOMAの設定を反映した記録があります。' : '制限の反映を確認できていません。'}</Body>
      {s?.evaluatedAt !== undefined && <Body muted>反映の記録時刻：{new Date(s.evaluatedAt * 1000).toLocaleString('ja-JP')}。</Body>}
      <Body muted>この記録は取得時点のものです。端末全体の制限や、その後も制限が続いていることを保証するものではありません。</Body>
      <Body muted>確認操作は、保存した設定の読み直しに加えて、自動切替の予定準備・反映の再試行・記録の取込を行います。</Body>
      <Button label="保存した設定を再確認・反映する" secondary disabled={!device || !!state.busy} onPress={() => { void state.run('reconcile'); }} />
    </Panel>
    <Body muted>ここで確認できるのはITOMAが指定した制限の設定です。ほかの制限が重なると、一時解除後も対象アプリを使えない場合があります。</Body>
    <Panel><Heading>許可が変わったとき</Heading><Body>1. 許可を確認します。2. 各ルールで対象アプリを選び直して保存します。3. 内容を確認して、ご自身で再開します。許可だけで再開はしません。</Body>
      {s?.authorization !== 'approved' && <Button label="スクリーンタイムの許可を確認" secondary disabled={!device || !!state.busy} onPress={() => router.navigate('/onboarding')} />}
      <LinkRow label="スケジュールを確認する" onPress={() => router.navigate('/settings-schedules')} />
    </Panel>
    {state.error === 'storage-failed' && <Body muted>停止を確認できない場合は、iOSの設定でITOMAへのスクリーンタイムの許可を取り消せます。</Body>}
  </FlowScreen>;
}

export function AboutSettingsScreen() {
  return <FlowScreen title="使い方とこのアプリ" onBack={back}>
    <Panel><Heading>自分の時間へ戻るために</Heading><Body>曜日・時間帯・対象アプリを自分で決めて制限します。必要なときは、使う理由を自分の言葉で確かめて一時解除できます。</Body></Panel>
    <Panel><Heading>記録とプライバシー</Heading><Body>理由と操作の記録は、この端末内に保存します。設定から確認・削除できます。記録は実際のアプリ利用時間や集中の成果を測るものではありません。</Body></Panel>
    <LinkRow label="スケジュールを確認する" onPress={() => router.navigate('/settings-schedules')} />
  </FlowScreen>;
}
