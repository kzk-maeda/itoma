import { router, usePreventRemove } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useOnboarding } from '@/state/onboarding';
import { useScreenTime } from '@/state/screen-time';
import { useVisibleClock } from '@/hooks/use-visible-clock';
import { currentControlSnapshot } from '@/state/control-snapshot';
import type { OnboardingDraft, OnboardingStep, ScreenTimeSnapshot, ScreenTimeResponse } from '../../../modules/itoma-native';
import { OpenCircle } from '../home/open-circle';
import { Applications } from './applications';
import { home } from './navigation';
import { weekdayNames, endTime } from './presentation';
import { RuleGoal } from './rule-identity';
import { Body, Button, Field, FlowScreen, Heading, Notice, Panel, errorText, flowStyles, useFlowTheme } from './ui';

const steps: OnboardingStep[] = ['purpose', 'schedule', 'apps', 'review'];
const titles = { purpose: 'どんな時間にしたいですか', schedule: '自分の時間を、決める', apps: '離れたいアプリを、選ぶ', review: 'この内容で、はじめますか' };
/** Input guidance only. Native WeeklySchedule is the final authority. No demo defaults/minimum. */
export function validOnboardingSchedule(d: Pick<OnboardingDraft, 'start' | 'end' | 'weekdays' | 'nextDay'>): boolean {
  const minute = (s: string) => /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(s) ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) : NaN;
  const duration = minute(d.end) - minute(d.start) + (d.nextDay ? 1440 : 0);
  return d.weekdays.length > 0 && d.weekdays.every(v => Number.isInteger(v) && v >= 1 && v <= 7) && new Set(d.weekdays).size === d.weekdays.length && duration > 0 && duration <= 1440;
}
export function onboardingResult(s?: ScreenTimeSnapshot, now = Date.now()): { title: string; body: string } {
  if (!s) return { title: '現在の状態を確認してください', body: '保存と反映の結果を確認できていません。ホームで読み直せます。' };
  if (s.authorization !== 'approved' || s.activation !== 'enabled') return { title: '再開前の確認が必要です', body: '設定は保存されています。許可と対象アプリを確認してから、ご自身で再開できます。' };
  if (!s.schedulesReady) return { title: '自動切替の予定を確認してください', body: 'ルールは保存されています。予定の登録・反映を確認できていません。設定タブから状態を確認できます。' };
  if (s.observation !== 'applied' || !s.validUntil || s.validUntil * 1000 <= now) return { title: '反映を確認できていません', body: 'ルールは保存されています。制限中とは扱わず、ホームで現在の状態を確認できます。' };
  if (s.periods.some(p => p.startsAt * 1000 <= now && p.endsAt * 1000 > now)) return { title: '制限設定を反映しました', body: '選んだ時間の設定を反映しました。今の状態はホームで確認できます。' };
  return { title: '次の時間に向けて、準備できました', body: s.nextPeriod ? `${endTime(s.nextPeriod.startsAt, now)}から予定しています。今は設定した時間帯の外です。` : '今は設定した時間帯の外です。次の予定をホームで確認できます。' };
}

