import { useState, type ReactNode } from 'react';
import { Link, type Href } from 'expo-router';
import { Body, Button, Heading, Panel, useFlowTheme } from '@/components/flow/ui';
import { PeriodRing } from '@/components/home/period-ring';
import './study.css';

const scenes = {
  unlock: { path: '/', short: '解除の確認', title: '一時解除の確認', question: 'どのアプリが、いつまで開ける？', context: '22:57。夜のルールが終わる3分前に、Xを10分だけ開こうとしています。' },
  home: { path: '/home', short: 'ホーム', title: 'ホームの反映未確認', question: '制限が反映されたか分からないときは？', context: 'ルールは時間内。スクリーンタイムの許可はありますが、最新の反映を確認できていません。' },
  schedules: { path: '/schedules', short: 'スケジュール', title: 'スケジュールの全体停止', question: '設定は残っているのに、動かないのはなぜ？', context: 'ルールを2件保存し、全体を停止しています。再開に必要な許可と対象は確認済みです。' },
} as const;
type Scene = keyof typeof scenes;
function Info({ title, children }: { title: string; children: ReactNode }) { return <Panel><Heading>{title}</Heading><Body>{children}</Body></Panel>; }
function Action({ children, onClick, secondary = false }: { children: string; onClick: () => void; secondary?: boolean }) { return <Button label={children} onPress={onClick} secondary={secondary} />; }
function End({ title, children, reset }: { title: string; children: string; reset: () => void }) { return <><h1>{title}</h1><p>{children}</p><Action secondary onClick={reset}>場面の最初に戻る</Action></>; }
function Unlock({ improved }: { improved: boolean }) {
  const [stage, set] = useState('review'), [reason, write] = useState('待ち合わせ場所を確認したい');
  if (stage === 'edit') return <><h1>使う理由</h1><label htmlFor="reason">いま、何のためにXを開きますか？</label><textarea id="reason" value={reason} onChange={e=>write(e.target.value)} /><Button label="解除内容を確認する" disabled={!reason.trim()} onPress={()=>set('review')} /></>;
  if (stage === 'discard') return <><h1>入力を破棄して制限を続けますか？</h1><p>理由の保存や一時解除は行いません。</p><Action onClick={()=>set('review')}>入力を続ける</Action><Action secondary onClick={()=>{write('');set('kept')}}>破棄して制限を続ける</Action></>;
  if (stage === 'done' || stage === 'kept') return <End title={stage === 'done' ? 'Xを一時解除中' : '制限を続けています'} reset={()=>{write('待ち合わせ場所を確認したい');set('review')}}>{stage === 'done' ? '架空の反映結果です。Xの解除は23:00まで。Instagramは引き続き制限中です。' : '理由を破棄しました。夜の読書のルールを続けます。'}</End>;
  return <><h1>この内容で一時解除しますか</h1>{improved ? <>
    <section className="ticket"><div className="ticketName"><span className="appMark" aria-hidden="true">𝕏</span><div><small>一時解除するアプリ</small><h2>X</h2></div></div><hr/><small>解除の上限</small><div className="numeral">23:00 <em>まで</em></div><strong>いま確定すると最大3分</strong><p>希望は10分ですが、「夜の読書」が23:00に終了します。</p></section>
    <dl><dt>引き続き制限</dt><dd>Instagram</dd><dt>あなたの理由</dt><dd>{reason}</dd></dl>
  </> : <><Info title="このアプリだけを解除">X　ほかの対象アプリの設定は変更しません。</Info><Info title="この解除に適用するルール">夜の読書　毎日 21:00〜23:00</Info><Info title="あなたの理由">{reason}</Info><Info title="解除の時間">希望10分。23:00までが上限です。時間帯の終了に合わせて、解除の上限が早まっています。</Info></>}
    <small>再制限の予定を登録できた場合に解除します。</small><Action onClick={()=>set('discard')}>制限を続ける</Action><Action secondary onClick={()=>set('done')}>理由を保存して一時解除する</Action><Action secondary onClick={()=>set('edit')}>入力に戻る</Action>
  </>;
}
function Home({ improved }: { improved: boolean }) {
  const theme = useFlowTheme(), [step, set] = useState('home'), [checked, check] = useState(false);
  if (step === 'settings') return <><h1>設定</h1><Action secondary onClick={()=>set('check')}>スクリーンタイム</Action></>;
  if (step === 'check') return <><h1>スクリーンタイム</h1><Info title="許可と反映">{checked ? '22:57時点でITOMAの設定の反映を確認しました。' : '許可されています。制限の反映を確認できていません。'}</Info><p>保存した設定の読み直し、自動切替の準備、反映の再試行、記録の取込を行います。</p><Action onClick={()=>check(true)}>保存した設定を再確認・反映する</Action><Action secondary onClick={()=>set('home')}>ホームに戻る</Action></>;
  return <><h1>いとま</h1>{!checked && (improved ? <section className="paper"><small>スクリーンタイム</small><h2>ルールの反映を確認できていません</h2><p>「夜の読書」は設定上の時間内です。</p><Action secondary onClick={()=>set('check')}>スクリーンタイムで確認する</Action></section> : <Info title="制限の状態を確認してください">反映を確認できていません。以下の時間帯は保存した設定です。設定タブから現在の状態を確認できます。</Info>)}
    <small>{checked ? 'いま適用しているルール' : '設定上、時間内のルール'}</small><section className="rule"><h2>夜の読書</h2><small>毎日　21:00 – 23:00</small><PeriodRing theme={theme} period={{state:'current', remaining:'3分', fraction:3/120,endLabel:'23:00に終了'}} /><p>X・Instagram　{checked ? '制限中' : '反映未確認'}</p></section>
    {checked ? <Action secondary onClick={()=>check(false)}>場面の最初に戻る</Action> : <Action secondary onClick={()=>set('settings')}>設定</Action>}</>;
}
function Schedules({ improved }: { improved: boolean }) {
  const [paused, pause] = useState(true), [confirm, ask] = useState(false);
  const action = paused ? '保存したルールの再開を確認' : 'すべてのルールの停止を確認';
  if (confirm) return <><h1>{paused ? '保存したルールを再開しますか？' : 'すべてのルールを停止しますか？'}</h1><p>{paused ? '現在の曜日・時間帯の設定を確認して反映します。終了した一時解除は復活しません。' : 'すべての時間帯の制限を停止し、進行中の一時解除も終了します。保存したルールは残ります。'}</p><Action onClick={()=>ask(false)}>戻る</Action><Action secondary onClick={()=>{pause(!paused);ask(false)}}>{paused ? '確認して再開する' : 'すべて停止する'}</Action></>;
  return <><h1>スケジュール</h1>{improved ? <section className="paper"><small>ルール全体の状態</small><h2>{paused ? 'すべて停止中' : '時間帯に合わせて実行'}</h2><p>{paused ? '2件の設定は保存されています。' : '各ルールの曜日・時間帯が使われます。'}</p><Action secondary onClick={()=>ask(true)}>{action}</Action></section> : <p>各行は保存した曜日・時間・対象の設定です。現在の反映状態は「スクリーンタイム」で確認できます。</p>}
    <small>保存したルール</small>{[['夜の読書','毎日','21:00 – 23:00'],['朝の支度','平日','07:00 – 08:00']].map(([name,days,time])=><div className="saved" key={name}><div><h2>{name}</h2><small>{days}　{time}</small></div><span>{improved ? '設定は有効' : '有効'}</span></div>)}
    {!improved && <Panel><Heading>全体の操作</Heading><Body>{paused ? '全体の停止を保存しています。' : '全体の停止はすべてのルールに作用します。'}各ルールの設定は残ります。</Body><Action secondary onClick={()=>ask(true)}>{action}</Action></Panel>}</>;
}
export function Study({ scene }: { scene: Scene }) {
  const [improved, choose] = useState(true);
  const item = scenes[scene];
  return <main className="studio"><aside><div className="brand">いとま <span>画面比較</span></div><h2>{item.question}</h2><nav aria-label="比較する場面">{(Object.keys(scenes) as Scene[]).map(key=><Link key={key} href={scenes[key].path as Href} accessibilityLabel={scenes[key].title} replace className={key===scene?'selected':''}>{scenes[key].short}</Link>)}</nav><p className="context">{item.context}</p></aside>
    <section className="stage"><header><span>架空データ</span><div className="switch">{[false,true].map(flag=><button key={String(flag)} aria-pressed={improved===flag} onClick={()=>choose(flag)}>{flag?'改善案':'現行の要点'}</button>)}</div></header><article key={String(improved)}>{scene==='unlock'?<Unlock improved={improved}/>:scene==='home'?<Home improved={improved}/>:<Schedules improved={improved}/>}</article></section></main>;
}
