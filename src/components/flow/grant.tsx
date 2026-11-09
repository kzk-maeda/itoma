import { Alert } from 'react-native';
import { useVisibleClock } from '@/hooks/use-visible-clock';
import { useScreenTime } from '@/state/screen-time';
import { Applications } from './applications';
import { home } from './navigation';
import { endTime, grantRemaining } from './presentation';
import { Body, Button, FlowScreen, Heading, Notice, Panel } from './ui';

export function GrantScreen() {
  const state = useScreenTime(), now = useVisibleClock();
  const targets = state.snapshot?.targets.filter((t) => t.grantCommandID) ?? [];
  const observed = state.snapshot?.authorization === 'approved' && state.snapshot.activation === 'enabled'
    && state.snapshot.observation === 'applied' && (state.snapshot.validUntil ?? 0) * 1000 > now && !state.error;
  const end = (ref: string) => Alert.alert('この一時解除を終了しますか', '選んだアプリの一時解除だけを終了します。ほかの一時解除やルールは変更しません。', [
    { text: '戻る', style: 'cancel' }, { text: '終了して制限へ戻す', onPress: () => { void state.run('endGrant', { ref }); } },
  ]);
  return <FlowScreen title="一時解除の状況" onBack={home}>
    {!targets.length && <Panel><Heading>進行中の一時解除はありません</Heading><Body>解除の期限や要求が終了しています。現在のルールと制限の状態は、ホームで確認できます。</Body></Panel>}
    {targets.map((target, index) => <Panel key={target.ref}>
      <Heading>対象 {index + 1}</Heading><Applications selectionRef={target.selectionRef} targetRef={target.ref} refreshKey={state.refreshKey} />
      {target.grantStatus === 'active' && observed && (target.grantEndsAt ?? 0) * 1000 > now
        ? <><Heading>一時解除の残り {grantRemaining(target.grantEndsAt!, now)}</Heading><Body>{endTime(target.grantEndsAt!, now)}が上限です。</Body></>
        : <Notice title={(target.grantEndsAt ?? 0) * 1000 <= now ? '解除の期限が終了しました' : target.grantStatus === 'failed' ? '解除を完了できませんでした' : '解除・再制限の反映を確認しています'}>
          解除済み・再制限済みとは扱わず、現在の状態を確認できます。
        </Notice>}
      {target.grantEndsAt && <Body muted>この要求の上限：{endTime(target.grantEndsAt, now)}。再表示や再試行で延長しません。</Body>}
      {['failed', 'uncertain'].includes(target.grantStatus ?? '') && (target.grantEndsAt ?? 0) * 1000 > now
        && <Button label="元の期限のまま登録を再試行" disabled={!!state.busy || !state.snapshot?.schedulesReady || state.snapshot.authorization !== 'approved' || state.snapshot.activation !== 'enabled'} onPress={() => { void state.run('retryGrant', { ref: target.grantCommandID }); }} />}
      <Button label="このアプリを制限へ戻す" testID={`grant-end-${index}`} secondary disabled={!!state.busy} onPress={() => end(target.grantCommandID!)} />
    </Panel>)}
    <Button label="現在の状態を確認する" secondary disabled={!!state.busy} onPress={() => { void state.run('reconcile'); }} />
    <Button label="ホームへ戻る" onPress={home} />
  </FlowScreen>;
}
