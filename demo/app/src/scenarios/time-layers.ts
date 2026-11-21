import { DAY, HOUR, MONTH, YEAR, durationWords, type GrowthScene } from './time-growth';
export const layerUnits = [
  { key: 'year', seconds: YEAR, label: '365日分の束', depth: 28 },
  { key: 'month', seconds: MONTH, label: '30日分の束', depth: 20 },
  { key: 'day', seconds: DAY, label: '1日分', depth: 8 },
  { key: 'hour', seconds: HOUR, label: '1時間の層', depth: 2.5 },
] as const;
export function timeLayers(seconds?: number) {
  let remainder = seconds ?? 0;
  const groups = layerUnits.map(unit => { const count = Math.floor(remainder / unit.seconds); remainder %= unit.seconds; return { ...unit, count }; });
  const items = groups.flatMap(group => Array.from({ length: group.count }, (_, index) => ({ key: `${group.key}-${index}`, unit: group.key as string, seconds: group.seconds, depth: group.depth as number, label: group.label as string, fraction: 1 })));
  if (remainder) items.push({ key: 'fraction', unit: 'fraction', seconds: remainder, depth: 2.5 * remainder / HOUR, label: durationWords(remainder), fraction: remainder / HOUR });
  const depth = items.reduce((sum, item) => sum + item.depth, 0);
  const scale = Math.min(1, 132 / Math.max(1, depth));
  let bottom = 170;
  const drawing = items.map(item => { const height = item.depth * scale, top = bottom - height, result = { ...item, top, bottom }; bottom = top; return result; });
  return { groups: groups.filter(group => group.count > 0), remainder, items: drawing };
}
export function foldMessage(previous: number, next: number) {
  if (next <= previous) return undefined;
  const before = timeLayers(previous).groups, after = timeLayers(next).groups;
  for (const unit of layerUnits.slice(0, 3)) if ((after.find(group => group.key === unit.key)?.count ?? 0) > (before.find(group => group.key === unit.key)?.count ?? 0)) {
    return unit.key === 'year' ? '365日分が、1年分の束になりました。' : unit.key === 'month' ? '30日分が、1か月分の束になりました。' : '24時間の層が、1日分の束になりました。';
  }
  return undefined;
}
export const nextLayerStep = (seconds: number) => seconds >= MONTH ? DAY : HOUR;
export function withAddedTime(scene: GrowthScene, additions: number[]): GrowthScene {
  if (!additions.length || scene.seconds === undefined) return scene;
  const added = additions.reduce((sum, value) => sum + value, 0);
  return { ...scene, after: undefined, label: `累計${durationWords(scene.seconds + added)} · 追加${durationWords(added)}`, seconds: scene.seconds + added };
}
