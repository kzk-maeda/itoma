import { router } from 'expo-router';
import { useScreenTime } from '@/state/screen-time';
import { back } from './navigation';
import { Body, Button, FlowScreen, Heading, Panel } from './ui';

export function OnboardingScreen() {
  const state = useScreenTime();
  const authorize = async () => {
    const permission = await state.run('authorize');
    if (permission.snapshot?.authorization !== 'approved') return;
    const initialized = await state.run('initialize');
    if (initialized.snapshot?.storage === 'ready') {
      if (initialized.snapshot.rules.length && !state.ruleDraft) { router.dismissTo('/settings'); return; }
      if (!state.ruleDraft) state.beginRule();
      router.dismissTo('/rule');
    }
  };
  return <FlowScreen title="自分で決めた、余白のために。" onBack={back}>
    <Body>使いすぎを責めるためではなく、大切にしたい時間へ戻るために。離れたいアプリと曜日・時間帯を、あなたが選びます。</Body>
    <Panel><Heading>できること</Heading><Body>決めた時間に、選んだアプリを制限します。必要なときは理由を書いて、1〜30分の一時解除を確認できます。</Body></Panel>
    <Panel><Heading>許可とプライバシー</Heading><Body>iOSのスクリーンタイムの許可を使います。アプリの選択と理由は端末内に保存し、理由は設定から削除できます。制限はいつでも停止できます。</Body></Panel>
    <Body muted>許可の取消を確認した場合は、対象を選び直してからご自身で再開できます。</Body>
    <Button label={state.snapshot?.authorization === 'approved' ? '許可を確認してルールへ' : 'スクリーンタイムを許可する'} disabled={!!state.busy || state.snapshot?.availability !== 'device'} onPress={() => { void authorize(); }} />
    <Button label="今は設定せずに戻る" secondary onPress={back} />
  </FlowScreen>;
}
