/** Synthetic presentation fixtures, not a duplicate of the native schedule evaluator. */
export const scenarios = [
  { id: 'today', label: '今日の次の予定', clock: '金曜日 19:00', date: '今日', title: '夜の自分時間', time: '21:00〜23:00', apps: ['X', 'Instagram'], goal: '寝る前に、本を読む時間をつくる' },
  { id: 'tomorrow', label: '翌日の予定', clock: '金曜日 23:30', date: '明日', title: '朝のひととき', time: '07:00〜08:00', apps: ['X', 'YouTube'], goal: '朝のコーヒーを、ゆっくり味わう' },
  { id: 'next-week', label: '来週の予定', clock: '金曜日 23:30', date: '11月27日（金）', title: '夜の自分時間', time: '21:00〜23:00', apps: ['X', 'Instagram'], goal: '寝る前に、本を読む時間をつくる' },
  { id: 'no-goal', label: '目標の登録なし', clock: '金曜日 19:00', date: '今日', title: '夜の自分時間', time: '21:00〜23:00', apps: ['X', 'Instagram'], goal: undefined },
  { id: 'none', label: '次の予定なし', clock: '金曜日 23:30', date: undefined, title: undefined, time: undefined, apps: [], goal: undefined },
  { id: 'active', label: '制限中と比較', clock: '金曜日 21:30', date: '今日', title: '夜の自分時間', time: '21:00〜23:00', apps: ['X', 'Instagram'], goal: '寝る前に、本を読む時間をつくる' },
] as const;
export type ScenarioID = typeof scenarios[number]['id'];
export const sampleNow = new Date(2026, 10, 20, 21, 30).getTime();
