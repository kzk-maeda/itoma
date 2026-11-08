import {APPS,DAY_BASE,createState,validPlan,reviewGrant,confirmPlan,confirmGrant,expireGrants,formatClock,remainingText,reflectionReply} from './companion-model.mjs';
const $=selector=>document.querySelector(selector);
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let origin=Date.now(),state=createState(),view='home',reviewRevision=null,lastEnded=false,lastProposalMinutes=null,dialogTrigger,pendingAction,lastView='';
const now=()=>DAY_BASE+Date.now()-origin;
const clockLabel=value=>(value>=86400000?'翌':'')+formatClock(value);
function character(pose='calm'){
 return `<svg class="character" viewBox="0 0 180 160" aria-hidden="true"><path class="ground" d="M38 145q52 8 104 0"/><path class="feet" d="M63 131q-5 11 4 11h12l2-12m25 0 1 12h12q8-1 3-12"/><path class="body" d="M40 97c-2-29 10-53 35-56 4-16 24-17 25-5 29-3 42 19 43 44 12 7 15 21 7 33-5 20-24 25-58 24-39 1-55-10-52-40Z"/><path class="tuft" d="M75 41q9-12 22-6"/><path class="face" d="M52 94q-6 5-2 11m80-13q6 6 3 12"/>${pose==='warm'?'<path class="face" d="M68 79q4-6 8 0m29 0q4-6 8 0"/>':'<ellipse class="eye" cx="72" cy="78" rx="2.4" ry="3"/><ellipse class="eye" cx="108" cy="78" rx="2.4" ry="3"/>'}<path class="face" d="M84 91q6 5 12 0"/><path class="cheek" d="M60 88h7m46 0h7"/></svg>`;
}
function assistant(normal,quiet,pose='calm') {return `<div class="chat-turn assistant"><div class="chat-avatar">${character(pose)}</div><div class="chat-bubble"><span class="speaker">まる · シナリオ</span><p class="voice-normal">${e(normal)}</p><p class="voice-quiet">${e(quiet)}</p></div></div>`;}
function userBubble(text){return `<div class="chat-turn user"><div class="chat-bubble"><p>${e(text)}</p></div></div>`;}
function heading(label,title,subtitle=''){return `<p class="small-label">${e(label)}</p><h2 class="page-title" tabindex="-1">${e(title)}</h2>${subtitle?`<p class="subtitle">${e(subtitle)}</p>`:''}`;}
const back=(href='#home',label='いまの時間に戻る')=>`<a class="back" href="${href}">‹ ${label}</a>`;
function statusBanner(){if(state.status==='normal')return '';return `<div class="banner" role="status"><strong>${state.status==='unknown'?'制限の反映を確認できません':'制限を反映できませんでした'}</strong><p>時間設定は保持しています。解除済み・制限中とは判断せず、まず状態を確認してください。</p><button data-action="retry">状態を再確認する</button></div>`;}
function home(){
 const ended=now()>=state.rule.end,uncertain=state.status!=='normal';
 return `<div class="state-line"><span><i class="state-dot" aria-hidden="true"></i>${uncertain?'状態を確認してください':ended?'時間帯が終了しました':'夜の時間 · デモ'}</span><span class="status-pill">${clockLabel(state.rule.end)}までの設定</span></div>${statusBanner()}<div class="companion-stage assistant">${character('calm')}<p class="speaker">まる · いとまの相棒</p></div><h2 class="home-title" tabindex="-1">${ended?'今夜の時間、ここまで。':'今夜の余白を、いっしょに。'}</h2><p class="home-copy voice-normal">${ended?'どんな時間だったかは、あなたが知っていること。よければ、ひと言だけ話そう。':'決めた時間を大切にしながら、必要な用事も。いまの気持ちを、ひとつずつ確かめよう。'}</p><p class="home-copy voice-quiet">必要なときだけ、ここにいるよ。</p><div class="purpose-card"><p class="small-label">あなたが決めたこと</p><blockquote>${e(state.rule.purpose)}</blockquote></div><div class="rule-card"><div class="mini-ring" role="img" aria-label="設定上の残り時間"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="45"/><circle class="progress" id="rule-progress" cx="50" cy="50" r="45" pathLength="100" stroke-dasharray="100" stroke-dashoffset="25"/></svg><span id="rule-remaining"></span></div><div class="rule-text"><strong>${uncertain?'設定上の残り時間':ended?'この時間帯は終了':'設定した時間の残り'}</strong><p>${formatClock(state.rule.start)} — ${clockLabel(state.rule.end)}</p><div class="apps-inline">${APPS.map(app=>`<span class="app-chip">${app} · ${uncertain?'反映未確認':ended?'時間帯終了':state.grants[app]?'一時解除中':'制限中（デモ）'}</span>`).join('')}</div></div></div>${grants()}<div class="home-actions">${ended?'<a class="primary" href="#reflect">ここまでを振り返る</a>':'<a class="primary" href="#unlock">用事があるので、一時解除する</a>'}<a class="secondary" href="#plan">${ended?'次の時間を相談する':'今夜の時間を相談する'}</a></div><div class="home-links"><a class="link-row" href="#reflect"><span>昨夜の余白を、振り返る</span><span aria-hidden="true">›</span></a>${state.reflection?'<a class="link-row" href="#recap"><span>自分が残したひと言を見る</span><span aria-hidden="true">›</span></a>':''}</div>`;
}
function grants(){return `<div class="active-grants">${Object.entries(state.grants).map(([app,grant])=>`<div class="grant-row"><span>${app} の${state.status==='normal'?'一時解除':'一時解除設定（未確認）'}<small data-grant="${app}">${clockLabel(grant.until)}まで</small></span><button data-restore="${app}">制限に戻す</button></div>`).join('')}</div>`;}
function plan(){return back()+heading('時間を、いっしょに決める','今夜、どんな余白にしたい？')+assistant('本を読む。ゆっくり休む。何もしない。あなたが大切にしたいことを、ひと言で聞かせて。','大切にしたいことを、ひと言で。')+`<form id="plan-form" class="composer"><label for="purpose">この時間に、大切にしたいこと</label><textarea id="purpose" maxlength="200" placeholder="例：寝る前に、本を少し読む" aria-describedby="purpose-help">${e(state.planDraft.purpose)}</textarea><div class="input-meta"><span id="purpose-help">あなたの言葉で。相棒が評価することはありません。</span><span id="purpose-count">${state.planDraft.purpose.length}/200</span></div><div class="actions"><button id="plan-send" class="primary wide" ${state.planDraft.purpose.trim()?'':'disabled'}><span class="voice-on">まるに伝える</span><span class="voice-off">内容を確認する</span></button><a class="back" href="#home">いまの設定のまま戻る</a></div></form>`;}
function planReview(){
 const minutes=state.planDraft.minutes;
 return back('#plan','言葉を変更する')+heading('提案を、自分で選ぶ','この時間にしようか。')+userBubble(state.planDraft.purpose)+assistant('そのための余白をつくろう。まずは1時間を提案するね。短くしても、長くしても、あなたが決めて大丈夫。','どのくらいの時間にする？')+`<h3 class="section-heading">いまから、どのくらい？</h3><div class="choice-group" role="group" aria-label="設定する時間">${[30,60,90].map(value=>`<button class="duration-choice" data-minutes="${value}" aria-pressed="${value===minutes}">${value}分</button>`).join('')}</div><div class="summary-card"><dl><dt>大切なこと</dt><dd>${e(state.planDraft.purpose.trim())}</dd><dt>時間</dt><dd><strong><span id="proposed-start">${formatClock(now())}</span> — <span id="proposed-end">${clockLabel(now()+minutes*60000)}</span></strong><br>確定から${minutes}分間</dd><dt>対象</dt><dd>X・YouTube</dd></dl></div><p class="caption" style="margin-top:14px">今の時間設定を置き換えます。確定するまで変更しません。</p>${Object.keys(state.grants).length?`<div class="banner">この確定で、${Object.keys(state.grants).map(e).join('・')}の一時解除も終了します。</div>`:''}<div class="actions"><button class="primary" data-action="confirm-plan">この時間に決める</button><a class="secondary" href="#plan">考え直す</a></div>`;
}
function unlock(){
 if(now()>=state.rule.end)return back()+heading('一時解除','時間帯が終了しました','今は、このルールを一時解除する操作は行いません。');
 const valid=reviewGrant(state,now());
 return back()+heading('開く前に、ひと呼吸','いま、何のために開く？')+statusBanner()+assistant(`「${state.rule.purpose}」って決めていたね。いま済ませたい用事があれば、そのための時間を考えよう。`,'済ませたい用事を、自分の言葉で。')+`<div class="mini-summary">夜の時間は ${clockLabel(state.rule.end)}まで。必要なアプリだけ、一時解除できます。</div><fieldset><legend>一時解除するアプリ</legend>${APPS.map(app=>`<label class="app-choice"><span class="app-icon" aria-hidden="true">${app==='X'?'X':'▶'}</span><span class="choice-copy">${app}${state.grants[app]?`<small>${clockLabel(state.grants[app].until)}まで一時解除中</small>`:''}</span><input type="radio" name="unlock-app" value="${app}" aria-label="${app}${state.grants[app]?'、一時解除中':''}" ${state.unlockDraft.app===app?'checked':''} ${state.grants[app]?'disabled':''}></label>`).join('')}</fieldset><form id="unlock-form" class="composer"><label for="reason">いま使う理由</label><textarea id="reason" maxlength="200" placeholder="例：友人に待ち合わせ場所を返信したい" aria-describedby="reason-help">${e(state.unlockDraft.reason)}</textarea><div class="input-meta"><span id="reason-help">内容の良し悪しは判断しません。</span><span id="reason-count">${state.unlockDraft.reason.length}/200</span></div><div class="actions"><button type="button" class="primary" data-action="continue-restriction">制限を続ける</button><button id="unlock-next" class="secondary" ${valid?'':'disabled'}>解除に進む</button></div></form>`;
}
function unlockReview(){
 const proposal=reviewGrant(state,now()),until=proposal?.until??Math.min(now()+300000,state.rule.end),minutes=proposal?.minutes??Math.max(0,Math.ceil((until-now())/60000));
 lastProposalMinutes=minutes;
 return back('#unlock','アプリと理由を変更する')+heading('自分で、確かめて決める',`${state.unlockDraft.app}を、必要な時間だけ。`)+statusBanner()+userBubble(state.unlockDraft.reason)+assistant(`用事のための最大${minutes}分にしようか。ほかのアプリの状態と、夜の時間設定は変えないよ。`,'この内容で進めるか、選んでね。')+`<div class="summary-card"><dl><dt>対象</dt><dd>${e(state.unlockDraft.app)}</dd><dt>期間</dt><dd><strong>確定から最大${minutes}分</strong><br><span id="grant-end">${clockLabel(until)}</span>まで（表示時点）<br>夜の時間 ${clockLabel(state.rule.end)}を越えません</dd><dt>理由</dt><dd>${e(state.unlockDraft.reason.trim())}</dd><dt>残る状態</dt><dd>${APPS.filter(app=>app!==state.unlockDraft.app).map(app=>`${app}：${state.grants[app]?`${clockLabel(state.grants[app].until)}まで一時解除中`:'制限を継続（デモ）'}`).map(e).join('<br>')}</dd></dl></div><div class="actions"><button class="primary" data-action="continue-restriction">制限を続ける</button><button class="secondary" data-action="confirm-unlock" ${proposal&&reviewRevision===state.rule.revision?'':'disabled'}>このアプリを一時解除する</button></div>`;
}
function reflect(){return back()+heading('昨夜の余白を、振り返る','どんな時間だった？')+`<div class="reflection-metrics"><div><span class="small-label">昨夜、設定した時間</span><strong>2時間</strong></div><div><span class="small-label">一時解除の記録</span><strong>1回</strong></div></div><p class="caption">架空の昨夜の記録です。設定時間は、実際の集中時間ではありません。</p>`+assistant('昨夜は「寝る前に、本を少し読む」ために時間を決めていたね。実際にはどんな時間になったか、よければひと言。','昨夜のこと、残したい言葉はある？')+`<form id="reflect-form" class="composer"><label for="reflection">自分のために残す、ひと言</label><textarea id="reflection" maxlength="200" placeholder="例：本を数ページ読めた。続きが楽しみ。" aria-describedby="reflection-help">${e(state.note)}</textarea><div class="input-meta"><span id="reflection-help">書かずに終えても大丈夫です。</span><span id="reflection-count">${state.note.length}/200</span></div><div class="actions"><button id="reflect-send" class="primary" ${state.note.trim()?'':'disabled'}><span class="voice-on">まるに話して、残す</span><span class="voice-off">ひと言を残す</span></button><button class="secondary" type="button" data-action="skip-reflect">書かずに終える</button></div></form>`;}
function recap(){return back()+heading('あなたが残した言葉','このひと言を、ここに。')+assistant(reflectionReply(Boolean(state.reflection)),'聞かせてくれてありがとう。今日は、ここまで。','warm')+(state.reflection?`<div class="quote-note"><p>本人の振り返り · このページ内の記憶</p><blockquote>${e(state.reflection)}</blockquote></div>`:'<p class="subtitle">ひと言を残さず、振り返りを終えました。</p>')+`<div class="actions"><a class="primary" href="#done">対話を終える</a><a class="back" href="#reflect">書き直す</a></div>`;}
function outcome(){const data=state.outcome;return back()+heading(data.type==='planned'?'本人が決めた時間':'本人が選んだ一時解除',data.type==='planned'?'この時間に、決めました。':state.status==='normal'?`${data.app}を一時解除しました。`:'一時解除の反映を確認してください。')+statusBanner()+assistant(data.type==='planned'?'決めたことは、ここに置いておくね。ここからは、あなたの時間へ。用事ができたら、そのときにまた考えよう。':'用事が済んだら、予定より早く戻しても大丈夫。ここからは、選んだ用事のための時間にしよう。','ここからは、あなたが選んだ時間へ。','warm')+`<div class="summary-card"><dl>${data.type==='planned'?`<dt>大切なこと</dt><dd>${e(state.rule.purpose)}</dd><dt>時間</dt><dd>${formatClock(state.rule.start)} — ${clockLabel(state.rule.end)}</dd>`:`<dt>対象</dt><dd>${e(data.app)}</dd><dt>期限</dt><dd>${clockLabel(data.until)}まで<br><span id="outcome-remaining"></span></dd>`}</dl></div><div class="actions"><a class="primary" href="#done">対話を終える</a><a class="secondary" href="#home">状態を確認する</a></div>`;}
function done(){return `<div class="closing">${character('warm')}<h2 tabindex="-1">ここからは、<br>画面の外の時間に。</h2><p>必要なときだけ、また。<br>次に開くまで、話し続けなくて大丈夫。</p><div class="mini-summary">${state.status==='normal'?(now()<state.rule.end?`${clockLabel(state.rule.end)}までの時間設定があります。`:'今回の時間帯は終了しました。'):'時間設定は保持していますが、制限の反映は未確認です。'}</div><div class="actions"><a class="secondary" href="#home">いまの状態を見る</a></div></div>`;}
const views={home,plan,'plan-review':planReview,unlock,'unlock-review':unlockReview,reflect,recap,outcome,done};
function readView(){const candidate=location.hash.slice(1)||'home';if(!Object.hasOwn(views,candidate))return 'home';if(candidate==='plan-review'&&!validPlan(state.planDraft))return 'plan';if(candidate==='unlock-review'&&(!state.unlockDraft.app||!state.unlockDraft.reason.trim()))return 'unlock';if(candidate==='outcome'&&!state.outcome)return 'home';return candidate;}
function render({focus=false,resetScroll=false}={}){
 view=readView();$('#screen').innerHTML=views[view]();
 if(lastView!==view)$('#screen').querySelectorAll('.chat-turn').forEach(turn=>turn.classList.add('revealed'));lastView=view;
 $('#home-tab').setAttribute('aria-current',['home','plan','plan-review','unlock','unlock-review','outcome','done'].includes(view)?'page':'false');$('#reflect-tab').setAttribute('aria-current',['reflect','recap'].includes(view)?'page':'false');
 const scene=['plan','plan-review'].includes(view)?'plan':['unlock','unlock-review'].includes(view)?'unlock':['reflect','recap'].includes(view)?'reflect':'home';
 document.querySelectorAll('[data-scene]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.scene===scene)));
 if(resetScroll)$('#app-scroll').scrollTop=0;
 if(focus)$('#screen h2')?.focus({preventScroll:true});
 tick();
}
function isDirty(){return ['plan','plan-review'].includes(view)?Boolean(state.planDraft.purpose):['unlock','unlock-review'].includes(view)?Boolean(state.unlockDraft.app||state.unlockDraft.reason):view==='reflect'?state.note!==state.reflection:false;}
function clearDraft(){if(['plan','plan-review'].includes(view))state.planDraft={purpose:'',minutes:60};if(['unlock','unlock-review'].includes(view))state.unlockDraft={app:'',reason:''};if(view==='reflect')state.note=state.reflection;}
function showDialog(title,content,closeLabel='閉じる'){dialogTrigger=document.activeElement;$('#dialog-content').innerHTML=`<h2 id="dialog-title">${title}</h2>${content}`;$('#dialog-close').textContent=closeLabel;$('#dialog').showModal();}
function go(destination,force=false){
 const sameFlow=(['plan','plan-review'].includes(view)&&['#plan','#plan-review'].includes(destination))||(['unlock','unlock-review'].includes(view)&&['#unlock','#unlock-review'].includes(destination));
 if(!force&&!sameFlow&&isDirty()){pendingAction=destination;showDialog('入力を破棄して移動しますか？','<p>まだ確定していない入力があります。設定や解除の状態は変わりません。</p><button class="primary wide" data-action="discard">入力を破棄して移動する</button>','入力を続ける');return;}
 if(destination==='reset'){reset();return;}
 if(location.hash===destination)render({focus:true,resetScroll:true});else location.hash=destination;
}
function reset(){origin=Date.now();state=createState();reviewRevision=null;lastEnded=false;$('#scenario').value='normal';go('#home',true);announce('サンプルを最初の状態へ戻しました。');}
function announce(text){$('#announcement').textContent=text;}
function updateUnlockValidity(){const button=$('#unlock-next');if(button)button.disabled=!reviewGrant(state,now());}
document.addEventListener('click',event=>{
 const anchor=event.target.closest('a[href^="#"]');if(anchor){event.preventDefault();go(anchor.getAttribute('href'));return;}
 const button=event.target.closest('button');if(!button||button.disabled)return;
 if(button.dataset.scene){go('#'+button.dataset.scene);return;}
 if(button.dataset.minutes){state.planDraft.minutes=Number(button.dataset.minutes);render();$(`[data-minutes="${state.planDraft.minutes}"]`)?.focus({preventScroll:true});return;}
 if(button.dataset.restore){delete state.grants[button.dataset.restore];render();announce('選択したアプリの一時解除を終了しました（デモ）。');return;}
 switch(button.dataset.action){
  case 'reset':go('reset');break;
  case 'retry':state.status='normal';$('#scenario').value='normal';render({focus:true});break;
  case 'confirm-plan':if(confirmPlan(state,now()))go('#outcome',true);break;
  case 'confirm-unlock':if(confirmGrant(state,now(),reviewRevision))go('#outcome',true);else{render({focus:true});announce('条件が変わりました。内容をもう一度確認してください。');}break;
  case 'continue-restriction':go('#home');break;
  case 'skip-reflect':if(state.note.trim())go('#done');else{state.note=state.reflection;go('#done',true);}break;
  case 'discard':{const destination=pendingAction;clearDraft();$('#dialog').close();if(destination)go(destination,true);break;}
 }
});
document.addEventListener('input',event=>{
 const field=event.target;
 if(field.id==='purpose'){state.planDraft.purpose=field.value;$('#plan-send').disabled=!field.value.trim();$('#purpose-count').textContent=`${field.value.length}/200`;}
 if(field.id==='reason'){state.unlockDraft.reason=field.value;updateUnlockValidity();$('#reason-count').textContent=`${field.value.length}/200`;}
 if(field.id==='reflection'){state.note=field.value;$('#reflect-send').disabled=!field.value.trim();$('#reflection-count').textContent=`${field.value.length}/200`;}
});
document.addEventListener('change',event=>{
 if(event.target.name==='unlock-app'){state.unlockDraft.app=event.target.value;updateUnlockValidity();}
 if(event.target.name==='voice'){document.body.dataset.voice=event.target.value;}
});
document.addEventListener('submit',event=>{
 if(event.target.id==='plan-form'){event.preventDefault();if(validPlan(state.planDraft))go('#plan-review',true);}
 if(event.target.id==='unlock-form'){event.preventDefault();if(reviewGrant(state,now())){reviewRevision=state.rule.revision;go('#unlock-review',true);}}
 if(event.target.id==='reflect-form'){event.preventDefault();if(state.note.trim()){state.reflection=state.note.trim();state.note=state.reflection;go('#recap',true);}}
});
$('#voice-settings').addEventListener('click',()=>{
 const voice=document.body.dataset.voice||'normal';
 showDialog('相棒との距離感','<p>設定や解除の操作は、そのまま使えます。</p>'+[['normal','いつもの声かけ','3つの場面で、短く対話します'],['quiet','少なめ','ひと言に絞り、姿も控えめに'],['off','キャラクターを非表示','状態と操作だけで使います']].map(([id,title,caption])=>`<label class="voice-choice"><input type="radio" name="voice" value="${id}" ${id===voice?'checked':''}><span>${title}<small>${caption}</small></span></label>`).join(''));
});
$('#dialog-close').addEventListener('click',()=>$('#dialog').close());$('#dialog').addEventListener('close',()=>{pendingAction=null;if(dialogTrigger?.isConnected)dialogTrigger.focus();});
$('#appearance').addEventListener('change',event=>{document.documentElement.dataset.appearance=event.target.value;});
$('#scenario').addEventListener('change',event=>{state.status=event.target.value;render();});
window.addEventListener('hashchange',()=>render({focus:true,resetScroll:true}));
window.addEventListener('beforeunload',event=>{if(isDirty()){event.preventDefault();event.returnValue='';}});
function tick(){
 const current=now();$('#clock').textContent=formatClock(current);
 const ended=current>=state.rule.end;
 const changed=expireGrants(state,current);
 if(ended!==lastEnded){lastEnded=ended;if(['home','unlock','unlock-review'].includes(view)){render();return;}}
 if(changed&&view==='home'){render();return;}
 const remaining=$('#rule-remaining');if(remaining){remaining.textContent=remainingText(state.rule.end-current);$('.mini-ring').setAttribute('aria-label',`設定上の残り${remaining.textContent}、${clockLabel(state.rule.end)}まで`);$('#rule-progress').setAttribute('stroke-dashoffset',String(100-Math.max(0,Math.min(1,(state.rule.end-current)/(state.rule.end-state.rule.start)))*100));}
 document.querySelectorAll('[data-grant]').forEach(label=>{const grant=state.grants[label.dataset.grant];if(grant)label.textContent=`${clockLabel(grant.until)}まで · 残り${remainingText(grant.until-current)}`;});
 const outcomeRemaining=$('#outcome-remaining');if(outcomeRemaining&&state.outcome?.until)outcomeRemaining.textContent=current>=state.outcome.until?'今回の期限は終了しました（デモ）':`残り${remainingText(state.outcome.until-current)}`;
 const proposed=$('#proposed-end');if(proposed){proposed.textContent=clockLabel(current+state.planDraft.minutes*60000);$('#proposed-start').textContent=formatClock(current);}
 if(view==='unlock-review'){const proposal=reviewGrant(state,current);if(proposal&&proposal.minutes!==lastProposalMinutes){render();announce(`解除の上限が${proposal.minutes}分に変わりました。内容を確認してください。`);return;}if(proposal&&$('#grant-end'))$('#grant-end').textContent=clockLabel(proposal.until);}
 document.querySelectorAll('input[name="unlock-app"]').forEach(input=>{input.disabled=Boolean(state.grants[input.value]);if(!input.disabled)input.closest('.app-choice').querySelector('small')?.remove();});
 updateUnlockValidity();
}
let displayTimer;
function syncTimer(){clearInterval(displayTimer);if(document.hidden)return;tick();displayTimer=setInterval(tick,1000);}
document.addEventListener('visibilitychange',syncTimer);
render();syncTimer();
