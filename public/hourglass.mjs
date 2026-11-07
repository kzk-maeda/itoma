import { HOUR, MINUTE, sandLevels, remainingTime, humanTime, clockTime, UPPER_BOWL_PATH, LOWER_BOWL_PATH } from './hourglass-math.mjs';

const ruleStart = 21 * HOUR, ruleEnd = 23 * HOUR;
const apps = [{ id:'x', name:'X', glyph:'X' }, { id:'youtube', name:'YouTube', glyph:'▶' }];
const state = { view:'home', selected:null, reason:'', grants:{}, activeTarget:null, notice:'', unknown:false };
const screen = document.querySelector('#screen');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let origin = Date.now(), offset = 0, timer, discardTrigger = null;
const now = () => 21.5 * HOUR + Date.now() - origin + offset;
const escapeHtml = text => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const appName = id => apps.find(app => app.id === id)?.name || '選択したアプリ';
const at = time => `${Math.floor(time / HOUR) % 24}:${String(Math.floor(time / MINUTE) % 60).padStart(2,'0')}`;
const validDraft = () => apps.some(app => app.id === state.selected) && state.reason.trim().length > 0 && !state.grants[state.selected] && !state.unknown && now() < ruleEnd;
const symbol = () => '<svg aria-hidden="true"><use href="#brand-mark"/></svg>';
function button(label, action, primary=false, disabled=false) { return `<button class="${primary?'primary':'secondary'}" data-action="${action}" ${disabled?'disabled':''}>${label}</button>`; }
function icon(app) { return `<span class="app-icon ${app.id}" aria-hidden="true">${app.glyph}</span>`; }

function glass(label, fraction, kind='rule') {
  const levels = sandLevels(fraction);
  return `<div class="glass-figure" role="img" aria-label="${label}" data-glass="${kind}">
    <svg viewBox="0 0 200 240" aria-hidden="true">
      <defs><clipPath id="upper-bowl"><path d="${UPPER_BOWL_PATH}"/></clipPath><clipPath id="lower-bowl"><path d="${LOWER_BOWL_PATH}"/></clipPath></defs>
      <path class="glass-body" d="M62 18H138C158 18 165 28 158 48C151 71 132 88 116 104C106 114 106 126 116 136C132 152 151 169 158 192C165 212 158 222 138 222H62C42 222 35 212 42 192C49 169 68 152 84 136C94 126 94 114 84 104C68 88 49 71 42 48C35 28 42 18 62 18Z"/>
      <g clip-path="url(#upper-bowl)"><rect class="glass-sand sand-level" data-sand="upper" x="0" y="0" width="200" height="116" style="transform:translateY(${levels.upperY}px)"/></g>
      <g clip-path="url(#lower-bowl)"><rect class="glass-sand sand-level" data-sand="lower" x="0" y="0" width="200" height="240" style="transform:translateY(${levels.lowerY}px)"/></g>
      <line class="glass-stream" x1="100" y1="117" x2="100" y2="${levels.lowerY}" ${fraction<=0||fraction>=1?'visibility="hidden"':''}/>
    </svg></div>`;
}

function appRows() {
  return `<div class="app-list">${apps.map(app => {
    const grant = state.grants[app.id];
    return `<div class="app-row">${icon(app)}<div class="app-row-name"><strong>${app.name}</strong><small>${now()>=ruleEnd?'制限なし':grant?`一時解除中 · ${at(grant.expiresAt)}まで`:'制限中'}</small></div>${grant?`<button class="row-link" data-status="${app.id}">状況を見る</button>`:''}</div>`;
  }).join('')}</div>`;
}

