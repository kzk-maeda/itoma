import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { OpenCircle } from '../../../../src/components/home/open-circle';
import { GraphiteColors } from '../../../../src/constants/theme';
import './study.css';

type Mode = 'reason' | 'purchase';
type Rule = { mode: 'reason' } | { mode: 'purchase'; price: number };
type Step = 'setup' | 'home' | 'choose' | 'pause' | 'review' | 'purchase' | 'result';
const apps = ['X', 'YouTube'] as const;
type App = typeof apps[number];
const method = { reason: '理由を書いて開く', purchase: '決めた額で開く' } as const;
const prices = [100, 300, 500];
const yen = (price: number) => '¥' + price.toLocaleString('ja-JP');
const minute = 60_000;
const initialTime = 21 * 60 + 45;
const ruleEnd = 23 * 60;
function clock(minutes: number) {
  return Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2, '0');
}
const iconPaths = {
  book: 'M3 5c3.5-1 6-.3 9 1.5C15 4.7 17.5 4 21 5v13c-3.5-1-6-.3-9 1.5C9 17.7 6.5 17 3 18z M12 6.5v13',
  pen: 'M5 19l4-1 11-11-3-3L6 15z M14 7l3 3',
  coin: 'M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 1 1 17 0z M9 8l3 4 3-4 M9 12h6 M9 14.5h6 M12 12v5',
  check: 'M5 12l4 4L19 6',
  back: 'M14 5l-7 7 7 7',
};
function Icon({ name }: { name: keyof typeof iconPaths }) {
  return <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={iconPaths[name]} /></svg>;
}

const themeVars = Object.fromEntries(Object.entries(GraphiteColors).flatMap(([appearance, palette]) =>
  Object.entries(palette).map(([name, value]) => ['--' + appearance + '-' + name, value]))) as CSSProperties;

