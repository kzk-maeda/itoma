const $ = selector => document.querySelector(selector);
const apps = [{id:'x',name:'X',icon:'𝕏'}, {id:'youtube',name:'YouTube',icon:'▶'}, {id:'instagram',name:'Instagram',icon:'◎'}];
const state = { screen:'home', scenario:'applied', outcome:'ok', now:1290, target:'', reason:'', minutes:'5', touched:{}, attempted:false, records:[], grants:[], result:null, recordView:'operations', reviewUntil:null };
let pendingNavigation, previousFocus;
const esc = value => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = value => `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;
const duration = value => value >= 60 ? `${Math.floor(value/60)}時間${value%60 ? `${value%60}分` : ''}` : `${value}分`;
const app = id => apps.find(item=>item.id===id);
const activeGrants = () => state.grants.filter(g=>g.until>state.now);
const inPeriod = () => state.now<1380;
const canUnlock = () => state.scenario==='applied' && inPeriod();
const dirty = () => !!state.target || !!state.reason || state.minutes!=='5';
const isFlow = screen => ['choose','intent','review'].includes(screen);
const button = (label,action,secondary=false,extra='')=>`<button type="button" data-action="${action}" class="${secondary?'secondary':''}" ${extra}>${label}</button>`;
const progress = current => `<ol class="progress" aria-label="一時解除の手順">${['アプリ','理由と時間','確認'].map((name,i)=>`<li ${i===current?'aria-current="step"':''}>${i+1} ${name}</li>`).join('')}</ol>`;
const identity = item => `<span class="app-name"><span class="app-icon" aria-hidden="true">${item.icon}</span><span>${item.name}</span></span>`;
function ring() {
 const remaining=Math.max(0,1380-state.now), fraction=remaining/120;
 const copy=`<span class="caption">この時間帯の終了まで</span><strong>${duration(remaining)}</strong><span class="caption">23:00まで · 対象3アプリ</span>`;
 return `<div class="ring"><svg viewBox="0 0 224 224" aria-hidden="true"><circle cx="112" cy="112" r="104"/><circle cx="112" cy="112" r="104" stroke-dasharray="${653.45*fraction} 653.45"/></svg><div class="ring-copy">${copy}</div></div><div class="ring-copy-fallback">${copy}</div>`;
}
function home() {
 const grants=activeGrants(), unknown=state.scenario==='unknown', paused=state.scenario==='paused';
 const status=unknown?'制限の反映を確認できません':paused?'全体の停止を保存済み':!inPeriod()?'設定した時間帯が終了しました':grants.length?`${grants.length}アプリの解除状況があります`:'制限設定の反映を確認済み';
 return `<div class="state ${unknown?'attention':paused?'paused':''}">${status}</div>
 ${unknown?`<div class="status-card"><h1>いまの状態を確認しましょう</h1><p>時間帯は保存されていますが、制限の反映は未確認です。</p>${button('反映をもう一度確認する','recover')}<p class="caption">このデモでは確認結果のサンプルを表示します。</p></div>`:paused?`<div class="status-card"><h1>ルールを停止しています</h1><p>保存した時間帯と対象を確認してから、ご自身で再開できます。</p>${button('設定を確認して再開する','settings')}</div>`:''}
 <section class="period stack"><div><p class="eyebrow">あなたが決めた時間</p><h1 ${unknown||paused?'class="caption"':''}>夜の余白</h1></div>${ring()}</section>
 ${unknown||paused?'<p class="caption">上の残り時間は保存した予定です。現在の制限を示すものではありません。</p>':''}
 <div class="actions">${canUnlock()&&apps.some(item=>!grants.some(g=>g.target===item.id))?button('一時解除する','choose'):''}${grants.length?button('進行中の解除を見る','grants',true):''}</div>
 <div class="purpose"><span class="caption">この時間にしたいこと</span><p>本を読んで、ゆっくり過ごす。</p></div>
 <section><h2>対象のアプリ</h2>${apps.map(item=>{const grant=grants.find(g=>g.target===item.id);return `<div class="row">${identity(item)}<span class="caption">${grant?grant.status==='uncertain'?'解除の反映は未確認':`一時解除 · ${time(grant.until)}まで`:unknown?'反映は未確認':paused?'停止を保存済み':inPeriod()?'制限設定を反映済み':'時間帯の対象外'}</span></div>`;}).join('')}</section>
 <details class="details"><summary>設定と反映の詳細</summary><p>平日 21:00〜23:00 · X / YouTube / Instagram。確認した設定の状態を表示しています。ほかの制限や、その後も反映が続いていることを保証するものではありません。</p><p>このデモは架空の状態です。実際のScreen Time制限や期限後の切替は行いません。</p></details>`;
}
function choose() {
 return `${progress(0)}<div><h1>どのアプリを使いますか？</h1><p class="muted">必要なアプリだけを、一時的に。</p></div><div class="stack">${apps.map(item=>{const grant=activeGrants().find(g=>g.target===item.id);return `<button type="button" class="select-app" data-target="${item.id}" aria-pressed="${state.target===item.id}" ${grant?'disabled':''}>${identity(item)}<span class="selected-mark">${grant?'解除要求あり':state.target===item.id?'✓ 選択中':'選ぶ'}</span></button>`;}).join('')}</div><p class="caption">ほかのアプリの設定は変わりません。</p><div class="actions">${button('制限を続ける','cancel')}${button('理由と時間へ','intent',true,`${state.target?'':'disabled'}`)}</div>`;
}
function intent() {
 return `${progress(1)}${!canUnlock()?'<div class="inline-status"><p>制限の状態が変わりました。ホームで最新の状態を確認してください。入力は残っています。</p></div>':''}<div><h1>${esc(app(state.target).name)}を、何のために？</h1><p class="muted">自分の言葉で、今の目的を。</p></div>
 <label class="field" for="reason">いま使う理由<textarea id="reason" rows="3" aria-describedby="reason-hint reason-error">${esc(state.reason)}</textarea></label><p id="reason-hint" class="caption">内容の採点はしません。確定するまでは記録に保存しません。</p><p id="reason-error" class="error" hidden></p>
 <label class="field" for="minutes">解除する時間（1〜30分）<input id="minutes" type="text" inputmode="numeric" value="${esc(state.minutes)}" aria-describedby="minutes-hint minutes-error"></label><p id="minutes-hint" class="caption">23:00までが上限です。確定前に実際の時間を確認できます。</p><p id="minutes-error" class="error" hidden></p>
 <div class="actions">${button('制限を続ける','cancel')}${button('解除内容を確認する','review',true)}${button('アプリを選び直す','choose',true)}</div>`;
}
function review() {
 const until=state.reviewUntil??Math.min(1380,state.now+Number(state.minutes));
 return `${progress(2)}${!canUnlock()?'<div class="inline-status"><p>条件が変わったため、この内容では解除できません。入力を保ったままホームの状態を確認できます。</p></div>':''}<h1>この内容で、一時解除しますか？</h1><dl class="review"><div><dt>このアプリだけ</dt><dd>${esc(app(state.target).name)}</dd></div><div><dt>解除できる時間</dt><dd>${duration(Math.max(0,until-state.now))} · ${time(until)}まで${until<=state.now?'<p>確認した期限に達しました。理由と時間の画面から確認し直してください。</p>':''}${until-state.now<Number(state.minutes)?'<p class="caption">時間帯の終了に合わせて短くなります。</p>':''}</dd></div><div><dt>あなたの理由</dt><dd>${esc(state.reason)}</dd></div><div><dt>続ける制限</dt><dd>${apps.filter(item=>item.id!==state.target&&!activeGrants().some(g=>g.target===item.id)).map(item=>item.name).join('・')||'ほかに制限中の対象はありません'}<p class="caption">ほかの進行中の解除は変更しません。</p></dd></div></dl><p class="caption">「夜の余白」のルールに沿って、期限後の再制限の予定を登録してから解除を進めます。</p><div class="actions">${button('制限を続ける','cancel')}${button('理由を保存して一時解除する','submit',true,canUnlock()&&until>state.now?'':'disabled')}${button('理由と時間を編集する','intent',true)}</div>`;
}
function result() {
 const r=state.result;
 return `<span class="tag">デモの操作結果</span><h1>${r.status==='ok'?'一時解除の反映を確認しました':r.status==='failed'?'一時解除しませんでした':'解除の反映を確認できません'}</h1><div class="status-card"><h2>${esc(app(r.target).name)}</h2><p>${r.status==='failed'?'再制限の予定を登録できなかったため、解除を行っていません。理由は「保存のみ」の記録として残っています。':`${time(r.until)}までの要求です。${r.status==='uncertain'?'解除済みとは扱いません。進行中の解除から状態を確認できます。':'ほかのアプリの設定は変えていません。'}`}</p></div><p class="caption">実際のOS制限は変わりません。</p><div class="actions">${button('ホームへ戻る','home')}${r.status!=='failed'?button('解除の状況を見る','grants',true):''}${button('操作の記録を見る','records',true)}</div>`;
}
function grants() {
 return `<h1>進行中の解除</h1><p class="muted">アプリごとの期限と反映状況です。</p>${activeGrants().map(g=>`<div class="status-card"><h2>${esc(app(g.target).name)}</h2><p>${time(g.until)}まで · 残り${duration(g.until-state.now)}</p><p>${g.status==='uncertain'?'解除の反映は未確認です。':'解除設定の反映を確認済みです。'}</p>${g.status==='uncertain'?button('反映結果のサンプルを確認','check-grant',true,`data-id="${g.id}"`):''}${button('このアプリの解除を終了する','end-grant',true,`data-id="${g.id}"`)}</div>`).join('')||'<div class="status-card"><h2>進行中の解除はありません</h2><p>解除があれば、この画面に表示します。</p></div>'}<p class="caption">デモ時計は画面上部の「状態を試す」から進められます。</p>${button('ホームへ戻る','home')}`;
}
function records() {
 const sample=[{at:1260,title:'「夜の余白」の時間帯が開始',detail:'保存した設定の開始時刻です。制限を続けた時間の測定ではありません。'},{at:1255,title:'ルールの設定を保存',detail:'平日21:00〜23:00 · 3アプリ'}];
 return `<div><p class="eyebrow">そのときの選択を、見直す</p><h1>記録</h1></div><div class="segments" aria-label="記録の表示"><button type="button" data-action="operations" aria-pressed="${state.recordView==='operations'}">操作の記録</button><button type="button" data-action="totals" aria-pressed="${state.recordView==='totals'}">時間の集計</button></div>
 ${state.recordView==='totals'?`<section class="status-card"><span class="tag">準備中</span><h2>信頼できる時間を届けるために</h2><p>制限を続けた時間の累計・週次・月次は、まだ集計していません。</p><p class="caption">操作の回数から時間や集中の成果を推測せず、不明な時間を0分にもしていません。</p>${button('確認できる操作の記録を見る','operations',true)}</section>`:`<p class="caption">サンプルの今日 · 設定・解除・期限の記録</p><section><h2>このデモで行った操作</h2>${state.records.length?state.records.slice().reverse().map(r=>`<article class="record"><time>${time(r.at)}</time><h3>${esc(r.title)}</h3>${r.detail?`<p class="caption">${esc(r.detail)}</p>`:''}${r.reason?`<details><summary>入力した理由を見る</summary><blockquote>${esc(r.reason)}</blockquote></details>`:''}</article>`).join(''):'<div class="status-card"><p>このデモでは、まだ操作していません。</p><p class="caption">一時解除を試すと、結果と理由をここで確認できます。</p></div>'}</section><details class="details"><summary>サンプルの設定記録</summary>${sample.reverse().map(r=>`<article class="record"><time>${time(r.at)}</time><h3>${r.title}</h3><p class="caption">${r.detail}</p></article>`).join('')}</details><p class="caption">操作記録は実際のアプリ利用時間や集中の成果を示しません。入力はこのタブを再読込すると消えます。</p>`}`;
}
function settings() {
 return `<h1>設定</h1><section class="status-card"><h2>夜の余白</h2><p>平日 21:00〜23:00</p><p>X・YouTube・Instagram</p><p class="caption">この時間にしたいこと</p><p>本を読んで、ゆっくり過ごす。</p>${state.scenario==='paused'?button('この内容で再開する','resume'):''}</section><p class="caption">今回の検討範囲はホーム・解除・記録です。ルール編集はこのデモには含めていません。</p>${button('ホームで現在の状態を見る','home',true)}`;
}
function feedback() {
 if(state.screen!=='intent')return;
 for(const name of ['reason','minutes']){
  const invalid=name==='reason'?!state.reason.trim():!/^([1-9]|[12]\d|30)$/.test(state.minutes);
  const visible=invalid&&(state.attempted||state.touched[name]);
  $('#'+name).setAttribute('aria-invalid',String(visible));
  const error=$('#'+name+'-error');error.hidden=!visible;error.textContent=name==='reason'?'使う理由を、自分の言葉で入力してください。':'1〜30の整数で入力してください。';
 }
}
function clearDraft(){state.target='';state.reason='';state.minutes='5';state.touched={};state.attempted=false;state.reviewUntil=null;}
function navigate(screen,{replace=false,guard=true}={}) {
 if(guard&&isFlow(state.screen)&&!isFlow(screen)&&dirty()) {pendingNavigation=screen;previousFocus=document.activeElement;$('#discard').showModal();return;}
 state.screen=screen;
 history[replace?'replaceState':'pushState']({screen},'',`#${screen}`);
 render();$('#screen').focus();window.scrollTo({top:0,behavior:'instant'});
}
function announce(message){$('#announcement').textContent=message;}
function render() {
 document.body.classList.toggle('large-text',parseFloat(getComputedStyle(document.documentElement).fontSize)>20||innerWidth<=340);
 $('#clock').textContent=`デモ時計 ${time(state.now)}`;
 const views={home,choose,intent,review,result,grants,records,settings};
 $('#screen').innerHTML=views[state.screen]();
 $('#tabs').innerHTML=[['home','⌂ ホーム'],['records','▥ 記録'],['settings','☷ 設定']].map(([key,label])=>`<button type="button" data-action="${key}" ${state.screen===key?'aria-current="page"':''}>${label}</button>`).join('');
 $('#tabs').hidden=isFlow(state.screen);
 if(state.screen==='intent'){feedback();growReason();}
}
function growReason(){const field=$('#reason');if(!field)return;field.style.height='auto';field.style.height=Math.min(field.scrollHeight,parseFloat(getComputedStyle(field).fontSize)*10)+'px';}
function record(title,detail='',reason=''){state.records.push({at:state.now,title,detail,reason});}
function submit() {
 if(state.screen!=='review'||!canUnlock()||!state.reviewUntil||state.reviewUntil<=state.now||activeGrants().some(g=>g.target===state.target))return;
 const target=state.target,until=state.reviewUntil,id=String(state.records.length+1),status=state.outcome;
 if(status!=='failed')state.grants.push({id,target,until,status:status==='uncertain'?'uncertain':'active'});
 record(`${app(target).name}：${status==='ok'?'一時解除の反映を確認':status==='failed'?'解除せず、理由のみ保存':'解除を要求・反映は未確認'}`,status==='failed'?'再制限の予定登録に失敗。解除は行っていません。':`${time(until)}までの要求。ほかのアプリの設定は変更していません。`,state.reason);
 state.result={target,until,status};clearDraft();navigate('result',{guard:false});announce(status==='ok'?'一時解除の反映を確認しました':status==='failed'?'一時解除しませんでした':'反映を確認できません');
}
function advance(){state.now=Math.min(1435,state.now+5);for(const grant of [...state.grants])if(grant.until<=state.now){record(`${app(grant.target).name}：一時解除の期限終了`,'期限に達した記録です。再制限の反映は未確認です。');state.scenario='unknown';$('#scenario').value='unknown';state.grants=state.grants.filter(g=>g.id!==grant.id);}render();announce('デモ時計を5分進めました');}
function closeDialog(){ $('#discard').close();pendingNavigation=undefined;previousFocus?.focus(); }
async function action(event) {
 const target=event.target.closest('[data-action],[data-target]');if(!target||target.disabled)return;
 if(target.dataset.target){state.target=target.dataset.target;render();$(`[data-target="${state.target}"]`).focus();return;}
 const action=target.dataset.action;
 if(['home','records','settings','choose','grants'].includes(action)){navigate(action);return;}
 if(action==='intent'){if(state.target)navigate('intent');return;}
 if(action==='review'){
  state.attempted=true;feedback();const invalid=$('[aria-invalid="true"]');
  if(invalid){invalid.focus();announce('入力内容を確認してください');return;}
  state.reviewUntil=Math.min(1380,state.now+Number(state.minutes));navigate('review');return;
 }
 if(action==='submit'){submit();return;}
 if(action==='cancel'){if(dirty()){pendingNavigation='home';previousFocus=target;$('#discard').showModal();}else navigate('home',{guard:false});return;}
 if(action==='keep'){closeDialog();return;}
 if(action==='discard'){const dest=pendingNavigation||'home';$('#discard').close();clearDraft();navigate(dest,{guard:false});return;}
 if(action==='advance'){advance();return;}
 if(action==='reset'){if(!confirm('デモの入力と操作記録をすべて消して、最初から試しますか？'))return;clearDraft();state.grants=[];state.records=[];state.result=null;state.scenario='applied';state.outcome='ok';state.now=1290;state.recordView='operations';$('#scenario').value='applied';$('#outcome').value='ok';navigate('home',{guard:false,replace:true});return;}
 if(['operations','totals'].includes(action)){state.recordView=action;render();$(`[data-action="${action}"]`).focus();return;}
 if(action==='recover'||action==='resume'){state.scenario='applied';$('#scenario').value='applied';navigate('home');announce('デモの反映確認サンプルを表示しました');return;}
 if(action==='check-grant'){const grant=state.grants.find(g=>g.id===target.dataset.id);if(grant){grant.status='active';record(`${app(grant.target).name}：解除の反映を確認`,'要求時の期限は延長していません。');render();announce('デモの反映確認サンプルを表示しました');}return;}
 if(action==='end-grant'){const grant=state.grants.find(g=>g.id===target.dataset.id);if(grant&&confirm(`${app(grant.target).name}の一時解除を終了しますか？`)){state.grants=state.grants.filter(g=>g.id!==grant.id);record(`${app(grant.target).name}：解除の早期終了を要求`,'再制限の反映は未確認です。');state.scenario='unknown';$('#scenario').value='unknown';navigate('home');}return;}
}
document.addEventListener('click',action);
document.addEventListener('input',event=>{if(event.target.id==='reason'){state.reason=event.target.value;growReason();feedback();}if(event.target.id==='minutes'){state.minutes=event.target.value;feedback();}});
document.addEventListener('focusout',event=>{if(['reason','minutes'].includes(event.target.id)){state.touched[event.target.id]=true;feedback();}});
$('#scenario').addEventListener('change',event=>{state.scenario=event.target.value;if(isFlow(state.screen))render();navigate('home');});
$('#outcome').addEventListener('change',event=>{state.outcome=event.target.value;});
$('#discard').addEventListener('cancel',()=>{pendingNavigation=undefined;previousFocus?.focus();});
window.addEventListener('popstate',event=>{let screen=event.state?.screen||'home';if(!['home','choose','intent','review','result','grants','records','settings'].includes(screen))screen='home';if(isFlow(screen)&&!state.target&&screen!=='choose')screen='home';if(screen==='result'&&!state.result)screen='home';if(isFlow(state.screen)&&!isFlow(screen)&&dirty()){history.pushState({screen:state.screen},'',`#${state.screen}`);pendingNavigation=screen;previousFocus=document.activeElement;$('#discard').showModal();return;}state.screen=screen;render();$('#screen').focus();});
window.addEventListener('resize',()=>{document.body.classList.toggle('large-text',parseFloat(getComputedStyle(document.documentElement).fontSize)>20||innerWidth<=340);});
history.replaceState({screen:'home'},'','#home');render();
