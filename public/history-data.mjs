// Synthetic data only. Dates are local calendar dates in Asia/Tokyo.
export const STUDIES = [
  { id: 'calendar', number: '01', title: '余白のカレンダー', short: 'カレンダー', question: 'あの日、どう過ごした？', description: '日付を選んで、その日の予定と解除の記録へ。思い出を手がかりに探せます。', strength: '特定の日を探しやすい', tradeoff: '週全体の変化は、少し見えにくい' },
  { id: 'time', number: '02', title: '時間の積み上げ', short: '積み上げ', question: '時間を決めた、その積み重ね。', description: '上部でこれまでの累計を受け取り、下部の週次・月次で最近のペースを見る。気になる日だけ詳しく振り返れます。', strength: '時間の量と日ごとの違いが分かる', tradeoff: '実際に使えた時間とは区別が必要' },
  { id: 'timeline', number: '03', title: '選択のタイムライン', short: 'タイムライン', question: 'あのとき、何を選んだ？', description: '一時解除や取消を、時間の流れに沿って。アプリや操作結果で絞り、理由までたどれます。', strength: '理由と操作の経緯を確かめやすい', tradeoff: '成果の実感は、数字やメモで補いたい' },
  { id: 'journal', number: '04', title: '余白のノート', short: 'ノート', question: 'その余白に、何が残った？', description: '読めた数ページ、ゆっくりした夜。本人のひと言で、数字だけでは残らない時間を記録します。', strength: '本人にとっての成果を残せる', tradeoff: '自分で書く、ひと手間がある' },
  { id: 'letter', number: '05', title: '週のおたより', short: 'おたより', question: '一週間を、ひと呼吸で。', description: '時間、選択、本人のひと言を、一枚のおたよりに。細かな記録は読みたいときに開きます。', strength: '短い時間で全体を振り返れる', tradeoff: '特定の記録へは、もう一歩必要' },
];
export const WEEK_STARTS = ['2026-10-19', '2026-10-26'];
export const DEFAULT_DATE = '2026-10-30';
export function addDays(day, amount) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function weekday(day) { return ['日', '月', '火', '水', '木', '金', '土'][new Date(`${day}T00:00:00Z`).getUTCDay()]; }
export function shortDate(day) { const [, m, d] = day.split('-'); return `${Number(m)}/${Number(d)}`; }
export function fullDate(day) { return `${shortDate(day)}（${weekday(day)}）`; }
export function duration(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return '記録なし';
  const whole = Math.floor(minutes);
  const hours = Math.floor(whole / 60), rest = whole % 60;
  return hours ? `${hours}時間${rest ? `${rest}分` : ''}` : `${whole}分`;
}
export function unionMinutes(intervals) {
  const sorted = intervals.filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start).map(x => [...x]).sort((a,b) => a[0]-b[0]);
  let total = 0, lastEnd = -Infinity;
  for (const [start, end] of sorted) { total += Math.max(0, end - Math.max(start, lastEnd)); lastEnd = Math.max(lastEnd, end); }
  return total;
}
const knownOutcome = event => ['ended', 'early'].includes(event.outcome);
export function summarize(days, events, start, end) {
  const range = days.filter(day => day.date >= start && day.date <= end);
  const accepted = events.filter(event => event.date >= start && event.date <= end && knownOutcome(event));
  return {
    planned: range.reduce((sum, day) => sum + unionMinutes(day.plans.map(p => [p.start, p.end])), 0),
    days: range.filter(day => day.plans.length > 0).length,
    releases: accepted.length,
    // Per-target elapsed grant windows, not foreground app usage. Never subtract from plans.
    releaseMinutes: accepted.reduce((sum, event) => sum + Math.max(0, event.end - event.start), 0),
  };
}
export function monthCells(year, month) {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay()+6)%7;
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({length: Math.ceil((offset+count)/7)*7}, (_,i) => i < offset || i >= offset+count ? null : addDays(first,i-offset));
}
export function createSample() {
  const lengths = [90,120,60,0,120,90,60,120,90,0,120,120,90,60];
  const days = lengths.map((minutes,index) => ({ date:addDays('2026-10-19',index), plans:minutes ? [{ name:index>11?'休日の余白':'夜の時間', start:index>11?600:1260, end:(index>11?600:1260)+minutes }] : [] }));
  const earlier=[];
  for(let date='2026-09-01';date<'2026-10-19';date=addDays(date,1)){
    const dayOfWeek=new Date(`${date}T00:00:00Z`).getUTCDay();
    const minutes=[60,90,120,0,90,120,90][dayOfWeek];
    earlier.push({date,plans:minutes?[{name:'自分の時間',start:1260,end:1260+minutes}]:[]});
  }
  days.unshift(...earlier);
  const events = [
    {id:'p1',date:'2026-10-20',start:1290,end:1295,app:'X',outcome:'ended',reason:'友人からの連絡を確認する'},
    {id:'p2',date:'2026-10-23',start:1280,end:1283,app:'YouTube',outcome:'early',reason:'料理の手順を確認する'},
    {id:'a1',date:'2026-10-26',start:1284,end:1288,app:'X',outcome:'ended',reason:'友人への返信をする'},
    {id:'a2',date:'2026-10-27',start:1290,end:1295,app:'YouTube',outcome:'ended',reason:'明日の準備に必要な動画を見る'},
    {id:'a3',date:'2026-10-30',start:1272,end:1275,app:'X',outcome:'ended',reason:'待ち合わせ場所を確認する'},
    {id:'a4',date:'2026-10-30',start:1274,end:1279,app:'YouTube',outcome:'ended',reason:'ストレッチの手順を確認する'},
    {id:'a5',date:'2026-10-31',start:608,end:null,app:'X',outcome:'failed',reason:'イベントのお知らせを確認する'},
    {id:'a6',date:'2026-10-31',start:618,end:null,app:'YouTube',outcome:'cancelled',reason:null},
    {id:'a7',date:'2026-11-01',start:620,end:622,app:'YouTube',outcome:'early',reason:'楽器の練習方法を確認する'},
  ];
  const notes = {
    '2026-10-26':'寝る前に、本を少し読めた。続きが楽しみ。',
    '2026-10-29':'何もしない時間も、悪くなかった。',
    '2026-10-30':'急がずに夕飯をつくれた。こういう夜を増やしたい。',
    '2026-11-01':'窓を開けて、ゆっくりコーヒーを飲んだ。',
  };
  return { days, events, notes };
}
export const OUTCOMES = { ended:'期限終了', early:'早めに終了', failed:'解除できず', cancelled:'確定前に取消', unknown:'結果を確認できず' };

