import type { ReflectionSnapshot, ReflectionInspectionWeek, ReflectionPeriod } from '../../modules/itoma-native/src/reflection-model';
import { dayDistance, monday } from '../../src/lib/reflection-landscape';
import { moveDay } from '../../src/lib/history-date';

const daySeconds = 86_400;
const at = (day: string) => Date.parse(day + 'T00:00:00Z') / 1000;
export function landscapeFixture(length = 30, total = 30 * 3600, token = 'reflection-v1:landscape') {
  const latestDay = '2026-11-20', startDay = moveDay(latestDay, 1 - length);
  const start = at(startDay), asOf = at(latestDay) + 20 * 3600;
  const durations = length === 30 ? [20, 25, 0, 50, 120, 190, 135, 65, 25, 0, 30, 95, 145, 230, 150, 55, 30, 15, 20, 90, 170, 220] : undefined;
  const weight = durations?.reduce((sum, value) => sum + value, 0) ?? 1;
  const prefix = (days: number) => {
    const n = Math.min(length, Math.max(days, 0));
    if (!durations) return Math.floor(total * n / length);
    const complete = Math.max(0, n - length + durations.length);
    return Math.floor(total * durations.slice(0, complete).reduce((sum, value) => sum + value, 0) / weight);
  };
  const week = (day: string): ReflectionInspectionWeek => {
    const anchor = monday(day), first = dayDistance(startDay, anchor);
    const days = Array.from({ length: 7 }, (_, i) => moveDay(anchor, i)).filter(value => value <= latestDay).map(value => {
      const i = dayDistance(startDay, value);
      return { day: value, from: at(value), until: Math.min(asOf, at(value) + daySeconds),
        knownSeconds: i >= 0 ? prefix(i + 1) - prefix(i) : undefined, coverage: i >= 0 ? 'recorded' as const : 'notRecorded' as const };
    });
    return { anchor, before: first > 0 ? { day: startDay, from: start, until: at(anchor), knownSeconds: prefix(first), coverage: 'recorded' } : undefined, days };
  };
  const pointCount = Math.min(length, 64);
  const points = Array.from({ length: pointCount }, (_, i) => ({
    at: i === pointCount - 1 ? asOf : start + (i + 1) * (asOf - start) / pointCount,
    cumulativeSeconds: prefix(Math.ceil((i + 1) * length / pointCount)), connected: true,
  }));
  const snapshot = (period: ReflectionPeriod = 'week', day = latestDay, initial = true): ReflectionSnapshot => {
    const anchor = period === 'week' ? monday(day) : day.slice(0, 7) + '-01';
    return {
      version: 1, metricVersion: 'rule-schedule-excluding-unlocks-v1', proofScope: 'ruleScheduleLogs', token,
      historyRevision: '1', observationCount: 1, lastObservedAt: start, incomplete: false, timeZone: 'UTC', asOf,
      total: { day: startDay, from: start, until: asOf, knownSeconds: total, coverage: 'recorded' },
      period, anchor, previousAnchor: period === 'week' ? moveDay(anchor, -7) : undefined, trend: [],
      selected: { day: anchor, from: at(anchor), until: at(anchor) + 7 * daySeconds, knownSeconds: 3600, coverage: 'partial' },
      buckets: period === 'week' ? week(day).days : [week(day).days[0]],
      ...(initial ? { landscape: { startDay, latestDay, points }, inspectionWeek: week(latestDay) } : {}),
    };
  };
  return { token, week, snapshot };
}
