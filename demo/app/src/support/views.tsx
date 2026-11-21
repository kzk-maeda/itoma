import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { OpenCircle } from '../../../../src/components/home/open-circle';
import { LinkRow } from '../../../../src/components/flow/ui';
import { useSupport } from './state';

const items = [
  ['スケジュール', '保存した時間の設定', '毎日　21:00 – 23:00', '夜の読書のために、XとYouTubeを制限します。'],
  ['スクリーンタイム', '許可と反映の状態', 'スクリーンタイムの許可', 'このデモには合成の設定を表示しています。'],
  ['記録とプライバシー', '選択の記録・保存容量・削除', '端末内の記録', 'いとまに入力した理由と操作の記録は、端末内に保存します。'],
  ['使い方とこのアプリ', '制限と一時解除・端末内の保存', '自分の時間へ戻るために', '曜日・時間帯・対象アプリを決めて制限します。必要なときは使う理由を確かめて、一時解除できます。'],
];
const amounts = [100, 300, 500];
const yen = (amount: number) => '¥' + amount.toLocaleString('ja-JP');
function Back({ label, onClick }: { label: string; onClick: () => void }) {
  return <button className="back" onClick={onClick}><span aria-hidden="true">‹</span>{label}</button>;
}
function SettingsBack() { return <Back label="設定に戻る" onClick={() => router.dismissTo('/')} />; }
function Title({ text }: { text: string }) { return <h1 tabIndex={-1}>{text}</h1>; }
function CardMark() {
  return <div className="stamp" aria-hidden="true"><OpenCircle size={30} color="currentColor" /></div>;
}
export function Settings() {
  const { monthly, select } = useSupport();
  return <section className="page slim"><Title text="設定" /><p className="intro">自分で決めた時間と、記録の扱いを確認できます。</p>
    <div className="rows">{items.map(([label, detail], i) => <LinkRow key={label} label={label} detail={detail} onPress={() => router.push({ pathname: './detail', params: { item: String(i) } })} />)}</div>
    <div className="support-entry"><LinkRow label="いとまを支える" detail={monthly ? '毎月の支援を確認・管理' : '開発と運営への任意の支援'} onPress={() => { select(undefined); router.push('./support'); }} /></div>
  </section>;
}
export function Detail() {
  const { item } = useLocalSearchParams<{ item: string }>();
  const info = items[Number(item)];
  if (!info) return <Redirect href="/" />;
  return <section className="page slim"><SettingsBack /><Title text={info[0]} /><div className="card"><h2>{info[2]}</h2><p>{info[3]}</p></div></section>;
}
export function Support() {
  const { frequency, switchFrequency, select, choice, monthly } = useSupport();
  const recurring = frequency === 'monthly';
  return <section className="page wide"><SettingsBack /><Title text="いとまを支える" />
    <div className="columns"><article className="letter"><div className="letterhead"><span>開発者より</span><CardMark /></div>
      <h2>いつものいとまを、<br />これからも。</h2>
      <p>スマホを置きたいときに、安心して置ける。そのための小さな手入れを、続けていきます。</p>
      <p>ご支援は、iOSの変更に合わせた動作確認や、文字の読みやすさ、戻りやすさの改善に使います。</p>
      <footer>いとま開発者　Kazuki Maeda</footer>
    </article><div className="picker"><h2>支援のしかた</h2><p className="muted">金額は自分で選べます。どなたも同じ機能を使えます。</p>
      <fieldset className="segment"><legend className="sr">支援の頻度</legend>{(['once', 'monthly'] as const).map(f => <label key={f}><input type="radio" name="frequency" checked={frequency === f} onChange={() => switchFrequency(f)} /><span>{f === 'once' ? '今回だけ' : '毎月'}</span></label>)}</fieldset>
      {recurring && monthly ? <div className="card"><h3>毎月 {yen(monthly)} の支援を設定中</h3><button className="plain" onClick={() => router.push('./manage')}>毎月の支援を管理する</button></div> :
      <><fieldset className="amounts"><legend>{recurring ? 'ひと月の支援額' : '今回の支援額'}</legend><div>{amounts.map(n => <label key={n}><input type="radio" name="amount" checked={choice?.amount === n} onChange={() => select({ frequency, amount: n })} /><span>{yen(n)}</span></label>)}</div></fieldset>
        <p className="fine">{recurring ? '毎月自動で更新する想定のデモです。設定から次回の更新を停止できます。' : '1回限りの支援です。自動更新はありません。'}</p>
        <button className="primary" disabled={!choice} onClick={() => router.push('./confirm')}>支援内容を確認する</button></>}
      {monthly && !recurring && <button className="plain" onClick={() => router.push('./manage')}>毎月の支援を管理する</button>}
    </div></div></section>;
}
export function Confirm() {
  const { choice, confirm, monthly } = useSupport();
  if (!choice || (choice.frequency === 'monthly' && monthly)) return <Redirect href="./support" />;
  const periodic = choice.frequency === 'monthly';
  return <section className="page slim"><Back label="金額の選択に戻る" onClick={() => router.dismissTo('./support')} /><Title text="支援内容の確認" />
    <div className="receipt"><CardMark /><p>いとまの開発と運営へ</p><strong>{yen(choice.amount)}</strong><p>{periodic ? '毎月 · 自動更新' : '今回だけ · 自動更新なし'}</p></div>
    <p className="intro">{periodic ? '毎月同じ金額で更新する想定です。次回からの停止は設定で試せます。' : '選んだ金額で、今回の支援を試します。'}</p>
    <p className="fine">模擬決済です。請求や契約は発生しません。</p>
    <button className="primary" onClick={() => { confirm(); router.replace('./thanks'); }}>{periodic ? '毎月 ' : ''}{yen(choice.amount)} の支援を試す</button>
    <button className="plain" onClick={() => router.dismissTo('/')}>支援せず設定に戻る</button>
  </section>;
}
export function Thanks() {
  const { receipt } = useSupport();
  if (!receipt) return <Redirect href="/" />;
  return <section className="page slim"><div className="thanks"><CardMark /><Title text="ありがとうございます。" /><p>これからも、日々の使い心地を少しずつ整えていきます。</p><p className="sign">いとま開発者　Kazuki Maeda</p></div>
    <p className="fine center">模擬支援 · {receipt.frequency === 'once' ? '今回だけ ' : '毎月 '}{yen(receipt.amount)} · 実際の請求 ¥0</p>
    <button className="primary" onClick={() => router.dismissTo('/')}>設定に戻る</button></section>;
}
export function Manage() {
  const { monthly, stop } = useSupport();
  const [stopped, setStopped] = useState(false);
  return <section className="page slim"><SettingsBack /><Title text="毎月の支援" />
    <div className="card"><h2>{monthly ? '毎月 ' + yen(monthly) : stopped ? '次回の更新を停止しました' : '毎月の支援はありません'}</h2><p>{monthly ? '毎月の模擬支援を設定しています。' : 'いつも通りいとまを使えます。'}</p></div>
    {monthly && <button className="secondary" onClick={() => { stop(); setStopped(true); }}>次回の更新を停止する</button>}
    </section>;
}