export const HISTORY_COVERAGE = { start:'2026-09-01', end:'2026-11-01' };
export function timeRange(anchor, unit, coverage = HISTORY_COVERAGE) {
  if (unit === 'all') return { ...coverage };
  const date = new Date(`${anchor}T00:00:00Z`);
  if (unit === 'week') {
    const start = addDays(anchor, -((date.getUTCDay()+6)%7));
    return { start, end:addDays(start,6) };
  }
  if (unit !== 'month') throw new Error('Unknown time range unit.');
  const year = date.getUTCFullYear(), month = date.getUTCMonth();
  return { start:new Date(Date.UTC(year,month,1)).toISOString().slice(0,10), end:new Date(Date.UTC(year,month+1,0)).toISOString().slice(0,10) };
}
export function shiftTimeAnchor(anchor, unit, amount) {
  if(unit==='week') return addDays(timeRange(anchor,unit).start,amount*7);
  if(unit!=='month') return anchor;
  const date=new Date(`${anchor}T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+amount,1)).toISOString().slice(0,10);
}
export function accumulationData(days, anchor, unit, coverage = HISTORY_COVERAGE) {
  const range=timeRange(anchor,unit,coverage);
  const end=range.end<coverage.end?range.end:coverage.end;
  const beginning=range.start>coverage.start?range.start:coverage.start;
  const totalUntil = date => summarize(days,[],coverage.start,date).planned;
  const buckets=[];
  for(let cursor=range.start;cursor<=range.end;) {
    const bucketEnd=unit==='week'?cursor:timeRange(cursor,'week').end;
    const last=bucketEnd<range.end?bucketEnd:range.end;
    const coveredStart=cursor>coverage.start?cursor:coverage.start;
    const coveredEnd=last<coverage.end?last:coverage.end;
    const available=days.filter(day=>day.date>=coveredStart&&day.date<=coveredEnd);
    const minutes=available.length?summarize(available,[],coveredStart,coveredEnd).planned:null;
    buckets.push({start:cursor,end:last,minutes,cumulative:minutes===null?null:totalUntil(coveredEnd)});
    cursor=addDays(last,1);
  }
  let incomplete=false;
  for(let date=coverage.start;date<=end;date=addDays(date,1))if(!days.some(day=>day.date===date)){incomplete=true;break;}
  return {range,buckets,beginning,end,opening:totalUntil(addDays(range.start,-1)),period:summarize(days,[],beginning,end).planned,total:totalUntil(end),incomplete};
}
