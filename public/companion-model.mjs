// Scenario prototype. No model/API/network/storage is used here.
export const APPS = ['X', 'YouTube'];
export const DAY_BASE = (21 * 60 + 30) * 60000;
export function createState(now = DAY_BASE) {
  return {
    rule: { purpose:'寝る前に、本を少し読む', start:now-30*60000, end:now+90*60000, revision:1 },
    planDraft:{ purpose:'', minutes:60 }, unlockDraft:{ app:'', reason:'' },
    grants:{}, status:'normal', note:'', reflection:'', outcome:null,
  };
}
export function validPlan(draft) { return Boolean(draft.purpose.trim() && draft.purpose.length<=200 && [30,60,90].includes(draft.minutes)); }
export function reviewGrant(state, now) {
  const {app,reason}=state.unlockDraft;
  if(!APPS.includes(app)||!reason.trim()||reason.length>200||state.grants[app]||state.status!=='normal'||now>=state.rule.end)return null;
  const until=Math.min(now+5*60000,state.rule.end);
  return { app, reason:reason.trim(), until, minutes:Math.ceil((until-now)/60000), revision:state.rule.revision };
}
export function confirmPlan(state, now) {
  if(!validPlan(state.planDraft))return false;
  // Explicit confirmation only. Editing resets the rule and ends existing mock grants.
  state.rule={purpose:state.planDraft.purpose.trim(),start:now,end:now+state.planDraft.minutes*60000,revision:state.rule.revision+1};
  state.grants={};state.planDraft={purpose:'',minutes:60};
  state.outcome={type:'planned'};return true;
}
export function confirmGrant(state, now, expectedRevision) {
  if(expectedRevision!==state.rule.revision)return false;
  const proposal=reviewGrant(state,now);if(!proposal)return false;
  state.grants[proposal.app]={until:proposal.until,reason:proposal.reason};
  state.unlockDraft={app:'',reason:''};state.outcome={type:'released',app:proposal.app,until:proposal.until};return true;
}
export function expireGrants(state,now){let changed=false;for(const [app,grant] of Object.entries(state.grants))if(now>=grant.until){delete state.grants[app];changed=true;}return changed;}
export function formatClock(ms){const minutes=Math.floor(ms/60000)%1440;return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;}
export function remainingText(ms){const minutes=Math.max(0,Math.ceil(ms/60000));return minutes>=60?`${Math.floor(minutes/60)}時間${minutes%60?`${minutes%60}分`:''}`:`${minutes}分`;}
export function reflectionReply(hasNote){return hasNote?'聞かせてくれてありがとう。数字だけでは分からない、あなたのひと言として残しておこう。次の夜は、またそのときに決めれば大丈夫。':'今日は、ここまでにしよう。話したいときだけ、またここで。';}
