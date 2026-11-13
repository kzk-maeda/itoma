export function initialState(scenario = 'normal') {
  const rule = (id, name, goal, days, start, end) => ({ id, name, goal, days, start, end, apps: ['X', 'YouTube'], enabled: true, reviewed: scenario !== 'review' });
  const rules = [rule('night', '夜の余白', '本を読んで、ゆっくり過ごす', [1,2,3,4,5], '21:00', '23:00'), rule('morning', '休日の朝', '', [6,0], '09:00', '10:00')];
  if (scenario === 'many') for (let n = 3; n <= 8; n++) rules.push(rule(`rule-${n}`, `自分の時間 ${n}`, '', [n % 7], '12:00', '13:00'));
  return { rules: scenario === 'empty' ? [] : rules, authorization: scenario === 'denied' ? 'denied' : 'approved',
    paused: ['paused','review','denied'].includes(scenario), needsReview: scenario === 'review',
    observation: scenario === 'unknown' ? 'unknown' : 'unverified',
    records: scenario === 'empty' ? 0 : 24, reasons: scenario === 'empty' ? 0 : 8, total: scenario === 'empty' ? null : 84,
    pendingImport: scenario === 'gap', activeGrant: !['empty','paused','review','denied'].includes(scenario), feedback: '', busy: false };
}
export const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export function timeSummary(rule) { return `${rule.start}〜${rule.end <= rule.start ? '翌' : ''}${rule.end}${rule.end === rule.start ? '（24時間）' : ''}`; }
export function daySummary(days) { return days.length === 7 ? '毎日' : days.map(d => '日月火水木金土'[d]).join('・'); }
export function validateSchedule(draft) { return !!draft && draft.days.length > 0 && draft.apps.length > 0 && /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.end); }
export function canResume(s) { return s.authorization === 'approved' && !s.needsReview && s.rules.some(r => r.enabled); }
export function applyOperation(s, action, payload) {
  if (action === 'stop') { s.paused = true; s.activeGrant = false; s.observation = 'unverified'; }
  if (action === 'resume' && canResume(s)) { s.paused = false; s.observation = 'unverified'; }
  if (action === 'authorize') { s.authorization = 'approved'; s.needsReview = s.rules.length > 0; s.rules.forEach(r => r.reviewed = false); s.paused = true; }
  if (action === 'review') { s.rules.find(r => r.id === payload).reviewed = true; s.needsReview = s.rules.some(r => !r.reviewed); }
  if (action === 'delete-reasons') s.reasons = 0;
  if (action === 'delete-all') { s.reasons = 0; s.records = 0; s.total = null; s.pendingImport = false; }
  if (action === 'import') s.pendingImport = false;
  if (action === 'delete-rule') s.rules = s.rules.filter(r => r.id !== payload);
  if (action === 'details') { const r = s.rules.find(r => r.id === payload.id); r.name = payload.name; r.goal = payload.goal; }
  if (action === 'schedule') { const index = s.rules.findIndex(r => r.id === payload.id); if (index < 0) s.rules.push(structuredClone(payload)); else s.rules[index] = structuredClone(payload); s.observation = 'unverified'; }
  // The mock never claims to have verified actual Screen Time enforcement.
  if (action === 'reconcile') s.observation = 'unverified';
  return s;
}
