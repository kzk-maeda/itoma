import { initialState, escapeHtml as e, daySummary, timeSummary, validateSchedule, canResume, applyOperation } from './settings-model.mjs';
const app = document.querySelector('#app'), dialog = document.querySelector('#dialog');
let state = initialState(), route = location.hash.slice(1) || 'settings', draft, original, deleteScope = 'reasons', afterDialog, focusReturn;
const icons = { schedule:'<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16m-11 5h6"/>', shield:'<path d="M12 3 4 6v6c0 4 8 9 8 9s8-5 8-9V6z"/><path d="m8 12 3 3 5-6"/>', records:'<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6m-6 4h6m-6 4h3"/>', help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v.1"/>', home:'<path d="m3 11 9-8 9 8M6 9v12h12V9m-9 12v-7h6v7"/>', history:'<path d="M4 20V10m8 10V4m8 16v-6"/>' };
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.records}</svg>`;
const link = (title, detail, target, symbol) => `<a class="row" href="#${e(target)}">${symbol ? `<span class="row-icon">${icon(symbol)}</span>` : ''}<span class="row-content"><span class="row-title">${e(title)}</span>${detail ? `<span class="row-detail">${e(detail)}</span>` : ''}</span><span class="chevron" aria-hidden="true">›</span></a>`;
const button = (label, action, secondary = false, disabled = false, danger = false) => `<button class="action ${secondary ? 'secondary' : ''} ${danger ? 'danger' : ''}" data-action="${action}" ${disabled || state.busy ? 'disabled' : ''}>${label}</button>`;
const section = (label, content) => `<section class="section"><h3 class="section-label">${label}</h3>${content}</section>`;
const group = content => `<div class="group">${content}</div>`;
const note = text => `<p class="note">${text}</p>`;
const notice = (title, text, action = '') => `<div class="notice"><b>${e(title)}</b>${text}${action}</div>`;
const facts = rows => `<dl class="facts">${rows.map(([k,v]) => `<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join('')}</dl>`;
const selectedRule = () => state.rules.find(r => r.id === route.split('/')[1]);
const dirty = () => !!draft && JSON.stringify(draft) !== original;
const badge = text => `<div class="badge"><span class="dot" aria-hidden="true"></span>${e(text)}</div>`;
const nav = () => `<nav class="bottomnav" aria-label="メイン"><a href="#home" ${route === 'home' ? 'aria-current="page"' : ''}>${icon('home')}ホーム</a><a href="#reflection" ${route === 'reflection' ? 'aria-current="page"' : ''}>${icon('history')}記録</a><a href="#settings" ${route === 'settings' ? 'aria-current="page"' : ''}>${icon('schedule')}設定</a></nav>`;
function openDialog(title, text, confirmLabel, action) {
  focusReturn = document.activeElement;
  document.querySelector('#dialog-body').innerHTML = `<h2 id="dialog-title">${e(title)}</h2><p>${e(text)}</p><button class="action secondary" data-dialog="cancel">入力を続ける</button><button class="action" data-dialog="confirm">${e(confirmLabel)}</button>`;
  afterDialog = action; dialog.showModal(); dialog.querySelector('button').focus();
}
function dismissDialog() { dialog.close(); afterDialog = undefined; focusReturn?.focus(); }
function go(target, replace = false, allowDraft = false) {
  if (draft && target === `edit-schedule/${draft.id}` && route === 'confirm-schedule') allowDraft = true;
  if (dirty() && !allowDraft && !target.startsWith('confirm-')) {
    openDialog('入力を破棄しますか？', 'まだ保存していない変更があります。保存したスケジュールは変わっていません。', '破棄して移動する', () => { draft = undefined; go(target, replace); }); return;
  }
  if (!allowDraft && !target.startsWith('confirm-')) draft = undefined;
  route = target;
  history[replace ? 'replaceState' : 'pushState']({}, '', `#${target}`);
  render();
}
function startEdit(kind, id) {
  if (draft && draft.id === id && route === 'confirm-schedule') { go(`${kind}/${id}`,false,true); return; }
  const r = state.rules.find(r => r.id === id);
  draft = r ? structuredClone(r) : { id:`new-${state.rules.length + 1}`, name:'', goal:'', days:[1,2,3,4,5], start:'21:00', end:'23:00', apps:['X','YouTube'], enabled:true, reviewed:true };
  original = JSON.stringify(draft); go(`${kind}/${draft.id}`, false, true);
}
function render() {
  let title = '', body = '', parent = 'settings', intro = '';
  const r = selectedRule();
  const permission = state.authorization === 'approved' ? state.needsReview ? '対象の選び直しが必要' : '許可済み' : '許可が必要';
  const summary = !state.rules.length ? '未設定' : state.paused ? 'すべて停止中' : `${state.rules.filter(r=>r.enabled).length}件の有効な設定`;
  const warning = state.authorization !== 'approved' ? notice('制限には許可が必要です', '保存したスケジュールは残っています。', `<a class="plain-action" href="#permissions">許可と再開の手順を見る ›</a>`) : state.needsReview ? notice('アプリを選び直してください', '再許可後は、対象を確認してからご自身で再開できます。', `<a class="plain-action" href="#permissions">再開に必要な確認へ ›</a>`) : state.observation === 'unknown' ? notice('反映状態を確認できません', '保存済みの設定と、実際の制限状態を分けて表示しています。', `<a class="plain-action" href="#permissions">動作確認へ ›</a>`) : '';
  if (route === 'settings') {
    title = '設定'; intro = '自分の時間を、暮らしに合わせて。';
    body = warning + section('時間の使い方', group(link('スケジュール', `${state.rules.length}件・${state.paused ? 'すべて停止中' : '曜日と時間を設定'}`, 'schedules', 'schedule')))
      + section('アプリの動作', group(link('スクリーンタイム', `${permission}・許可と反映状態を確認`, 'permissions', 'shield')))
      + section('記録と安心', group(link('記録とプライバシー', state.pendingImport ? '取込待ちの記録があります' : '保存状況・記録の削除', 'privacy', 'records') + link('使い方とこのアプリについて', '一時解除・停止・記録の違い', 'help', 'help')))
      + `<p class="version">いとま · デザイン検討用</p>`;
  } else if (route === 'schedules') {
    title = 'スケジュール'; intro = 'アプリから離れたい曜日と時間。';
    body = badge(summary) + (state.paused ? notice('すべてのスケジュールを停止中', '設定は残っています。再開するまで、予定の時間になっても制限を開始しません。') : '')
      + (state.rules.length ? group(state.rules.map(r=>link(r.name || '名前のないスケジュール', `${daySummary(r.days)} ${timeSummary(r)}・${r.enabled ? '有効な設定' : '無効な設定'}`, `schedule/${r.id}`)).join('')) : '<p class="empty">まだスケジュールはありません。<br>自分の時間をひとつ決めてみましょう。</p>')
      + section('', button('スケジュールを追加', 'add', false, state.authorization !== 'approved'))
      + (state.authorization !== 'approved' ? note('追加にはスクリーンタイムの許可が必要です。') + group(link('許可を確認する', '', 'permissions')) : '')
      + (state.rules.length ? section('全体の操作', group(link(state.paused ? 'すべてのスケジュールを再開' : 'すべてのスケジュールを停止', state.paused ? '設定と対象を確認して再開' : '設定を残したまま、制限を停止', state.paused ? 'resume' : 'stop'))) : '')
      + note('「有効な設定」は保存内容です。現在の制限状態はホームで確認できます。');
  } else if (route.startsWith('schedule/') && r) {
    parent = 'schedules'; title = r.name || 'スケジュール';
    body = badge(r.enabled ? '有効な設定' : '無効な設定') + (r.goal ? notice('この時間にしたいこと', e(r.goal)) : note('行動目標は未設定です。'))
      + facts([['曜日', daySummary(r.days)],['時間',timeSummary(r)],['対象アプリ',r.apps.join('・')],['一時解除','自分の言葉で理由を入力']])
      + group(link('名前と行動目標', '制限する時間・対象は変わりません', `edit-details/${r.id}`) + link('曜日・時間・対象アプリ', '保存前に影響を確認できます', `edit-schedule/${r.id}`))
      + section('', `<button class="plain-action danger" data-action="delete-rule">このスケジュールを削除</button>`);
  } else if (route.startsWith('edit-details/') || route.startsWith('edit-schedule/')) {
    if (!draft) { startEdit(route.startsWith('edit-details') ? 'edit-details' : 'edit-schedule', route.split('/')[1]); return; }
    const details = route.startsWith('edit-details'); parent = state.rules.some(r=>r.id===draft.id) ? `schedule/${draft.id}` : 'schedules';
    title = details ? '名前と行動目標' : '曜日・時間・対象';
    intro = details ? '時間帯の設定とは別に保存します。' : '確認画面では、まだ反映されません。';
    body = details ? `<div class="fields"><label>スケジュール名（任意）<input data-field="name" value="${e(draft.name)}" maxlength="80" autocomplete="off"><span class="hint">空欄でも保存できます。</span></label><label>この時間にしたいこと（任意）<textarea data-field="goal" maxlength="1000">${e(draft.goal)}</textarea><span class="hint">自分の言葉で、自由に。空欄のままでも使えます。</span></label></div>`
      : `<div class="fields"><div><p>曜日</p><div class="days">${[1,2,3,4,5,6,0].map(d=>`<button class="day" data-day="${d}" aria-label="${'日月火水木金土'[d]}曜日" aria-pressed="${draft.days.includes(d)}">${'日月火水木金土'[d]}</button>`).join('')}</div></div><label>開始時刻<input type="time" data-field="start" value="${e(draft.start)}" required></label><label>終了時刻<input type="time" data-field="end" value="${e(draft.end)}" required></label></div><p id="time-summary" class="note">${e(timeSummary(draft))}</p><div class="section-label">対象アプリ</div><div class="apps">${draft.apps.map(a=>`<span class="chip">${e(a)}</span>`).join('')}</div>${button('対象アプリを選び直す', 'picker', true)}${note('アプリ選択は画面モックです。実装ではiOSの選択画面を使います。')}`;
    body += `<div id="validation" class="note"></div>` + button(details ? '名前と行動目標を保存' : '変更内容を確認', details ? 'save-details' : 'preview-schedule', false, !details && !validateSchedule(draft)) + note(details ? '名前と行動目標だけを保存します。制限や一時解除の期限は変わりません。' : '曜日・時間・対象の変更は、一時解除の期限に影響する場合があります。');
  } else if (route === 'confirm-schedule' && draft) {
    parent = `edit-schedule/${draft.id}`; title = '変更内容の確認';
    body = facts([['曜日',daySummary(draft.days)],['時間',timeSummary(draft)],['対象',draft.apps.join('・')],['一時解除','理由入力']]) + (state.activeGrant ? notice('一時解除への影響', 'このデモでは、変更によりXの一時解除が終了する場合を示しています。実装では保存前に計算した実際の影響を表示します。') : '') + note('設定の保存と、制限の反映は別に確認します。') + button('この内容で保存', 'save-schedule') + button('編集に戻る', 'edit-return', true);
  } else if (['stop','resume'].includes(route)) {
    parent = 'schedules'; const stop = route === 'stop'; title = stop ? 'すべて停止しますか？' : '保存した設定を再開';
    body = facts([['対象',`${state.rules.length}件のスケジュール`],['保存した設定','そのまま残ります'],['進行中の一時解除',stop ? '終了します' : '終了済みの解除は戻りません']])
      + group(state.rules.map(r=>link(r.name || 'スケジュール',`${daySummary(r.days)} ${timeSummary(r)}`,`schedule/${r.id}`)).join(''))
      + note(stop ? 'いとまが設定した時間帯の制限を停止します。他のアプリやiOS側の制限は解除しません。' : '現在の曜日・時間に合わせて反映します。時間外なら次の予定を待ちます。')
      + (!stop && !canResume(state) ? notice('再開の準備が必要です', '許可と対象アプリを確認してください。', '<a class="plain-action" href="#permissions">必要な確認へ ›</a>') : '')
      + button(stop ? 'すべてのスケジュールを停止' : '確認して再開', stop ? 'stop' : 'resume', false, !stop && !canResume(state)) + `<a class="action secondary" href="#schedules">${stop ? '停止せず戻る' : '今は再開しない'}</a>`;
  } else if (route === 'permissions') {
    title = 'スクリーンタイム'; intro = '許可と、保存した設定の反映を確認。';
    body = facts([['スクリーンタイム',permission],['スケジュール',state.paused ? '停止の設定を保存済み' : summary],['制限の反映',state.observation === 'unknown' ? '確認できません' : 'このデモではOS未確認']])
      + (state.authorization !== 'approved' ? notice('許可が必要です', 'アプリを制限するためにスクリーンタイムを使います。再許可後は対象を選び直し、内容を確認してから再開します。', button('スクリーンタイムを許可', 'authorize')) : '')
      + (state.needsReview ? section('再開までの手順', note('1. 各スケジュールの対象を選び直す<br>2. 保存した設定を確認して再開') + group(state.rules.map(r=>link(r.name || 'スケジュール',r.reviewed ? '✓ 対象を選び直しました' : '対象アプリの確認が必要',`review/${r.id}`)).join(''))) : '')
      + (state.paused ? `<a class="action secondary" href="#resume">再開する内容を確認</a>` : '')
      + section('動作がおかしいとき', note('保存した設定に合わせて、いとまの予定登録と反映を再試行します。停止中の設定を勝手に再開する操作ではありません。') + button('保存した設定を再確認・反映する', 'reconcile', true, state.authorization !== 'approved' || state.needsReview))
      + note('ここで確認できるのはいとまが指定した設定です。他の制限が重なると、一時解除後も使えない場合があります。');
  } else if (route.startsWith('review/') && r) {
    parent='permissions'; title='対象アプリを確認'; body=note(`${e(r.name)}の対象を、もう一度選び直してください。以前の許可で選んだ対象は、そのまま使いません。`) + button('対象アプリを選び直す', 'review-picker') + note('選び直しても自動では再開しません。すべての対象を確認した後、再開する内容を確認できます。');
  } else if (route === 'privacy') {
    title='記録とプライバシー'; intro='記録は、この端末内に保存します。';
    body= (state.pendingImport ? notice('記録の取込が必要です', 'まだ一覧に反映されていない記録があります。', '<a class="plain-action" href="#storage">保存状況を確認 ›</a>') : '')
      + group(link('選択の記録を見る','一時解除の理由・操作の履歴','records') + link('保存状況と記録の取込',state.pendingImport ? '取込待ちあり' : '端末内の保存・更新を確認','storage') + link('記録を削除','理由だけ／すべての記録を選択','delete'))
      + note('記録を削除しても、スケジュールと現在の一時解除は変わりません。');
  } else if (route === 'storage') {
    parent='privacy'; title='保存状況と記録の取込'; body=facts([['操作の記録',`${state.records}件`],['保存した理由',`${state.reasons}件`],['保存先','この端末内'],['取込状況',state.pendingImport ? '取込待ちあり' : 'このデモでは取込済み']])
      + note('別の処理で保存された新しい記録を、履歴と振り返りに反映します。新しい制限を開始したり、データを外部へ送る操作ではありません。') + button('新しい記録を取り込む','import',true)
      + note('実装では実ファイル容量・保存上限・未保存の記録も区別して表示します。取込に成功しても、未保存の記録が復元できるとは限りません。');
  } else if (route === 'delete') {
    parent='privacy'; title='削除する記録を選ぶ'; body=`<fieldset style="border:0;padding:0;margin:0"><legend class="note">何を削除するか選んでください。</legend><label class="choice"><input type="radio" name="scope" value="reasons" ${deleteScope==='reasons'?'checked':''}><span>理由の文章だけ<small>一時解除するときに書いた理由。操作履歴と累計は残します。</small></span></label><label class="choice"><input type="radio" name="scope" value="all" ${deleteScope==='all'?'checked':''}><span>すべての記録と累計<small>操作履歴・理由・振り返りの記録を削除します。</small></span></label></fieldset>` + note('どちらもスケジュールと現在の一時解除は変わりません。次の画面で範囲を確認してから削除します。') + button('削除する内容を確認','preview-delete',true);
  } else if (route === 'confirm-delete') {
    parent='delete'; title=deleteScope==='all'?'すべての記録を削除？':'理由の文章を削除？';
    body=facts([['削除するもの',deleteScope==='all'?'操作履歴・理由・振り返りと累計':`保存した理由の文章（${state.reasons}件）`],['残るもの',deleteScope==='all'?'スケジュール・現在の一時解除':'操作履歴・振り返りと累計・スケジュール・現在の一時解除']]) + notice('この操作は元に戻せません','端末内の対象の記録を削除します。制限を停止する操作ではありません。') + button('削除せず戻る','cancel-delete',true) + button(deleteScope==='all'?'すべての記録と累計を削除':'理由の文章だけを削除','confirm-delete',true,false,true);
  } else if (route === 'records') {
    parent='privacy'; title='選択の記録'; intro='確定した理由と操作を振り返る。';
    body=state.records ? group(link('今日 21:20 · Xを一時解除',state.reasons ? '友人への返信を確認するため · 最大5分' : '理由の文章は削除されています','record') + link('今日 21:25 · 一時解除の期限終了','処理の結果を記録','record-end')) : '<p class="empty">保存した操作記録はありません。</p>';
    body+=note('一覧・詳細は架空データの例です。個別削除やページ取得は既存の記録画面の契約を引き継ぎます。');
  } else if (route === 'record' || route === 'record-end') {
    parent='records'; title='操作の記録';body=facts([['対象','X'],['操作',route==='record'?'一時解除':'期限終了'],['日時','今日 21:20'],['理由',state.reasons?'友人への返信を確認するため':'理由の文章はありません']])+note('画面デザイン検討用の架空の記録です。');
  } else if (route === 'home') {
    title='いとま'; intro='いまの時間を、自分のために。'; body=warning + (!state.rules.length ? notice('時間を決めてみましょう','制限する曜日・時間・アプリを選べます。') : state.paused ? notice('スケジュールは停止中です','保存した設定から、ご自身で再開できます。') : `${badge('保存した設定上の時間')}<div class="ring"><small>夜の余白・終了まで</small><strong>1時間30分</strong><small>23:00に終了</small></div>${note('この円は保存した設定上の時間です。実際のOS制限を確認した表示ではありません。')}`)
      + group(link('スケジュールを確認',summary,'schedules'));
  } else if (route === 'reflection') {
    title='記録';intro='これまでの、自分の時間。';body=`<div class="metric"><small>全期間の積み上げ</small><strong>${state.total===null?'—':state.total+'時間'}</strong><span class="row-detail">架空の集計例・実際の集中時間ではありません</span></div>`+section('記録の扱い',group(link('記録とプライバシー','保存状況・理由と記録の削除','privacy')))+note('このデモは設定体験の検討用です。週次・月次の既存画面は作り直しません。');
  } else if (route === 'help') {
    title='使い方とこのアプリ';body=section('操作の違い',notice('一時解除','選んだアプリだけ、決めた時間だけ使えるようにします。')+notice('スケジュールの停止','すべての時間帯の制限を停止します。保存した設定は残ります。')+notice('記録の削除','履歴や理由を削除します。スケジュールや現在の一時解除は変わりません。'))+note('不具合報告・利用規約・プライバシーポリシーなどを将来まとめる場所の提案です。このデモでは外部送信や報告受付を行いません。');
  } else { route='settings';history.replaceState({},'','#settings');render();return; }
  const root=['settings','home','reflection'].includes(route);
  app.innerHTML=`<main class="screen">${!root?`<a class="back" href="#${e(parent)}">‹ ${parent==='settings'?'設定':parent==='schedules'?'スケジュール':'戻る'}</a>`:''}<header class="header"><h2 tabindex="-1">${e(title)}</h2>${intro?`<p class="subtitle">${e(intro)}</p>`:''}</header><div role="status" aria-live="polite">${state.feedback?`<p class="feedback">${e(state.feedback)}</p>`:''}${state.busy?'<p class="feedback">操作結果を確認しています。画面を離れても処理は続きます。</p>':''}</div>${body}</main>${root?nav():''}`;
  app.querySelector('h2').focus({preventScroll:true});
  if(route.startsWith('edit-schedule')) updateValidation();
}
function updateValidation(){
  if (!draft || !route.startsWith('edit-schedule')) return;
  app.querySelector('#time-summary').textContent=timeSummary(draft);
  app.querySelector('#validation').textContent=validateSchedule(draft)?'':'曜日・開始と終了の時刻・対象アプリを選んでください。';
  app.querySelector('[data-action="preview-schedule"]').disabled=!validateSchedule(draft)||state.busy;
}
async function perform(action, success, destination, payload) {
  if(state.busy)return;
  const outcome=document.querySelector('#outcome').value;
  state.busy=true;state.feedback='';render();
  await new Promise(resolve=>setTimeout(resolve,350));
  state.busy=false;
  if(outcome!=='ok'){
    if(outcome==='unknown'&&['stop','resume','schedule','reconcile'].includes(action))state.observation='unknown';
    state.feedback=outcome==='error'?'操作を完了できませんでした。入力と保存済みの設定は残っています。内容を確認して再試行できます。':'操作の結果を確認できません。成功とは扱っていません。実装では結果を照合してから再試行します。';render();return;
  }
  applyOperation(state,action,payload);state.feedback=success+'（画面モック）';
  if(['details','schedule'].includes(action)){draft=undefined;original=undefined;}
  go(destination||route,true,true);
}
app.addEventListener('click',ev=>{
  const a=ev.target.closest('a[href^="#"]');
  if(a){ev.preventDefault();const target=a.hash.slice(1); if(target.startsWith('edit-'))startEdit(target.split('/')[0],target.split('/')[1]);else go(target);return;}
  const d=ev.target.closest('[data-day]');if(d&&draft){const day=Number(d.dataset.day);draft.days=draft.days.includes(day)?draft.days.filter(x=>x!==day):[...draft.days,day];d.setAttribute('aria-pressed',String(draft.days.includes(day)));updateValidation();return;}
  const b=ev.target.closest('[data-action]');if(!b||state.busy)return;
  const action=b.dataset.action;
  const r=selectedRule();
  if(action==='add')startEdit('edit-schedule');
  if(action==='preview-schedule'&&validateSchedule(draft))go('confirm-schedule',false,true);
  if(action==='edit-return')go(`edit-schedule/${draft.id}`,false,true);
  if(action==='save-details')void perform('details','名前と行動目標を保存しました。制限条件は変わりません。',`schedule/${draft.id}`,structuredClone(draft));
  if(action==='save-schedule')void perform('schedule','設定を保存しました。制限の反映は別に確認してください。','schedules',structuredClone(draft));
  if(action==='stop')void perform('stop','停止の設定を保存しました。実際の反映は別に確認してください。','schedules');
  if(action==='resume'&&canResume(state))void perform('resume','再開の設定を保存しました。実際の反映は別に確認してください。','schedules');
  if(action==='authorize')openPicker('スクリーンタイムの許可','このデモでは許可の成功を試します。実際のOS認可は行いません。',()=>void perform('authorize','許可した状態に切り替えました。対象を確認してから再開してください。','permissions'));
  if(action==='reconcile')void perform('reconcile','保存した設定の再確認・反映を試しました。このデモではOSの結果は未確認です。');
  if(action==='import')void perform('import','記録の取込を確認しました。');
  if(action==='picker'||action==='review-picker')openPicker('対象アプリを選ぶ','XとYouTubeを選択する画面モックです。選択だけでは制限を開始しません。',()=>{
    if(action==='review-picker')void perform('review','対象を選び直しました。自動では再開しません。','permissions',r.id);
    else {draft.apps=['X','YouTube'];render();}
  });
  if(action==='preview-delete')go('confirm-delete');
  if(action==='cancel-delete')go('delete');
  if(action==='confirm-delete')void perform(deleteScope==='all'?'delete-all':'delete-reasons',deleteScope==='all'?'すべての記録と累計を削除しました。スケジュールと一時解除は変わりません。':'理由の文章だけを削除しました。操作履歴と累計は残っています。','privacy');
  if(action==='delete-rule'){
    openDialog('このスケジュールを削除？',`${r.name}だけを削除します。他のスケジュールと保存した記録は残ります。一時解除への影響は実装時に計算結果を確認します。`,'このスケジュールを削除',()=>void perform('delete-rule','選んだスケジュールを削除しました。反映状態は別に確認してください。','schedules',r.id));
    dialog.querySelector('[data-dialog="cancel"]').textContent='削除せず戻る';
  }
});
function openPicker(title,text,accept){openDialog(title,text,'この内容で選ぶ',accept);dialog.querySelector('[data-dialog="cancel"]').textContent='キャンセル';}
app.addEventListener('input',ev=>{if(ev.target.dataset.field&&draft){draft[ev.target.dataset.field]=ev.target.value;updateValidation();}});
app.addEventListener('change',ev=>{if(ev.target.name==='scope')deleteScope=ev.target.value;});
dialog.addEventListener('click',ev=>{const action=ev.target.closest('[data-dialog]')?.dataset.dialog;if(!action)return;const fn=afterDialog;dismissDialog();if(action==='confirm')fn?.();});
dialog.addEventListener('cancel',ev=>{ev.preventDefault();dismissDialog();});
window.addEventListener('popstate',()=>{const target=location.hash.slice(1)||'settings';if(dirty()&&!target.startsWith('confirm-')&&!target.startsWith('edit-')){history.pushState({},'',`#${route}`);go(target);return;}route=target;render();});
window.addEventListener('beforeunload',ev=>{if(dirty()){ev.preventDefault();ev.returnValue='';}});
document.querySelector('#scenario').addEventListener('change',ev=>{
  const value=ev.target.value;
  const reset=()=>{state=initialState(value);draft=undefined;original=undefined;go('settings',true,true);};
  if(dirty()) {const old=ev.target.dataset.current||'normal';openDialog('デモを初期化しますか？','入力中の変更と、このデモ内の操作結果が初期化されます。','初期化する',()=>{ev.target.value=value;ev.target.dataset.current=value;reset();});ev.target.value=old;}
  else {ev.target.dataset.current=value;reset();}
});
document.querySelector('#appearance').addEventListener('change',ev=>{document.documentElement.dataset.theme=ev.target.value;});
document.querySelector('#text-size').addEventListener('change',ev=>{document.documentElement.style.setProperty('--scale',ev.target.value);document.documentElement.dataset.textSize=ev.target.value;});
history.replaceState({},'',`#${route}`);render();