function home() {
  if (now() >= ruleEnd) return `<span class="step">夜の時間 · 終了</span><h2 tabindex="-1">今夜の制限は、<br>終了しました。</h2><p class="body-copy">X・YouTubeの制限はありません。</p>${appRows()}`;
  const remaining = remainingTime(ruleEnd,now());
  return `<div class="period-header"><h2 tabindex="-1">夜の時間</h2><span class="pill">${Object.keys(state.grants).length===apps.length?'対象を一時解除中':Object.keys(state.grants).length?'一部を一時解除中':'アプリを制限中'}</span></div>
    <div class="glass-panel">${glass(`夜の時間、残り${humanTime(remaining)}、23時に終了`,remaining/(ruleEnd-ruleStart))}<div class="glass-meta"><span>上：これからの時間</span><span>下：過ぎた時間</span></div><p class="time-label">この時間帯の終了まで</p><p class="time-value" data-time="rule">${humanTime(remaining)}</p><p class="time-end">23:00に終了</p></div>
    <div class="intention"><svg viewBox="0 0 20 24" fill="none" aria-hidden="true"><path d="M4 2h12v20l-6-4-6 4V2Z" stroke="currentColor" stroke-width="1.2"/><path d="M7 6h6M7 10h6" stroke="currentColor" stroke-width="1.2"/></svg><p>夜は、本を読む<br>時間にしたい。</p></div><p class="intention-label">あなたがルールに添えたことば（サンプル）</p>
    ${appRows()}${state.notice?`<p class="notice" role="status">${escapeHtml(state.notice)}</p>`:''}
    <div class="actions">${button('一時解除する','select',true,Object.keys(state.grants).length===apps.length)}<p class="caption">${Object.keys(state.grants).length===apps.length?'すべての対象が一時解除中です。各アプリの状況から制限に戻せます。':'使うアプリを選び、今の理由を確かめます。'}</p></div>`;
}

function select() {
  return `<button class="back" data-action="cancel">‹ ホームに戻る</button><span class="step">ひと呼吸 / 01</span><h2 tabindex="-1">いま、何のために<br>開きますか？</h2><p class="body-copy">必要なアプリだけを、少しの間。</p>
    <fieldset><legend>一時解除するアプリをひとつ選ぶ</legend>${apps.map(app => `<label class="choice">${icon(app)}<span class="app-row-name">${app.name}${state.grants[app.id]?'<small>すでに一時解除中です</small>':''}</span><input type="radio" name="target" value="${app.id}" aria-label="${app.name}" ${state.selected===app.id?'checked':''} ${state.grants[app.id]?'disabled':''}></label>`).join('')}</fieldset>
    <label class="reason-label" for="reason">いま使う理由</label><textarea id="reason" maxlength="200" placeholder="例：友人からの連絡を確認する" aria-describedby="reason-help">${escapeHtml(state.reason)}</textarea><p class="caption" id="reason-help">自分の言葉で、ひと言から。入力は保存されません。</p>
    <div class="actions">${button('制限を続ける','cancel',true)}${button('解除する内容を確認する →','review',false,!validDraft())}<p class="caption">アプリの選択と、理由の入力が必要です。</p></div>`;
}

function review() {
  return `<button class="back" data-action="select">‹ アプリと理由を変更する</button><span class="step">解除する内容 / 02</span><h2 tabindex="-1">この用事のために、<br>少しだけ。</h2><p class="body-copy">夜の時間のルール自体は変わりません。</p>
    <div class="summary"><dl><dt>一時解除するアプリ</dt><dd>${appName(state.selected)}</dd><dt>今回の理由</dt><dd>${escapeHtml(state.reason.trim())}</dd><dt>期間</dt><dd><span data-review-duration>${humanTime(Math.min(5*MINUTE,ruleEnd-now()))}</span>（確定時から、最大5分）<br>遅くとも23:00まで</dd></dl></div>
    <p class="caption" style="margin-top:16px">${apps.filter(app=>app.id!==state.selected&&!state.grants[app.id]).map(app=>app.name).join('・')||'ほかのアプリ'}の${Object.keys(state.grants).length?'設定と解除期限は変わりません。':'制限は続きます。'}<br>終了後は制限に戻ります。途中でも戻せます。</p>
    <div class="actions">${button('制限を続ける','cancel',true)}${button(`${appName(state.selected)}を一時解除する`,'unlock')}</div>`;
}

function active() {
  const grant = state.grants[state.activeTarget];
  if (!grant) return home();
  const remaining = remainingTime(grant.expiresAt,now());
  return `<div class="period-header"><h2 tabindex="-1">${appName(grant.target)}の一時解除</h2><span class="pill">一時解除中</span></div>
    <div class="glass-panel">${glass(`${appName(grant.target)}の一時解除、残り${clockTime(remaining)}`,remaining/(grant.expiresAt-grant.acceptedAt),'grant')}<p class="time-label">一時解除の残り時間</p><p class="time-value" data-time="grant">${clockTime(remaining)}</p><p class="time-end">${at(grant.expiresAt)}に制限へ戻ります</p></div>
    <div class="summary"><dl><dt>今回の理由</dt><dd>${escapeHtml(grant.reason)}</dd></dl></div>
    <div class="mini-period">${symbol()}<div><p>夜の時間のルール</p><strong>終了まで <span data-time="period">${humanTime(ruleEnd-now())}</span> · 23:00まで</strong></div></div>
    <div class="actions">${button(`${appName(grant.target)}を今すぐ制限に戻す`,'restore',true)}${button('ホームに戻る','home')}</div>`;
}