export default function UnlockChoices() {
  const [step, setStep] = useState<Step>('setup');
  const [mode, setMode] = useState<Mode>('reason');
  const [price, setPrice] = useState<number>();
  const [rule, setRule] = useState<Rule>({ mode: 'reason' });
  const [app, setApp] = useState<App>();
  const [reason, setReason] = useState('');
  const [grants, setGrants] = useState<Partial<Record<App, number>>>({});
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(0);
  const [notice, setNotice] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const discard = useRef<HTMLDialogElement>(null);
  const current = Math.min(ruleEnd, initialTime + Math.floor(Math.max(0, now - started) / minute));
  const until = (expiry: number) => clock(initialTime + Math.floor((expiry - started) / minute));
  const restricted = apps.filter(key => !(grants[key] && grants[key]! > now));
  const ended = current >= ruleEnd;
  const setup = step === 'setup';
  const recipient = app ?? apps[0];
  const paid = rule.mode === 'purchase';
  const fee = rule.mode === 'purchase' ? yen(rule.price) : '無料';
  const duration = Math.min(5, ruleEnd - current);
  const previewEnd = clock(current + duration);

  useEffect(() => {
    if (!started) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [started]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    document.querySelector('.study')?.scrollTo(0, 0);
  }, [step]);

  function save() {
    if (mode === 'purchase' && !price) return;
    const time = Date.now();
    setRule(mode === 'purchase' && price ? { mode, price } : { mode: 'reason' });
    setStarted(time); setNow(time); setGrants({}); setApp(undefined); setReason('');
    setNotice('ルールを保存しました。'); setStep('home');
  }
  function keep(message = '制限を続けています。') {
    setNotice(message); setApp(undefined); setReason(''); setStep('home');
  }
  function leave() {
    if (reason.trim()) discard.current?.showModal();
    else keep();
  }
  function grant() {
    if (!app || (paid ? step !== 'purchase' : step !== 'review' || !reason.trim())) return;
    const time = Date.now();
    const end = Math.min(time + 5 * minute, started + (ruleEnd - initialTime) * minute);
    if (end <= time) { setNow(time); keep('ルールの時間が終了しました。'); return; }
    setGrants(previous => ({ ...previous, [app]: end }));
    setNow(time); setReason(''); setNotice(''); setStep('result');
  }
  function reset() {
    setMode('reason'); setPrice(undefined); setNotice(''); setStarted(0); setNow(0);
    setApp(undefined); setGrants({}); setReason(''); setStep('setup');
  }
  function back() {
    if (step === 'choose') keep();
    if (step === 'pause') setStep('choose');
    if (step === 'review') setStep('pause');
    if (step === 'purchase') setStep('review');
  }
  const showBack = ['choose', 'pause', 'review', 'purchase'].includes(step);
  const title = setup ? '一時解除の方法' : step === 'home' ? 'いまのルール'
    : step === 'choose' ? 'どのアプリを開きますか？' : step === 'pause' ? 'いま、' + recipient + 'を開きますか？'
    : step === 'review' ? '一時解除の確認' : step === 'purchase' ? '購入のシミュレーション'
    : (grants[recipient] ?? 0) > now ? recipient + 'を一時解除しました' : '一時解除が終了しました';
  return <main className="study" style={themeVars} lang="ja">
    <header className="mast"><div className="brand"><OpenCircle size={29} color="currentColor" />いとま</div><span>体験デモ · 実際の請求はありません</span></header>
    <div className={step === "home" ? "spread home" : "spread"}>
      <aside className="folio" aria-label="設定するルール">
        <div className="folio-head"><span className="book"><Icon name="book" /></span><div><p className="meta">時間のルール</p><h2>夜の読書</h2></div></div>
        <div className="dial" style={{ '--progress': (ruleEnd - current) / 120 * 360 + 'deg' } as CSSProperties}>
          <div className="dialcore"><span>{setup ? '開始' : '残り'}</span><strong>{setup ? '21:00' : ruleEnd - current}</strong><span>{setup ? '23:00 まで' : '分'}</span></div>
        </div>
        <div className="purpose"><p className="meta">この時間に大切にしたいこと</p><p>寝る前に、本をひらく。</p></div>
        <div className="folio-foot"><span>毎日　21:00 – 23:00</span><span>X・YouTube</span></div>
      </aside>
      <section className="sheet" aria-labelledby="screen-title">
        <div className="section-top">{showBack && <button className="back" onClick={back} aria-label="前の画面に戻る"><Icon name="back" /></button>}<span className="meta">{setup ? 'ルール設定' : step === 'home' ? 'ホーム' : step === 'purchase' ? '模擬購入' : '夜の読書 · 一時解除'}</span></div>
        <h1 id="screen-title" tabIndex={-1} ref={heading}>{title}</h1>
        {setup && <>
          <p className="intro">あとでアプリを開きたくなったとき、<wbr />どう立ち止まるかを選びます。</p>
          <fieldset className="options"><legend className="sr">一時解除の方法</legend>
            {(['reason', 'purchase'] as const).map(key => <label className="option" key={key}>
              <input type="radio" name="method" checked={mode === key} onChange={() => setMode(key)} />
              <span className="method-icon"><Icon name={key === 'reason' ? 'pen' : 'coin'} /></span>
              <span className="option-copy"><strong>{method[key]}</strong><small>{key === 'reason' ? '使う理由を、自分のことばで。' : '自分で選んだ金額を、解除するたびに支払います。'}</small></span>
            </label>)}
          </fieldset>
          {mode === 'purchase' && <fieldset className="prices"><legend>1回の解除に使う金額</legend><div>{prices.map(amount => <label key={amount}><input type="radio" name="amount" checked={price === amount} onChange={() => setPrice(amount)} /><span>{yen(amount)}</span></label>)}</div><small>保存時の支払いはありません。金額はデモ用の例です。</small></fieldset>}
          <button className="primary" disabled={mode === 'purchase' && !price} onClick={save}>ルールを保存する</button>
        </>}
        {step === 'home' && <>
          <p className="intro" role="status">{notice || '夜の読書の時間です。'}</p>
          <dl><div><dt>一時解除の方法</dt><dd>{method[rule.mode]}</dd></div>{paid && <div><dt>1回の解除</dt><dd>{fee}</dd></div>}{apps.map(key => <div key={key}><dt>{key}</dt><dd>{ended ? '時間外' : restricted.includes(key) ? '制限中' : until(grants[key]!) + 'まで解除中'}</dd></div>)}</dl>
          <button className="primary" disabled={ended || !restricted.length} onClick={() => { setApp(undefined); setNotice(''); setStep('choose'); }}>一時解除する</button>
          <button className="quiet" onClick={reset}>別の設定でデモを試す</button>
        </>}
        {step === 'choose' && <>
          <p className="intro">このルールで制限しているアプリから、ひとつ選びます。</p>
          <fieldset className="options"><legend className="sr">対象アプリ</legend>{restricted.map(key => <label key={key} className="option"><input type="radio" name="app" checked={app === key} onChange={() => setApp(key)} /><b className="app-icon">{key === 'X' ? '𝕏' : '▶'}</b><strong>{key}</strong></label>)}</fieldset>
          <button className="primary" onClick={leave}>制限を続ける</button><button className="secondary" disabled={!app || ended} onClick={() => setStep('pause')}>選んだアプリで進む</button>
        </>}
        {step === 'pause' && <>
          <blockquote><small>自分で決めた、この時間の目的</small>寝る前に、本をひらく。</blockquote>
          {paid ? <p className="intro">このルールでは、1回の一時解除に<strong>{fee}</strong>を選んでいます。今はそのまま、本に戻ることもできます。</p>
            : <label className="reason">何のために開きますか？<textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="自分のことばで入力" rows={3} /></label>}
          <p className="note">{recipient}のみ、{duration}分間（{previewEnd}まで）</p>
          <button className="primary" onClick={leave}>制限を続ける</button><button className="secondary" disabled={ended || (!paid && !reason.trim())} onClick={() => setStep('review')}>解除する内容を確認する</button>
        </>}
        {step === 'review' && <>
          <p className="intro">今回、開くのは{recipient}だけです。</p>
          <dl><div><dt>対象</dt><dd>{recipient}</dd></div><div><dt>解除する時間</dt><dd>{duration}分間 · {previewEnd}まで</dd></div><div><dt>{paid ? '自分で決めた金額' : '利用料金'}</dt><dd>{fee}</dd></div>{!paid && <div><dt>開く理由</dt><dd className="verbatim">{reason}</dd></div>}</dl>
          <button className="primary" onClick={leave}>制限を続ける</button>
          <button className="secondary" disabled={ended} onClick={paid ? () => setStep('purchase') : grant}>{paid ? fee + 'の購入確認へ' : recipient + 'を' + duration + '分間開く'}</button>
        </>}
        {step === 'purchase' && <>
          <p className="intro">アプリ内購入の確定を試せます。実際のお支払いは発生しません。</p>
          <div className="ticket"><span>{recipient}の一時解除 · 1回分</span><strong>{fee}</strong><small>{duration}分間 · {previewEnd}まで</small></div>
          <button className="primary" onClick={() => keep('購入を取り消しました。制限を続けています。')}>購入せず、制限を続ける</button>
          <button className="secondary" disabled={ended} onClick={grant}>{fee}の模擬購入を確定する</button>
        </>}
        {step === 'result' && <>
          <p className="intro" role="status">{(grants[recipient] ?? 0) > now ? until(grants[recipient]!) + 'に、自動で制限に戻ります。' : '設定した時間が経過しました。'}</p>
          <dl><div><dt>対象アプリ</dt><dd>{recipient}</dd></div><div><dt>{paid ? '模擬購入額' : '利用料金'}</dt><dd>{fee}</dd></div>{paid && <div><dt>実際の請求</dt><dd>¥0</dd></div>}</dl>
          <button className="primary" onClick={() => { setNotice(''); setStep('home'); }}>ホームに戻る</button>
        </>}
        <dialog ref={discard}><h2>入力した理由を破棄しますか？</h2><p>制限はそのまま続きます。</p><button className="primary" onClick={() => discard.current?.close()}>入力を続ける</button><button className="secondary" onClick={() => { discard.current?.close(); keep(); }}>破棄して制限を続ける</button></dialog>
      </section>
    </div>
  </main>;
}
