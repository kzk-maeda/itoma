export const DAY=86400000;
export const SAMPLE_NOW=(21*60+30)*60000; // A synthetic Monday, independent of host timezone.
export const DAYS=['月','火','水','木','金','土','日'];
export const APPS=[{id:'x',name:'X',mark:'X'},{id:'youtube',name:'YouTube',mark:'▶'},{id:'instagram',name:'Instagram',mark:'◎'},{id:'tiktok',name:'TikTok',mark:'♪'}];
export function createState(){return {draft:{purpose:'',start:'21:00',end:'23:00',days:[0,1,2,3,4]},authorization:'notAsked',selected:[],selectionValid:false,picker:[],profile:null,activation:'off',application:'none',applyResult:'normal',grants:{}};}
export function minutes(text){if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text))return null;const[h,m]=text.split(':').map(Number);return h*60+m;}
export function lengthOf(schedule){const start=minutes(schedule.start),end=minutes(schedule.end);if(start===null||end===null||start===end)return 0;return (end-start+1440)%1440;}
export function validSchedule(draft){return draft.purpose.length<=200&&lengthOf(draft)>=15&&draft.days.length>0&&draft.days.every(day=>Number.isInteger(day)&&day>=0&&day<=6)&&new Set(draft.days).size===draft.days.length;}
export function scheduleLabel(draft){return `${draft.start} — ${minutes(draft.end)<=minutes(draft.start)?'翌':''}${draft.end}`;}
export function daysLabel(days){if(days.length===7)return '毎日';if(days.length===5&&[0,1,2,3,4].every(d=>days.includes(d)))return '平日';return [...days].sort().map(day=>DAYS[day]).join('・');}
export function occurrence(schedule,now){
 if(!validSchedule(schedule))return null;
 const today=Math.floor(now/DAY);let next=null;
 for(let offset=-1;offset<=7;offset++){
  const day=today+offset,weekday=((day%7)+7)%7;
  if(!schedule.days.includes(weekday))continue;
  const start=day*DAY+minutes(schedule.start)*60000,end=start+lengthOf(schedule)*60000;
  if(start<=now&&now<end)return {active:true,start,end};
  if(start>now&&(!next||start<next.start))next={active:false,start,end};
 }
 return next;
}
export function authorize(state,result){if(!['approved','denied'].includes(result))return false;state.authorization=result;state.selectionValid=false;state.activation='off';state.application='none';state.grants={};return true;}
export function confirmSelection(state,ids){if(state.authorization!=='approved'||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!APPS.some(app=>app.id===id)))return false;state.selected=[...ids];state.selectionValid=true;return true;}
export function ready(state){return state.authorization==='approved'&&state.selectionValid&&state.selected.length>0;}
export function saveProfile(state){if(!validSchedule(state.draft))return false;state.profile={...state.draft,purpose:state.draft.purpose.trim(),days:[...state.draft.days],apps:[...state.selected],version:(state.profile?.version??0)+1};state.activation=ready(state)?'enabled':'off';state.application=ready(state)?state.applyResult:'none';state.grants={};return true;}
export function homeState(state,now){if(!state.profile)return {kind:'empty'};if(!ready(state))return {kind:'incomplete'};if(state.activation!=='enabled')return {kind:'confirmation'};if(state.application!=='normal')return {kind:'attention'};const period=occurrence(state.profile,now);return {kind:period?.active?'active':'scheduled',period};}
export function retryApplication(state){if(!ready(state)||!state.profile||state.activation!=='enabled')return false;state.application=state.applyResult;return true;}
export function grantOffer(state,id,reason,now){const home=homeState(state,now);if(home.kind!=='active'||!state.profile.apps.includes(id)||state.grants[id]||!reason.trim()||reason.length>200)return null;const until=Math.min(now+300000,home.period.end);return {id,reason:reason.trim(),until,version:state.profile.version};}
export function confirmGrant(state,id,reason,now,version){const offer=grantOffer(state,id,reason,now);if(!offer||version!==offer.version)return false;state.grants[id]={until:offer.until};return true;}
export function expire(state,now){let changed=false;for(const[id,grant]of Object.entries(state.grants))if(now>=grant.until){delete state.grants[id];changed=true;}return changed;}
export function clock(value){const m=((Math.floor(value/60000)%1440)+1440)%1440;return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;}
export function when(value,now){const difference=Math.floor(value/DAY)-Math.floor(now/DAY);return `${difference===0?'':difference===1?'明日 ':`${DAYS[((Math.floor(value/DAY)%7)+7)%7]}曜日 `}${clock(value)}`;}
export function remaining(value){const m=Math.max(0,Math.ceil(value/60000));return m>=60?`${Math.floor(m/60)}時間${m%60?`${m%60}分`:''}`:`${m}分`;}
