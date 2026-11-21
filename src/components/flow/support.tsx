import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, AppState, Modal, Pressable, Text } from 'react-native';
import { observeSupport, supportRequest, type SupportAction, type SupportPrice, type SupportReply } from '../../../modules/itoma-native/src/support';
import { useAppNavigation } from '@/state/navigation';
import { Body, Button, FlowScreen, Heading, Panel, useFlowTheme } from './ui';

const messages = {
  loading: '支援額を読み込んでいます。',
  empty: '現在、選べる支援額がありません。',
  offline: '支援額を読み込めませんでした。',
  changed: '商品または価格が変わりました。支援額を選び直してください。',
  cancelled: '購入を取り消しました。',
  buying: 'Appleの購入結果を確認しています。',
  pending: '承認待ちです。Appleから結果が届くまでお待ちください。',
  unknown: '購入結果を確認できませんでした。すでに受け付けた取引を確認し直せます。',
  verified: 'ご支援ありがとうございます',
  unavailable: '購入手続きを始められませんでした。',
  idle: '',
};

export function SupportScreen() {
  const navigation = useAppNavigation(), theme = useFlowTheme();
  const [products, setProducts] = useState<SupportPrice[]>([]);
  const [selected, select] = useState<SupportPrice>();
  const [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState<keyof typeof messages>('loading');
  const [canLeave, setCanLeave] = useState(false);
  const [receipt, setReceipt] = useState<string>();
  const generation = useRef(0), active = useRef(false), running = useRef(false);
  const refreshNeeded = useRef(false), refresh = useRef<() => void>(() => {}), operation = useRef(0);
  const displayed = useRef<SupportReply['state'] | undefined>(undefined);
  const exit = () => { setConfirm(false); navigation.finish({ screen: 'settings' }); };

  const accept = useCallback((reply: SupportReply) => {
    displayed.current = reply.state;
    if (reply.products) setProducts(reply.products);
    if (reply.state === 'changed' || reply.state === 'empty') select(undefined);
    setCanLeave(!!reply.canLeavePending);
    setStatus((reply.state === 'idle' || reply.state === 'changed') && reply.products?.length === 0 ? 'empty' : reply.state);
    setReceipt(reply.receipt);
    if (reply.state !== 'idle') setConfirm(false);
  }, []);

  const run = useCallback(async (action: SupportAction, value?: string) => {
    if (running.current || !active.current) return;
    running.current = true; operation.current++;
    const ticket = generation.current;
    if (action === 'buy') setStatus('buying');
    try {
      let reply = await supportRequest(action, value);
      if (reply.state === 'idle' && action !== 'load') reply = await supportRequest('load');
      if (ticket === generation.current) accept(reply);
    } catch {
      if (ticket === generation.current) {
        setConfirm(false);
        displayed.current = undefined;
        setStatus(action === 'load' ? 'offline' : 'unknown');
      }
    } finally {
      if (ticket === generation.current) {
        running.current = false;
        if (refreshNeeded.current) refresh.current();
      }
    }
  }, [accept]);

  useFocusEffect(useCallback(() => {
    active.current = true;
    displayed.current = undefined;
    setConfirm(false); select(undefined); setReceipt(undefined); setStatus('loading');
    // Listen before the initial read so a deferred approval cannot slip between the two.
    let reading = false;
    const ticket = generation.current;
    async function observe() {
      if (ticket !== generation.current || displayed.current === 'verified' || AppState.currentState === 'background') return;
      if (reading || running.current) { refreshNeeded.current = true; return; }
      refreshNeeded.current = false;
      reading = true;
      const before = operation.current;
      try {
        const reply = await supportRequest('status');
        if (ticket !== generation.current || before !== operation.current || running.current) return;
        // Keep an explicit cancellation, price-change message or catalog error until the user acts.
        if (reply.state === 'idle' && !['pending', 'unknown', 'buying'].includes(displayed.current ?? '')) return;
        if (reply.state === 'idle') await run('load');
        else if (reply.state !== displayed.current || reply.canLeavePending) accept(reply);
      } catch { /* An explicit purchase/retry reports any error; observation never starts a purchase. */ }
      finally { reading = false; if (refreshNeeded.current && !running.current) void observe(); }
    }
    refresh.current = () => { void observe(); };
    const subscription = observeSupport(refresh.current);
    void run('load');
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void observe(); });
    return () => {
      generation.current++; active.current = false; running.current = false;
      refreshNeeded.current = false; subscription?.remove(); sub.remove();
    };
  }, [accept, run]));

  useEffect(() => {
    if (status === 'verified' && receipt) {
      // Commit the acknowledgement only after React has actually displayed this transaction.
      void supportRequest('ack', receipt).catch(() => {});
    }
    if (messages[status] && active.current) AccessibilityInfo.announceForAccessibility(messages[status]);
  }, [status, receipt]);

  const choosing = status === 'idle' || status === 'changed' || status === 'cancelled' || status === 'unavailable';
  return <FlowScreen title="いとまを支える" backLabel="‹ 設定" onBack={exit}>
    {choosing && <>
      <Panel><Heading>開発者より</Heading>
        <Body>いとまを使ってくださり、ありがとうございます。いただいた支援は、iOSの更新への対応や、文字と画面を読みやすくする改善に使います。</Body>
      </Panel>
      <Body>支援は1回限りで、自動更新はありません。支援の有無で使える機能は同じです。</Body>
    </>}
    {!!messages[status] && (status === 'verified' ? <Heading>{messages[status]}</Heading> : <Body>{messages[status]}</Body>)}
    {choosing && <>
      <Panel><Heading>支援額を選ぶ</Heading>
        {products.map(product => <Pressable accessibilityRole="radio" accessibilityLabel={product.display}
          accessibilityState={{ checked: product.id === selected?.id }} onPress={() => select(product)} key={product.id}
          style={{ minHeight: 48, justifyContent: 'center', borderBottomWidth: 1, borderColor: theme.line }}>
          <Text style={{ color: theme.text, fontSize: 18 }}>{product.id === selected?.id ? '●' : '○'}　{product.display}</Text>
        </Pressable>)}
      </Panel>
      <Button label="支援内容を確認する" disabled={!selected} onPress={() => setConfirm(true)} />
    </>}
    {(status === 'empty' || status === 'offline') && <Button label="支援額を読み直す" onPress={() => { setStatus('loading'); void run('load'); }} />}
    {status === 'unknown' && <Button label="購入結果を確認し直す" onPress={() => { void run('retry'); }} />}
    {canLeave && <Button secondary label="この結果待ちを閉じる" onPress={() => Alert.alert('結果待ちの表示を閉じますか？',
      'Appleへの購入依頼は取り消されません。後から承認された場合は、その購入が成立します。',
      [{ text: '結果を待つ', style: 'cancel' }, { text: '表示を閉じる', onPress: () => { void run('leavePending'); } }])} />}
    {status === 'verified' && <Body>いとまの開発と運営に役立てます。</Body>}
    <Button secondary label={choosing ? '支援せず設定に戻る' : '設定に戻る'} onPress={exit} />
    <Modal visible={confirm} presentationStyle="pageSheet" animationType="slide" allowSwipeDismissal
      onRequestClose={() => setConfirm(false)}>
      <FlowScreen title="支援内容の確認" backLabel="‹ 金額の選択" onBack={() => setConfirm(false)}>
        <Heading>{selected?.display} · 今回だけ</Heading><Body>次にAppleの購入画面で確定します。</Body>
        <Button label={`${selected?.display ?? ''}の支援に進む`} disabled={!selected || status === 'buying'} onPress={() => {
          if (selected) void run('buy', JSON.stringify(selected));
        }} />
        <Button secondary label="金額の選択に戻る" onPress={() => setConfirm(false)} />
        <Button secondary label="支援せず設定に戻る" onPress={exit} />
      </FlowScreen>
    </Modal>
  </FlowScreen>;
}
