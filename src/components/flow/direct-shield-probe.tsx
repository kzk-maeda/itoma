import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Alert, AppState } from 'react-native';
import { directShieldProbe, type DirectProbeAction, type DirectProbeResponse } from '../../../modules/itoma-native';
import { useAppNavigation } from '@/state/navigation';
import { useScreenTime } from '@/state/screen-time';
import { Applications } from './applications';
import { Body, Button, FlowScreen, Heading, Notice, Panel } from './ui';

const messages = {
  busy: '前の操作を確認できませんでした。状態を読み直すか、解除をもう一度お試しください。',
  unavailable: '操作を確認できませんでした。解除できない場合は、iPadの設定からITOMAのスクリーンタイム許可を取り消してください。',
  invalid: '選択と時刻を確認できません。アプリ1件を選び直してください。',
  changed: '状態または開始時刻が変わりました。対象を選び直して時刻を準備してください。',
  'normal-rules-active': '通常ルールをすべて停止してから、検証を準備してください。',
  'authorization-required': 'スクリーンタイムの許可が必要です。許可を確認してから対象を選び直してください。',
};
const time = (value?: number) => value === undefined ? '未設定' : new Date(value * 1000).toLocaleString('ja-JP');

export function DirectShieldProbeScreen() {
  const navigation = useAppNavigation(), normal = useScreenTime();
  const enabled = process.env.EXPO_PUBLIC_DIRECT_SHIELD_PROBE === '1' && directShieldProbe.available();
  const [response, setResponse] = useState<DirectProbeResponse>();
  const [busy, setBusy] = useState(false), [refreshKey, setRefreshKey] = useState(0);
  const active = useRef(true), sequence = useRef(0), running = useRef(false);
  const run = useCallback(async (action: DirectProbeAction, id?: string) => {
    if (!enabled || !active.current || (running.current && action !== 'stop')) return;
    const current = ++sequence.current; running.current = true; setBusy(true);
    const result = await directShieldProbe.run(action, id);
    if (current !== sequence.current) return;
    running.current = false;
    if (!active.current) return;
    setBusy(false);
    if (result.status !== 'cancelled') {
      setResponse(old => ({ ...result, snapshot: result.snapshot ?? old?.snapshot }));
      setRefreshKey(key => key + 1);
    }
  }, [enabled]);
  useFocusEffect(useCallback(() => {
    active.current = true;
    if (enabled) void run('snapshot');
    return () => { active.current = false; };
  }, [enabled, run]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', value => { if (value === 'active' && !running.current) void run('snapshot'); });
    return () => subscription.remove();
  }, [run]);
  const s = response?.snapshot;
  const stopNormal = () => Alert.alert('通常ルールを停止しますか', '保存したルールを残して停止します。検証の予定は、次の準備と登録で別に作成します。', [
    { text: '戻る', style: 'cancel' }, { text: 'すべて停止する', onPress: () => { void normal.run('stop').then(() => run('snapshot')); } },
  ]);
  const arm = () => {
    if (!s?.id || s.phase !== 'prepared') return;
    const id = s.id;
    Alert.alert('この内容で検証の予定を登録しますか', `選択したアプリ1件\n開始：${time(s.startsAt)}\n終了：${time(s.endsAt)}\n画面を離れても予定は残ります。いつでもこの画面から解除できます。`, [
      { text: '戻る', style: 'cancel' }, { text: '予定を登録する', onPress: () => { void run('arm', id); } },
    ]);
  };
  return <FlowScreen title="背景制限の検証" backLabel="‹ 設定" onBack={() => navigation.finish({ screen: 'settings' })}
    footer={enabled ? <Button label="今すぐ解除して検証を終了" testID="direct-probe-stop" secondary onPress={() => { void run('stop'); }} /> : undefined}>
    {!enabled ? <Notice title="このビルドでは利用できません">検証用の実機ビルドで開いてください。</Notice> : <>
      <Notice title="実機検証用の独立した制限です">通常ルールを停止し、支障のないアプリ1件で確認します。この検証は振り返りの時間集計には入りません。</Notice>
      <Panel><Heading>1. 通常ルールの停止</Heading>
        <Body>{normal.snapshot?.activation === 'paused' ? '通常ルールの停止が保存されています。' : '先に通常ルールを停止してください。'}</Body>
        <Button label="通常ルールをすべて停止する内容を確認" secondary disabled={busy || !!normal.busy} onPress={stopNormal} />
      </Panel>
      <Panel><Heading>2. 対象と時刻の準備</Heading>
        <Body>通常ルールと重ならないアプリを1件選びます。開始は約3分後の分境界、継続は20分です。</Body>
        <Body muted>予定を登録するまでは制限しません。準備した内容は、画面を離れても残ります。</Body>
        {!!s?.selectedCount && <Applications source="direct-probe" selectionRef={s.id ?? ''} refreshKey={refreshKey} />}
        <Body>開始：{time(s?.startsAt)}</Body><Body>終了：{time(s?.endsAt)}</Body>
        <Button label="アプリ1件を選んで時刻を準備" disabled={busy || s?.phase === 'armed' || s?.phase === 'registering'} onPress={() => { void run('pick'); }} />
        <Button label="この内容で予定を登録する確認へ" disabled={busy || s?.phase !== 'prepared'} onPress={arm} />
      </Panel>
      <Panel><Heading>3. 取得した状態</Heading>
        <Body>{s?.phase === 'armed' ? '予定登録済みです。実際の制限は対象アプリで確認してください。' : s?.phase === 'prepared' ? '準備済み・予定は未登録です。' : s?.phase === 'stopped' ? '検証の終了を保存しています。' : s?.phase === 'registering' ? '予定の登録結果を確認できていません。解除してから準備し直してください。' : '検証の予定はありません。'}</Body>
        <Body>専用ストアの設定：{s?.storeCount === 1 ? '対象1件の設定あり' : s ? '対象の設定なし' : '未確認'}</Body>
        <Body muted>これは読み取れた設定値です。OSの遮断が成立したことは、対象アプリを開いて確認します。</Body>
        {s?.observedAt !== undefined && <Body>最終記録：{time(s.observedAt)}（{s.origin === 'monitor' ? 'Extension' : s.origin === 'expiry' ? '本体復帰時の期限後解除' : '手動解除'} / {s.observation === 'applied' ? '設定の読戻し一致' : s.observation === 'cleared' ? '設定の消去を読戻し確認' : '結果不明'}）</Body>}
        <Button label="状態を読み直す" secondary disabled={busy} onPress={() => { void run('snapshot'); }} />
      </Panel>
      {response?.status === 'error' && <Notice title="操作を確認できません">{messages[response.code ?? 'unavailable']}</Notice>}
      <Body muted>開始後はITOMAを開く前に対象アプリを確認します。ほかの制限が重なると、この検証を解除しても利用できない場合があります。解除を確認できない場合は、iPadの設定からITOMAのスクリーンタイム許可を取り消せます。</Body>
    </>}
  </FlowScreen>;
}
