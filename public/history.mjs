import { STUDIES, WEEK_STARTS, DEFAULT_DATE, addDays, weekday, shortDate, fullDate, duration, summarize, monthCells, createSample, OUTCOMES, unionMinutes } from './history-data.mjs';
const $ = selector => document.querySelector(selector);
const e = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sample = createSample();
const state = { idea:'calendar', week:1, date:DEFAULT_DATE, month:10, selectedDates:{10:DEFAULT_DATE}, scenario:'normal', app:'all', outcome:'all', drafts:{}, grants:{}, unlock:{app:'',reason:''} };
const origin = Date.now();
const ruleEnd = origin + 90*60000;
let route = { view:'home' }, sheetTrigger, pendingNavigation;
const icons = {
  arrow:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
  book:'<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M14 23V7C10 4 6 4 3 5v16c4-1 7 0 11 2Zm0-16c4-3 8-3 11-2v16c-4-1-7 0-11 2"/></svg>',
  circle:'<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M21 4.8a12 12 0 1 0 6.2 6.2"/></svg>',
};
function activeData() {
  if (state.scenario === 'empty') return { days:[], events:[], notes:{} };
  if (state.scenario === 'incomplete') return { days:sample.days.filter(d=>d.date!=='2026-10-29'), events:[...sample.events,{id:'unknown',date:'2026-10-30',start:1300,end:null,app:'X',outcome:'unknown',reason:null}], notes:sample.notes };
  return sample;
}
const weekStart = () => WEEK_STARTS[state.week];
const weekEnd = () => addDays(weekStart(),6);
const inWeek = date => date >= weekStart() && date <= weekEnd();
const stats = () => { const d=activeData();return summarize(d.days,d.events,weekStart(),weekEnd()); };
const weekLabel = () => `${shortDate(weekStart())} — ${shortDate(weekEnd())}`;
const time = value => `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
function back(label = '振り返りに戻る') { return `<a class="back" href="#history/${state.idea}">‹ ${e(label)}</a>`; }
function heading(kicker, title, subtitle='') { return `<p class="small-label">${e(kicker)}</p><h2 class="page-title" tabindex="-1">${e(title)}</h2>${subtitle?`<p class="page-subtitle">${e(subtitle)}</p>`:''}`; }
function weekSwitch() { return `<div class="week-switch"><button class="round" data-week="-1" aria-label="前の週" ${state.week===0?'disabled':''}>‹</button><p>${weekLabel()}</p><button class="round" data-week="1" aria-label="次の週" ${state.week===1?'disabled':''}>›</button></div>`; }
function metrics() { const s=stats();return `<div class="metrics"><div><span class="metric-label">設定した時間${state.scenario==='incomplete'?'（一部）':''}</span><strong class="metric-value" data-metric="planned">${duration(s.planned)}</strong></div><div><span class="metric-label">一時解除の記録</span><strong class="metric-value" data-metric="releases">${s.releases}<small>回</small></strong></div></div>`; }
function definitions() { return '<div class="definition"><button data-action="definitions">この数字について</button></div>'; }
function banner() { return state.scenario==='incomplete'?'<div class="banner" role="status"><strong>一部の記録を確認できません</strong><p>表示できる記録だけを集計しています。不明な時間を「0」や達成として扱いません。</p><button class="text-button" data-action="retry">もう一度読み込む</button></div>':''; }
function empty(title='まだ、振り返る記録がありません',text='これからの記録を、ここで振り返れます。記録がないことに、良し悪しはありません。') { return `<div class="empty">${icons.circle}<h3>${e(title)}</h3><p>${e(text)}</p><a class="secondary" href="#home">ホームに戻る</a></div>`; }
function historyGuard() {
  if(state.scenario==='error') return heading('振り返り','記録を読み込めませんでした')+'<div class="empty"><p>履歴を開けませんでした。<br>制限の設定や動作には影響しません。</p><button class="secondary wide" data-action="retry">もう一度読み込む</button><a class="back" href="#home">ホームに戻る</a></div>';
  if(state.scenario==='empty') return heading('振り返り',STUDIES.find(s=>s.id===state.idea).title)+empty();
  return '';
}
function calendar() {
  const d=activeData();
  const cells=monthCells(2026,state.month);
  return heading('日付で、振り返る','余白のカレンダー',`${weekLabel()}のまとめ`) + metrics()+banner()+`<div class="month-switch"><button class="round" data-month="-1" aria-label="前の月" ${state.month===9?'disabled':''}>‹</button><p>2026年 ${state.month}月</p><button class="round" data-month="1" aria-label="次の月" ${state.month===11?'disabled':''}>›</button></div><div class="calendar" role="group" aria-label="2026年${state.month}月の日付を選択">${['月','火','水','木','金','土','日'].map(w=>`<span class="weekday">${w}</span>`).join('')}${cells.map(date=>{
    if(!date)return '<span></span>';
    const day=d.days.find(x=>x.date===date), planned=day?unionMinutes(day.plans.map(p=>[p.start,p.end])):0;
    const missing=state.scenario==='incomplete'&&date==='2026-10-29';
    return `<button class="calendar-day" data-date="${date}" aria-pressed="${date===state.date}" aria-label="${fullDate(date)}、${missing?'記録不明':day?(planned?`設定${duration(planned)}`:'設定なし'):'記録なし'}${d.notes[date]?'、メモあり':''}">${Number(date.slice(-2))}${planned?'<span class="day-mark" aria-hidden="true"></span>':''}${d.notes[date]?'<span class="note-mark" aria-hidden="true">✎</span>':''}${missing?'<span class="day-mark" aria-hidden="true">?</span>':''}</button>`;
  }).join('')}</div><div class="calendar-legend"><span><i></i>時間の設定あり</span><span>✎ 本人のメモ</span></div>${dayCard(state.date)}${definitions()}`;
}
function dayCard(date) {
  const d=activeData(), day=d.days.find(x=>x.date===date), events=d.events.filter(x=>x.date===date);
  const planned=day?unionMinutes(day.plans.map(p=>[p.start,p.end])):null;
  return `<section class="day-card" aria-label="選択した日の記録"><div class="day-head"><strong>${fullDate(date)}</strong><span class="small-label">${day?(planned?duration(planned):'設定なし'):'記録なし'}</span></div><p>${events.length?`${events.length}件の操作の記録`:'操作の記録はありません'}${state.scenario==='incomplete'&&date==='2026-10-29'?' · 一部不明':''}</p>${d.notes[date]?`<blockquote>「${e(d.notes[date])}」</blockquote><p class="caption">本人のメモ</p>`:''}<a class="link-row" href="#day/${date}"><span>この日の記録を見る</span>${icons.arrow}</a></section>`;
}
function accumulation() {
  const s=stats(), d=activeData(), previous=summarize(d.days,d.events,WEEK_STARTS[0],addDays(WEEK_STARTS[0],6));
  return heading('決めた時間を、積み重ねる','時間の積み上げ')+weekSwitch()+banner()+`<p class="small-label">この週に設定した時間${state.scenario==='incomplete'?'（分かる範囲）':''}</p><p class="headline-stat" data-metric="planned">${duration(s.planned)}</p><p class="comparison">${state.week===1&&state.scenario!=='incomplete'?`前の週は${duration(previous.planned)}。この週との差は${duration(Math.abs(s.planned-previous.planned))}。`:'量を評価せず、自分のリズムを眺めます。'}</p><div class="time-chart" role="group" aria-label="日ごとの設定時間。各日を押すと詳細">${Array.from({length:7},(_,i)=>{
    const date=addDays(weekStart(),i), day=d.days.find(x=>x.date===date), minutes=day?unionMinutes(day.plans.map(p=>[p.start,p.end])):null;
    return `<button class="day-bar" data-day="${date}" aria-label="${fullDate(date)}、${minutes===null?'記録なし':minutes?duration(minutes):'設定なし'}、詳細"><span>${Number(date.slice(-2))} ${weekday(date)}</span><span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${minutes===null?0:Math.min(minutes/120*100,100)}%"></span></span><span class="bar-value">${minutes===null?'不明':minutes?`${minutes}分`:'設定なし'}</span></button>`;
  }).join('')}<div class="time-axis" aria-hidden="true"><span>0</span><span>60</span><span>120分</span></div></div><p class="caption">棒を選ぶと、その日の記録を開きます。</p><div class="subtle-card"><h3>必要なときは、選び直す</h3><p>一時解除の記録 ${s.releases}回 · 合計${duration(s.releaseMinutes)}<br>対象アプリごとの解除期間を合算しています。</p><a class="link-row" href="#history/timeline"><span>解除の記録を見る</span>${icons.arrow}</a></div><p class="caption timeline-note">設定した時間は、実際の集中時間ではありません。一時解除しても、設定した時間の合計からは差し引きません。</p>${definitions()}`;
}
function eventButton(event) { return `<button class="event" data-event="${event.id}"><span class="event-time">${time(event.start)}</span><span><span class="event-name">${e(event.app)}${event.outcome==='cancelled'?'の解除を取り消し':event.outcome==='failed'?'の解除を試行':'の一時解除'}</span><span class="event-result">${e(OUTCOMES[event.outcome])}${event.end!==null?` · ${duration(event.end-event.start)}`:''}</span></span><span class="event-arrow" aria-hidden="true">›</span></button>`; }
function timeline() {
  const events=activeData().events.filter(x=>inWeek(x.date)&&(state.app==='all'||x.app===state.app)&&(state.outcome==='all'||x.outcome===state.outcome)).sort((a,b)=>b.date.localeCompare(a.date)||b.start-a.start);
  const dates=[...new Set(events.map(x=>x.date))];
  return heading('そのときの意思を、たどる','選択のタイムライン')+weekSwitch()+banner()+`<div class="chips" role="group" aria-label="アプリで絞り込み">${[['all','すべて'],['X','X'],['YouTube','YouTube']].map(([id,name])=>`<button class="chip" data-app-filter="${id}" aria-pressed="${state.app===id}">${name}</button>`).join('')}</div><label class="filter-select">操作の結果<select id="outcome-filter"><option value="all">すべての結果</option>${Object.entries(OUTCOMES).map(([id,label])=>`<option value="${id}" ${state.outcome===id?'selected':''}>${label}</option>`).join('')}</select></label>${dates.length?dates.map(date=>`<section class="timeline-group"><h3 class="date-heading">${fullDate(date)}</h3>${events.filter(x=>x.date===date).map(eventButton).join('')}</section>`).join(''):empty('この条件の記録はありません','アプリや操作の結果を変えると、別の記録を確認できます。')}<p class="caption timeline-note">記録を開くと、入力した理由と操作結果を確認できます。取消や失敗を「解除した回数」に含めません。</p>${definitions()}`;
}
function noteCard(date, text) { return `<article class="note-card"><p class="note-date">${fullDate(date)}</p><blockquote>${e(text)}</blockquote><div class="note-footer"><span>自分で残したひと言</span><a href="#note/${date}">書き直す</a></div></article>`; }
function journal() {
  const entries=Object.entries(activeData().notes).filter(([date])=>inWeek(date)).sort(([a],[b])=>b.localeCompare(a));
  return heading('その余白に、何が残った？','余白のノート')+weekSwitch()+banner()+`<div class="journal-intro"><p class="page-subtitle">何ができたかは、数字だけでは分からない。<br>自分のために、ひと言だけ。</p></div><button class="journal-add" data-action="add-note"><span aria-hidden="true">＋</span><span>この週に、ひと言残す</span></button><div class="journal-stack">${entries.length?entries.map(([date,text])=>noteCard(date,text)).join(''):'<p class="caption">この週には、まだメモがありません。書きたいときだけで大丈夫です。</p>'}</div><p class="caption timeline-note">メモは本人が書いた記録です。利用履歴や解除理由から、活動の内容を自動で推定しません。</p>`;
}
function letter() {
  const s=stats(), entries=Object.entries(activeData().notes).filter(([date])=>inWeek(date)).sort(([a],[b])=>b.localeCompare(a));
  return heading('ひと呼吸で、一週間を','週のおたより')+weekSwitch()+banner()+`<article class="letter"><div class="letter-masthead"><span>ITOMA LETTER</span><span>${state.scenario==='incomplete'?'一部の記録':`2026 · ${state.week===1?'44':'43'}`}</span></div><h3 class="letter-title">${s.days}日分の、<br>自分との約束。</h3><p>自分のために時間を決めた日が、<br>この週には${s.days}日ありました。</p><p class="letter-number" data-metric="planned">${duration(s.planned)}</p><p class="letter-caption">設定した時間の合計${state.scenario==='incomplete'?'（表示できる記録のみ）':''}</p><div class="letter-separator"></div><p>一時解除の記録は${s.releases}回。<br>使うことを選び直すのも、<br>自分の時間の決め方です。</p><a class="link-row" href="#history/timeline"><span>そのときの選択を見る</span>${icons.arrow}</a>${entries.length?`<div class="letter-separator"></div><p class="letter-caption">あなたが残したひと言 · ${shortDate(entries[0][0])}</p><blockquote>「${e(entries[0][1])}」</blockquote>`:''}<div class="letter-separator"></div><p>どんな時間になったか、<br>知っているのはあなた。</p><a class="link-row" href="#history/journal"><span>余白のノートを開く</span>${icons.arrow}</a><p class="sign">いとま</p></article>${definitions()}`;
}
function dayDetails() {
  const date=route.id, d=activeData(), day=d.days.find(x=>x.date===date), events=d.events.filter(x=>x.date===date).sort((a,b)=>a.start-b.start);
  return back()+heading('一日の記録',fullDate(date))+banner()+`<h3 class="section-heading">設定した時間</h3>${day?day.plans.length?day.plans.map(p=>`<div class="rule-line"><span>${e(p.name)}</span><span>${time(p.start)} — ${time(p.end)}</span></div>`).join(''):'<p class="caption">この日の時間設定はありません。</p>':'<p class="caption">この日の設定記録はありません。制限の有無は判断できません。</p>'}<h3 class="section-heading">操作の記録</h3>${events.length?events.map(eventButton).join(''):'<p class="caption">表示できる操作の記録はありません。</p>'}<h3 class="section-heading">本人のメモ</h3>${d.notes[date]?noteCard(date,d.notes[date]):'<p class="caption">まだメモはありません。</p>'}<a class="link-row" href="#note/${date}"><span>${d.notes[date]?'メモを書き直す':'この日に、ひと言残す'}</span>${icons.arrow}</a>${definitions()}`;
}
function recordDetails() {
  const event=activeData().events.find(x=>x.id===route.id);
  if(!event)return back()+heading('操作の記録','この記録は表示できません');
  return `<a class="back" href="${e(state.recordBack||`#history/${state.idea}`)}">‹ 記録に戻る</a>`+heading(fullDate(event.date),`${event.app}の操作記録`)+`<div class="record-summary"><dl><dt>操作日時</dt><dd>${time(event.start)}</dd><dt>結果</dt><dd>${e(OUTCOMES[event.outcome])}</dd><dt>解除の期間</dt><dd>${event.end!==null?`${time(event.start)} — ${time(event.end)}<br>${duration(event.end-event.start)}`:event.outcome==='cancelled'?'確定前に取り消しました':event.outcome==='failed'?'解除できませんでした':'確認できません'}</dd></dl></div><h3 class="section-heading">そのときの理由</h3><p class="reason-text">${e(event.reason||'保存された理由はありません。')}</p><p class="caption timeline-note">解除の期間は、アプリを実際に使った時間ではありません。表示は操作の記録に基づきます。</p>`;
}
function getDraft(date) { return state.drafts[date]??sample.notes[date]??''; }
function noteEditor() {
  const date=route.id, value=getDraft(date);
  return back()+heading('本人のメモ','この日の余白に、ひと言。',`${fullDate(date)} · 書きたいときだけで大丈夫です。`)+`<form class="note-form" id="note-form"><label for="note">どんな時間になりましたか？</label><textarea id="note" maxlength="200" aria-describedby="note-help">${e(value)}</textarea><div class="form-footer"><p class="caption" id="note-help">このデモでは再読込で消えます。</p><span class="caption" id="note-count">${value.length}/200</span></div><div class="actions"><button class="primary wide" type="submit" id="save-note" ${value.trim()?'':'disabled'}>ひと言を残す</button><button class="secondary wide" type="button" data-action="cancel-note">戻る</button></div></form>`;
}
function home() {
  const remaining=Math.max(0,Math.ceil((ruleEnd-Date.now())/60000));
  return `<div class="home-header"><div><p class="small-label">11月7日 土曜日</p><h2 class="home-heading" tabindex="-1">夜の時間</h2></div>${icons.circle}</div><div class="ring" role="img" aria-label="夜の時間、残り${duration(remaining)}、23時終了"><svg viewBox="0 0 240 240" aria-hidden="true"><circle class="track" cx="120" cy="120" r="112"/><circle class="progress" id="rule-progress" cx="120" cy="120" r="112" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${100-remaining/120*100}"/></svg><div class="ring-copy"><p>制限終了まで</p><strong id="rule-remaining">${duration(remaining)}</strong><p class="end">23:00に終了</p></div></div><div class="purpose">${icons.book}<div><span class="small-label">大切にしたいこと</span><p>寝る前に、本を読む余白を。</p></div></div><div class="app-list">${['X','YouTube'].map(app=>`<div class="app-row"><span class="app-icon" aria-hidden="true">${app==='X'?'X':'▶'}</span><span>${app}</span>${state.grants[app]?`<button class="restore" data-restore="${app}">制限に戻す</button><span class="app-state" data-grant="${app}"></span>`:'<span class="app-state">制限中（デモ）</span>'}</div>`).join('')}</div><div class="actions"><a class="primary" href="#unlock">一時解除する</a></div><a class="link-row home-history" href="#history/${state.idea}"><span>これまでの時間を振り返る</span>${icons.arrow}</a><p class="caption">時間の記録と、自分で残したひと言を。</p>`;
}
function unlock() {
  return `<a class="back" href="#home">‹ ホームに戻る</a>`+heading('一時解除','いま、何のために開きますか？','必要なアプリをひとつ選び、自分の言葉で。')+`<fieldset><legend>一時解除するアプリ</legend>${['X','YouTube'].map(app=>`<label class="choice"><span class="app-icon" aria-hidden="true">${app==='X'?'X':'▶'}</span><span>${app}</span><input type="radio" name="unlock-app" value="${app}" ${state.unlock.app===app?'checked':''} ${state.grants[app]?'disabled':''} aria-label="${app}${state.grants[app]?'、一時解除中':''}"></label>`).join('')}</fieldset><div class="note-form"><label for="unlock-reason">いま使う理由</label><textarea id="unlock-reason" maxlength="200" aria-describedby="unlock-help">${e(state.unlock.reason)}</textarea><p class="caption" id="unlock-help">自分の言葉で、ひと言から。</p></div><div class="actions"><button class="primary" data-action="cancel-unlock">制限を続ける</button><button class="secondary" data-action="review-unlock" ${validUnlock()?'':'disabled'}>解除に進む</button></div>`;
}
const validUnlock = () => Boolean(state.unlock.app&&state.unlock.reason.trim()&&!state.grants[state.unlock.app]&&Date.now()<ruleEnd);
function reviewUnlock() { return `<a class="back" href="#unlock">‹ アプリと理由を変更する</a>`+heading('内容の確認',`${state.unlock.app||'アプリ'}を、5分だけ。`)+`<div class="record-summary"><dl><dt>対象</dt><dd>${e(state.unlock.app)}</dd><dt>期間</dt><dd>確定してから最大5分<br>23:00を越えません</dd><dt>理由</dt><dd>${e(state.unlock.reason.trim())}</dd></dl></div><p class="caption timeline-note">${state.unlock.app==='X'?'YouTube':'X'}の状態と、夜のルールは変更しません。</p><div class="actions"><button class="primary" data-action="cancel-unlock">制限を続ける</button><button class="secondary" data-action="confirm-unlock" ${validUnlock()?'':'disabled'}>このアプリを一時解除する</button></div>`; }
function currentHash() { return location.hash || '#home'; }
function parseRoute() {
  const [view,id]=currentHash().slice(1).split('/');
  if(view==='history') { if(STUDIES.some(s=>s.id===id))state.idea=id;return {view:'history'}; }
  if(['day','note'].includes(view)&&/^2026-(09|10|11)-\d{2}$/.test(id??'')&&Number(id.slice(-2))>=1&&Number(id.slice(-2))<=new Date(Date.UTC(2026,Number(id.slice(5,7)),0)).getUTCDate())return {view,id};
  if(view==='record'&&/^[a-z0-9]+$/.test(id??''))return {view,id};
  if(view==='unlock')return {view};
  if(view==='review'&&validUnlock())return {view};
  return {view:'home'};
}
function render({focus=false,resetScroll=false}={}) {
  route=parseRoute();
  const guard=['history','day','record'].includes(route.view)?historyGuard():'';
  $('#screen').innerHTML=guard||({home,history:()=>({calendar,time:accumulation,timeline,journal,letter}[state.idea])(),day:dayDetails,record:recordDetails,note:noteEditor,unlock,review:reviewUnlock}[route.view])();
  updateControls();tick();
  if(resetScroll)$('#app-scroll').scrollTop=0;
  if(focus)$('#screen h2')?.focus({preventScroll:true});
}
function updateControls() {
  const idea=STUDIES.find(x=>x.id===state.idea);
  $('#ideas').innerHTML=STUDIES.map(x=>`<button class="idea" data-idea="${x.id}" aria-pressed="${x.id===state.idea}"><span class="idea-number">${x.number}</span><span class="idea-title">${innerWidth<=720?x.short:x.title}</span><span class="idea-selected" aria-hidden="true">${x.id===state.idea?'↗':''}</span></button>`).join('');
  $('#idea-question').textContent=idea.question;$('#idea-description').textContent=idea.description;$('#idea-strength').textContent=idea.strength;$('#idea-tradeoff').textContent=idea.tradeoff;
  $('#home-tab').setAttribute('aria-current',route.view==='home'?'page':'false');
  $('#history-tab').setAttribute('aria-current',['history','day','record','note'].includes(route.view)?'page':'false');
  $('#history-tab').href=`#history/${state.idea}`;
}
function dirty() {
  if(route.view==='note')return getDraft(route.id)!==(sample.notes[route.id]??'');
  if(['unlock','review'].includes(route.view))return Boolean(state.unlock.app||state.unlock.reason);
  return false;
}
function closeSheet() { $('#sheet').close(); }
function openSheet(title, body, closeLabel='閉じる') {
  sheetTrigger=document.activeElement;
  $('#sheet-body').innerHTML=`<h2 id="sheet-title">${title}</h2>${body}`;$('#sheet-close').textContent=closeLabel;$('#sheet').showModal();
}
function go(hash, force=false) {
  if(!force&&dirty()) {
    pendingNavigation=hash;
    openSheet('入力を破棄して戻りますか？','<p>入力した内容は、まだ保存・確定していません。</p><button class="primary wide" data-action="discard">破棄して移動する</button>','入力を続ける');return;
  }
  if(location.hash===hash)render({focus:true,resetScroll:true});else location.hash=hash;
}
window.addEventListener('hashchange',()=>render({focus:true,resetScroll:true}));
window.addEventListener('resize',updateControls);
window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
$('#sheet-close').addEventListener('click',closeSheet);
$('#sheet').addEventListener('close',()=>{pendingNavigation=null;sheetTrigger?.isConnected&&sheetTrigger.focus();});
$('#try-home').addEventListener('click',()=>go('#home'));
$('#appearance').addEventListener('change',event=>{document.documentElement.dataset.appearance=event.target.value;});
$('#scenario').addEventListener('change',event=>{state.scenario=event.target.value;render();});
document.addEventListener('click',event=>{
  const anchor=event.target.closest('a[href^="#"]');
  if(anchor){event.preventDefault();go(anchor.getAttribute('href'),route.view==='review'&&anchor.getAttribute('href')==='#unlock');return;}
  const button=event.target.closest('button');if(!button||button.disabled)return;
  if(button.dataset.idea){go(`#history/${button.dataset.idea}`);return;}
  if(button.dataset.week){state.week+=Number(button.dataset.week);render({focus:true,resetScroll:true});return;}
  if(button.dataset.month){state.selectedDates[state.month]=state.date;state.month+=Number(button.dataset.month);state.date=state.selectedDates[state.month]||`2026-${String(state.month).padStart(2,'0')}-01`;render();$('#screen h2')?.focus({preventScroll:true});return;}
  if(button.dataset.date){state.date=button.dataset.date;const scroll=$('#app-scroll').scrollTop;render();$('#app-scroll').scrollTop=scroll;$(`[data-date="${state.date}"]`)?.focus({preventScroll:true});$('.day-card')?.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});return;}
  if(button.dataset.day){go(`#day/${button.dataset.day}`);return;}
  if(button.dataset.event){state.recordBack=currentHash();go(`#record/${button.dataset.event}`);return;}
  if(button.dataset.appFilter){state.app=button.dataset.appFilter;render();$(`[data-app-filter="${state.app}"]`)?.focus({preventScroll:true});return;}
  if(button.dataset.restore){delete state.grants[button.dataset.restore];render();announce('選択したアプリの一時解除を終了しました（デモ）。');return;}
  switch(button.dataset.action){
    case 'retry':state.scenario='normal';$('#scenario').value='normal';render({focus:true});break;
    case 'definitions':openSheet('この数字について','<dl><dt>設定した時間</dt><dd>その期間の時間設定を集計しています。同じ日の重なる時間は一度だけ数え、アプリ数では増やしません。実際の集中時間・スマホを使わなかった時間ではありません。</dd><dt>一時解除の記録</dt><dd>終了を記録できた解除の件数です。失敗・確定前の取消・結果不明は含みません。</dd><dt>解除期間の合計</dt><dd>対象アプリごとの、記録上の解除期間を足しています。同時に解除した期間はアプリごとに数えます。実利用時間ではありません。</dd><dt>本人のメモ</dt><dd>本人が書いた振り返りです。解除理由から自動で活動を分類・採点しません。</dd></dl>');break;
    case 'add-note':go(`#note/${state.week===1?'2026-11-01':'2026-10-25'}`);break;
    case 'cancel-note':go(`#history/${state.idea}`);break;
    case 'cancel-unlock':go('#home');break;
    case 'review-unlock':if(validUnlock())go('#review',true);break;
    case 'confirm-unlock':if(validUnlock()){state.grants[state.unlock.app]={until:Math.min(Date.now()+300000,ruleEnd)};state.unlock={app:'',reason:''};go('#home',true);announce('選択したアプリを一時解除しました（デモ）。');}break;
    case 'discard':{const destination=pendingNavigation;if(route.view==='note')delete state.drafts[route.id];else state.unlock={app:'',reason:''};closeSheet();if(destination)go(destination,true);break;}
  }
});
document.addEventListener('change',event=>{
  if(event.target.id==='outcome-filter'){state.outcome=event.target.value;render();$('#outcome-filter')?.focus({preventScroll:true});}
  if(event.target.name==='unlock-app'){state.unlock.app=event.target.value;$('#screen [data-action="review-unlock"]').disabled=!validUnlock();}
});
document.addEventListener('input',event=>{
  if(event.target.id==='note'){state.drafts[route.id]=event.target.value;$('#save-note').disabled=!event.target.value.trim();$('#note-count').textContent=`${event.target.value.length}/200`;}
  if(event.target.id==='unlock-reason'){state.unlock.reason=event.target.value;$('#screen [data-action="review-unlock"]').disabled=!validUnlock();}
});
document.addEventListener('submit',event=>{
  if(event.target.id!=='note-form')return;event.preventDefault();const text=getDraft(route.id).trim();if(!text)return;
  sample.notes[route.id]=text;delete state.drafts[route.id];state.scenario='normal';$('#scenario').value='normal';go('#history/journal',true);announce('ひと言を残しました。このデモでは再読込で消えます。');
});
function announce(message){$('#announcement').textContent=message;}
function tick(){
  const now=Date.now();let expired=false;
  for(const [app,grant] of Object.entries(state.grants)){if(now>=grant.until){delete state.grants[app];expired=true;}else{const label=$(`[data-grant="${app}"]`);if(label)label.textContent=`残り${Math.ceil((grant.until-now)/60000)}分`;}}
  if(expired&&route.view==='home'){render();return;}
  const remaining=$('#rule-remaining');if(remaining){const minutes=Math.max(0,Math.ceil((ruleEnd-now)/60000));remaining.textContent=duration(minutes);$('#rule-progress').setAttribute('stroke-dashoffset',String(100-Math.max(0,Math.min(1,(ruleEnd-now)/(120*60000)))*100));$('.ring').setAttribute('aria-label',`夜の時間、制限終了まで${duration(minutes)}、23時に終了`);}
}
let timer;
function syncTimer(){clearInterval(timer);if(document.hidden)return;tick();timer=setInterval(tick,1000);}
document.addEventListener('visibilitychange',syncTimer);
render();syncTimer();