function unknown() {
  return `<span class="step">状態の確認が必要です</span><h2 tabindex="-1">制限の状態を<br>確認できません。</h2><p class="body-copy">設定上の夜の時間は23:00までですが、制限が反映されているかを確認できません。</p><div class="notice">砂時計を動かしたまま、制限できているようには表示しません。入力や解除期限は保持しています。</div><div class="actions">${button('状態を再確認する','retry',true)}<p class="caption">このデモでは再確認後に通常のモック表示に戻ります。</p></div>`;
}

function render(focus=false) {
  const previous = screen.dataset.view;
  screen.innerHTML = state.unknown?unknown():({home,select,review,active})[state.view]();
  screen.dataset.view = state.unknown?'unknown':state.view;
  document.querySelector('#phase').textContent = state.unknown?'状態不明':({home:'ホーム',select:'一時解除',review:'内容確認',active:'解除中'})[state.view];
  document.querySelectorAll('[data-scene]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.scene===state.view&&!state.unknown)));
  updateTime();
  if (!reducedMotion.matches && previous!==screen.dataset.view) screen.animate([{opacity:.6,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'ease-out'});
  if (focus) (screen.querySelector('h2')||screen.querySelector('button'))?.focus();
}

function reconcile() {
  let changed = false;
  for (const [id,grant] of Object.entries(state.grants)) if (now()>=grant.expiresAt) { delete state.grants[id]; changed=true; state.notice=`${appName(id)}の一時解除が終了しました。（デモ上の結果）`; }
  if (now()>=ruleEnd && (state.view!=='home'||screen.querySelector('[data-glass]'))) { state.view='home'; state.selected=null; state.reason=''; changed=true; }
  if (state.view==='active'&&!state.grants[state.activeTarget]) { state.view='home'; changed=true; }
  // A different app's expiry must not replace a textarea while the user is typing.
  if (changed&&state.view==='select'&&!state.unknown&&now()<ruleEnd) {
    screen.querySelectorAll('input[name="target"]').forEach(input=>{
      input.disabled=Boolean(state.grants[input.value]);
      if(!input.disabled)input.closest('.choice').querySelector('small')?.remove();
    });
    screen.querySelector('[data-action="review"]').disabled=!validDraft();
    updateTime();return;
  }
  if (changed) { if (document.querySelector('#discard').open) document.querySelector('#discard').close(); render(); }
  else updateTime();
}

function updateTime() {
  document.querySelector('#device-clock').textContent = at(now());
  const ruleValue = screen.querySelector('[data-time="rule"]');
  if (ruleValue) ruleValue.textContent=humanTime(ruleEnd-now());
  const periodValue = screen.querySelector('[data-time="period"]');
  if (periodValue) periodValue.textContent=humanTime(ruleEnd-now());
  const grant=state.grants[state.activeTarget], grantValue=screen.querySelector('[data-time="grant"]');
  if (grantValue&&grant) grantValue.textContent=clockTime(grant.expiresAt-now());
  const figure=screen.querySelector('[data-glass]');
  if (figure) {
    const isGrant=figure.dataset.glass==='grant';
    const fraction=isGrant&&grant?remainingTime(grant.expiresAt,now())/(grant.expiresAt-grant.acceptedAt):remainingTime(ruleEnd,now())/(ruleEnd-ruleStart);
    const levels=sandLevels(fraction);
    figure.querySelector('[data-sand="upper"]').style.transform=`translateY(${levels.upperY}px)`;
    figure.querySelector('[data-sand="lower"]').style.transform=`translateY(${levels.lowerY}px)`;
    const stream=figure.querySelector('.glass-stream');stream.setAttribute('y2',String(levels.lowerY));stream.setAttribute('visibility',fraction>0&&fraction<1?'visible':'hidden');
    figure.setAttribute('aria-label',isGrant&&grant?`${appName(grant.target)}の一時解除、残り${clockTime(grant.expiresAt-now())}`:`夜の時間、残り${humanTime(ruleEnd-now())}、23時に終了`);
  }
  const reviewDuration=screen.querySelector('[data-review-duration]');if(reviewDuration)reviewDuration.textContent=humanTime(Math.min(5*MINUTE,ruleEnd-now()));
}

function clearDraft() { state.selected=null;state.reason=''; }
function goHome() { state.view='home';render(true); }
function requestLeave(control) {
  if(state.selected||state.reason.length){discardTrigger=control;document.querySelector('#discard').showModal();}
  else goHome();
}

document.addEventListener('click',event=>{
  const theme=event.target.closest('[data-appearance]');
  if(theme){if(theme.dataset.appearance==='system')delete document.body.dataset.theme;else document.body.dataset.theme=theme.dataset.appearance;document.querySelectorAll('[data-appearance]').forEach(button=>button.setAttribute('aria-pressed',String(button===theme)));return;}
  const scene=event.target.closest('[data-scene]');
  if(scene){clearDraft();state.unknown=false;state.notice='';state.view=scene.dataset.scene;if(state.view==='active'){state.activeTarget='x';if(!state.grants.x&&now()<ruleEnd)state.grants.x={target:'x',reason:'友人からの連絡を確認する（デモ用サンプル）',acceptedAt:now(),expiresAt:Math.min(now()+5*MINUTE,ruleEnd)};}reconcile();render();return;}
  const status=event.target.closest('[data-status]');if(status){state.activeTarget=status.dataset.status;state.view='active';render(true);return;}
  const control=event.target.closest('[data-action]');if(!control)return;
  const action=control.dataset.action;
  if(action==='keep'){document.querySelector('#discard').close();discardTrigger?.focus();return;}
  if(action==='discard'){document.querySelector('#discard').close();clearDraft();state.notice='制限を続けています。解除は行っていません。';goHome();return;}
  if(action==='reset'){origin=Date.now();offset=0;clearDraft();state.grants={};state.activeTarget=null;state.unknown=false;state.notice='';state.view='home';render();return;}
  if(action==='advance'){offset+=10*MINUTE;reconcile();return;}
  if(action==='end-rule'){offset+=Math.max(0,ruleEnd-now());reconcile();return;}
  if(action==='expire'){const grant=state.grants[state.activeTarget]||Object.values(state.grants)[0];if(grant){offset+=Math.max(0,grant.expiresAt-now());reconcile();}return;}
  if(action==='unknown'){state.unknown=true;render(true);return;}
  if(action==='retry'){state.unknown=false;reconcile();render(true);return;}
  if(action==='cancel'){requestLeave(control);return;}
  if(action==='home'){goHome();return;}
  if(action==='select'&&now()<ruleEnd&&!state.unknown){state.view='select';state.notice='';render(true);return;}
  if(action==='review'&&validDraft()){state.view='review';render(true);return;}
  if(action==='unlock'&&state.view==='review'&&validDraft()){
    const acceptedAt=now(),id=state.selected;
    state.grants[id]={target:id,reason:state.reason.trim(),acceptedAt,expiresAt:Math.min(acceptedAt+5*MINUTE,ruleEnd)};
    state.activeTarget=id;clearDraft();state.view='active';render(true);return;
  }
  if(action==='restore'&&state.grants[state.activeTarget]){const id=state.activeTarget;delete state.grants[id];state.notice=`${appName(id)}の一時解除を終了しました。（デモ上の結果）`;goHome();}
});
document.addEventListener('change',event=>{if(event.target.matches('input[name="target"]')){state.selected=event.target.value;screen.querySelector('[data-action="review"]').disabled=!validDraft();}});
document.addEventListener('input',event=>{if(event.target.id==='reason'){state.reason=event.target.value;screen.querySelector('[data-action="review"]').disabled=!validDraft();}});
function motionPreference(){document.querySelector('#motion-preference').textContent=reducedMotion.matches?'動きを減らす設定に対応中：砂の量を静止表示で更新します。':'砂の動きは時間の変化に連動します。反復する粒子演出や反転操作はありません。';if(reducedMotion.matches)document.getAnimations().forEach(animation=>animation.cancel());}
reducedMotion.addEventListener('change',motionPreference);
function syncTimer(){clearInterval(timer);if(document.hidden){document.getAnimations().forEach(animation=>animation.cancel());return;}reconcile();timer=setInterval(reconcile,1000);}
document.addEventListener('visibilitychange',syncTimer);
motionPreference();render();syncTimer();