export function FirstRunOnboarding() {
  const setup = useOnboarding(), state = useScreenTime(), theme = useFlowTheme(), now = useVisibleClock();
  const draft = setup.draft, progress = setup.progress;
  const [reviewed, setReviewed] = useState(false), [resultSnapshot, setResultSnapshot] = useState<ScreenTimeSnapshot>();
  const [impacts, setImpacts] = useState<ScreenTimeResponse['impacts']>([]);
  const disabled = setup.busy || !!state.busy;
  usePreventRemove(setup.dirty, ({ repeat }) => { void setup.flush().then(saved => {
    if (saved) repeat(); else Alert.alert('入力を保存できませんでした', '入力はこの画面に残っています。保存を再試行するか、破棄を選べます。');
  }); });
  const leave = async () => { const result = await setup.run('onboardingDefer'); if (result.status === 'ok') home(); };
  const changeStep = async (step: OnboardingStep) => {
    if (draft?.commandID) { const result = await setup.run('onboardingEdit'); if (result.status !== 'ok') return; }
    setReviewed(false); setup.update({ step }); await setup.flush();
  };
  const next = async (step: OnboardingStep) => { setup.update({ step }); if (await setup.flush()) setReviewed(false); };
  const prepare = async () => {
    const result = await setup.run('onboardingPrepare');
    setReviewed(result.status === 'confirmation-required');
    setImpacts(result.impacts);
    if (result.snapshot) setResultSnapshot(result.snapshot);
    await state.refresh();
  };
  const submit = async () => {
    setReviewed(false);
    const result = await setup.run('onboardingCommit');
    if (result.snapshot) setResultSnapshot(result.snapshot);
    // A private completion acknowledgement can fail AFTER the policy was committed. Reading
    // finishes only its bookkeeping; it never repeats the accepted OS command.
    if (result.status === 'error') { const checked = await setup.refresh(); if (checked.snapshot) setResultSnapshot(checked.snapshot); }
    await state.refresh();
  };
  const authorize = async () => { if (!(await setup.flush())) return; const result = await state.run('authorize'); if (result.snapshot?.authorization === 'approved') await state.run('initialize'); await setup.refresh(); };
  const pick = async () => {
    if (!(await setup.flush())) return;
    const result = await state.run('pickApplications');
    if (result.status === 'ok' && result.ref) { setup.update({ selectionRef: result.ref }); await setup.flush(); }
  };
  const discard = () => Alert.alert('初回設定の入力を破棄しますか', '目的・曜日・時間・対象の下書きを削除します。保存したルールや現在の制限は変更しません。', [
    { text: '入力を続ける', style: 'cancel' },
    { text: '下書きを破棄', style: 'destructive', onPress: () => { void setup.run('onboardingDiscard').then(result => { if (result.status === 'ok') home(); }); } },
  ]);
  const back = () => { const index = draft ? steps.indexOf(draft.step) : 0; if (index > 0 && progress?.canEdit) void changeStep(steps[index - 1]); else void leave(); };
  const feedback = <>
    {setup.error && <View accessibilityLiveRegion="polite"><Notice title="初回設定を確認してください">{errorText[setup.error]}</Notice></View>}
    {setup.error && <Button label="保存した内容を読み直す" secondary disabled={disabled} onPress={() => { void setup.refresh(); }} />}
    {draft && <View style={styles.saveStatus}><Body muted>{setup.busy ? '設定の結果を確認しています。' : setup.saving ? '入力を保存しています。' : setup.dirty ? '未保存の入力があります。' : '変更は端末に保存済みです。'}</Body></View>}
  </>;
  if (!progress) return <FlowScreen title="初回設定を読み込めませんでした" onBack={home}>
    <Body>この機能に対応したiPhoneのビルドで設定できます。保存済みの内容は初期化しません。</Body>{feedback}<Button label="ホームへ" secondary onPress={home} />
  </FlowScreen>;
  if (progress.completed) {
    const result = onboardingResult(resultSnapshot ? currentControlSnapshot(state.snapshot, resultSnapshot) : state.snapshot, now);
    return <FlowScreen title={result.title}>
      <View style={styles.symbol}><OpenCircle color={theme.accent} size={64} /></View>
      <Body>{result.body}</Body>{feedback}
      <Body muted>ルール名と行動目標、曜日・時間は、設定タブからいつでも見直せます。</Body>
      <Button label="ホームで現在の状態を見る" disabled={disabled} onPress={home} />
    </FlowScreen>;
  }
  if (!draft) return <FlowScreen title="自分の時間に、余白を。">
    <View style={styles.welcome}><OpenCircle color={theme.accent} size={80} /><Body>つい開いてしまうアプリから、少し離れる。{ '\n' }大切にしたいことへ、時間を戻す。</Body></View>
    <Panel><Heading>まず、一つの時間を決めましょう</Heading><Body>どんな時間にしたいか。いつ、どのアプリから離れたいか。あなたが選びます。</Body></Panel>
    <Body muted>必要なときは、理由を書いて一時解除できます。ルールはあとから編集・停止できます。</Body>{feedback}
    <Button label="自分の時間をつくる" disabled={disabled} onPress={() => { void setup.run('onboardingBegin'); }} />
    <Button label="今は設定せず、ホームを見る" secondary disabled={disabled} onPress={() => { void leave(); }} />
  </FlowScreen>;
  const count = state.snapshot?.selections.find(s => s.ref === draft.selectionRef)?.count ?? 0;
  const editable = progress.canEdit, ready = progress.selectionReady && state.snapshot?.authorization === 'approved';
  return <FlowScreen title={titles[draft.step]} eyebrow={`はじめの設定 · ${steps.indexOf(draft.step) + 1} / 4`} onBack={back}>
    <View style={styles.steps} accessible={false}>{steps.map((step, index) => <View key={step} style={[styles.step, { backgroundColor: index <= steps.indexOf(draft.step) ? theme.accent : theme.line }]} />)}</View>
    {feedback}
    {draft.step === 'purpose' && <View style={flowStyles.section}>
      <Body>思い浮かぶことがあれば、あなたの言葉で。決まっていなくても、そのまま進めます。</Body>
      <Field label="この時間の名前（任意）" value={draft.title} maxLength={80} onChangeText={title => setup.update({ title })} placeholder="自分で決めた名前" editable={!disabled} />
      <Field label="大切にしたいこと・行動目標（任意）" value={draft.goal} maxLength={1000} onChangeText={goal => setup.update({ goal })} multiline placeholder="この時間を、どう過ごしたいですか" editable={!disabled} />
      <Body muted>入力した目的は端末内に保存し、ホームに表示します。未入力でも大丈夫です。</Body>
      <Button label="曜日と時間を決める" disabled={disabled} onPress={() => { void next('schedule'); }} />
    </View>}
    {draft.step === 'schedule' && <View style={flowStyles.section}>
      <Body>決めた曜日と時間だけ、選んだアプリを制限します。</Body>
      <Heading>曜日</Heading><View style={[flowStyles.row, styles.weekdays]}>{weekdayNames.map((day, index) => {
        const value = index + 1, selected = draft.weekdays.includes(value);
        return <Pressable key={day} accessibilityRole="checkbox" accessibilityLabel={`${day}曜日`} accessibilityState={{ checked: selected, disabled }} disabled={disabled}
          onPress={() => setup.update({ weekdays: selected ? draft.weekdays.filter(v => v !== value) : [...draft.weekdays, value].sort() })}
          style={[styles.day, { backgroundColor: selected ? theme.soft : theme.surface, borderColor: theme.muted }]}>
          <Text style={{ color: theme.text, fontSize: 16, lineHeight: 24 }}>{day}</Text><Text accessible={false} style={{ color: theme.text, fontSize: 12, lineHeight: 14 }}>{selected ? '✓' : ' '}</Text></Pressable>;
      })}</View>
      <Field label="開始時刻（24時間 HH:MM）" value={draft.start} onChangeText={start => setup.update({ start })} maxLength={5} placeholder="例 21:00" keyboardType="numbers-and-punctuation" autoCapitalize="none" editable={!disabled} />
      <Field label="終了時刻（24時間 HH:MM）" value={draft.end} onChangeText={end => setup.update({ end })} maxLength={5} placeholder="例 23:00" keyboardType="numbers-and-punctuation" autoCapitalize="none" editable={!disabled} />
      <Pressable accessibilityRole="checkbox" accessibilityLabel="翌日に終了する" accessibilityState={{ checked: draft.nextDay, disabled }} disabled={disabled}
        onPress={() => setup.update({ nextDay: !draft.nextDay })} style={[styles.nextDay, { borderColor: theme.muted, backgroundColor: draft.nextDay ? theme.soft : theme.surface }]}>
        <Text style={{ color: theme.text, fontSize: 16, lineHeight: 26 }}>{draft.nextDay ? '✓ ' : '□ '}翌日に終了する</Text>
      </Pressable>
      <Body muted>この端末の現地時刻に従います。曜日は開始する日を選び、日付をまたぐ場合は「翌日に終了」を選んでください。</Body>
      {!validOnboardingSchedule(draft) && <Body muted>曜日と正しい開始・終了時刻を選んでください。時間帯は1分から24時間までです。</Body>}
      <Button label="対象アプリへ" disabled={disabled || !validOnboardingSchedule(draft)} onPress={() => { void next('apps'); }} />
    </View>}
    {draft.step === 'apps' && <View style={flowStyles.section}>
      <Body>選んだアプリを、決めた時間だけ制限するために、iOSのスクリーンタイムの許可を使います。</Body>
      <Panel><Heading>許可とプライバシー</Heading><Body>アプリの選択と目的は端末内で扱います。ここで許可・選択しただけでは、制限は始まりません。</Body></Panel>
      {state.snapshot?.authorization !== 'approved' && <>
        {state.snapshot?.authorization === 'denied' && <Notice title="許可されていません">目的と時間は残っています。今は後回しにして、後から続けることもできます。</Notice>}
        <Button label="スクリーンタイムを許可する" disabled={disabled || state.snapshot?.availability !== 'device'} onPress={() => { void authorize(); }} />
      </>}
      {state.snapshot?.authorization === 'approved' && <Body>スクリーンタイム：許可済み</Body>}
      {draft.selectionRef && count > 0 && state.snapshot?.authorization === 'approved' && <Panel><Applications selectionRef={draft.selectionRef} count={count} refreshKey={state.refreshKey} /><Body muted>{count}件を選択{!ready ? '・再確認が必要です' : ''}</Body></Panel>}
      {!!draft.selectionRef && !ready && <Body muted>再開時は、以前の対象をそのまま有効扱いしません。アプリを選び直して確認してください。</Body>}
      <Button label={draft.selectionRef ? '対象アプリを選び直す' : '対象アプリを選ぶ'} secondary disabled={disabled || state.snapshot?.authorization !== 'approved'} onPress={() => { void pick(); }} />
      <Button label="内容を確認する" disabled={disabled} onPress={() => { if (ready) void prepare(); else void next('review'); }} />
    </View>}
    {draft.step === 'review' && <View style={flowStyles.section}>
      <Panel><Heading>{draft.title.trim() || '名前未設定のルール'}</Heading>
        <Body>{draft.weekdays.map(v => weekdayNames[v - 1]).join('・')} {draft.start}〜{draft.nextDay ? '翌' : ''}{draft.end}</Body>
        {draft.goal.trim() ? <RuleGoal goal={draft.goal} /> : <Body muted>行動目標：あとで決める</Body>}
        {draft.selectionRef && count > 0 && state.snapshot?.authorization === 'approved' ? <Applications selectionRef={draft.selectionRef} count={count} refreshKey={state.refreshKey} /> : <Body>対象アプリ：確認が必要です</Body>}
        <Body>一時解除：自分の言葉で理由を入力</Body>
      </Panel>
      {reviewed && impacts.length > 0 && <Notice title="一時解除への変更があります">{impacts.map(impact => impact.kind === 'shorten' && impact.endsAt
        ? `一時解除の終了が${endTime(impact.endsAt, now)}に早まります。` : '継続中の一時解除が終了、または状態の再確認が必要になります。').join('\n')}</Notice>}
      {draft.submitted && <Notice title="前の要求の結果を確認しています">{editable ? '前の要求は完了していません。入力は残っています。内容を確認し直してから再試行できます。' : '保存・反映の結果を確認できていません。新しいルールを重ねて作らず、現在の状態を確認してください。'}</Notice>}
      {!ready && <Notice title="初回設定は、まだ途中です">許可と対象アプリの確認後に、ご自身で確定すると開始します。今は制限を開始しません。</Notice>}
      <Body muted>最後の確定でルールを保存し、反映を要求します。時間帯の外であれば、次の開始を予定します。</Body>
      {ready && reviewed && <Button label={draft.submitted ? 'この内容で登録を再試行する' : 'この内容で、はじめる'} disabled={disabled} onPress={() => { void submit(); }} />}
      {ready && !reviewed && editable && <Button label="最新の内容を確認する" disabled={disabled} onPress={() => { void prepare(); }} />}
      {!editable && <Button label="保存・反映の結果を確認する" disabled={disabled} onPress={() => { void setup.refresh().then(result => { if (result.snapshot) setResultSnapshot(result.snapshot); void state.refresh(); }); }} />}
      {editable && <>
        <Button label="目的を見直す" secondary disabled={disabled} onPress={() => { void changeStep('purpose'); }} />
        <Button label="曜日・時間を見直す" secondary disabled={disabled} onPress={() => { void changeStep('schedule'); }} />
        <Button label="許可と対象アプリを見直す" secondary disabled={disabled} onPress={() => { void changeStep('apps'); }} />
      </>}
    </View>}
    <Button label="内容を残して、ホームへ" secondary disabled={disabled} onPress={() => { void leave(); }} />
    {editable && <Button label="下書きを破棄する" secondary disabled={disabled} onPress={discard} />}
    {!editable && <Button label="設定で現在の状態を確認する" secondary onPress={() => router.dismissTo('/settings')} />}
  </FlowScreen>;
}
const styles = StyleSheet.create({
  welcome: { gap: 32, paddingVertical: 24 }, symbol: { paddingVertical: 24 },
  saveStatus: { minHeight: 26 }, steps: { flexDirection: 'row', gap: 6 }, step: { flex: 1, height: 3, borderRadius: 2 },
  weekdays: { gap: 2 }, day: { minHeight: 52, minWidth: 44, padding: 6, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  nextDay: { minHeight: 50, padding: 12, borderWidth: 1, borderRadius: 12, justifyContent: 'center' },
});
