import { useId, useMemo } from 'react';
import { DAY, HOUR, MONTH, YEAR, durationWords } from '../scenarios/time-growth';
import type { LandscapeDay } from '../scenarios/time-landscape';

const width = 400, baseline = 151, height = 159, margin = 5;
const xAt = (i: number, count: number) => count <= 1 ? width / 2 : margin + (width - 2 * margin) * i / (count - 1);

function makePrint(rows: LandscapeDay[], total: number) {
  const runs: { x: number; y: number }[][] = [];
  let penUp = true;
  for (let i = 0; i < rows.length; i++) {
    const value = rows[i].total;
    if (value === undefined) { penUp = true; continue; }
    if (penUp) runs.push([]);
    runs[runs.length - 1].push({ x: xAt(i, rows.length), y: baseline - value / Math.max(total, 1) * 127 });
    penUp = false;
  }
  return runs.map(points => {
    // Keep a bounded silhouette per run. The endpoints bordering a gap are always kept.
    const step = Math.max(1, Math.ceil(points.length / 240));
    const selected = points.filter((_, i) => i % step === 0 || i === points.length - 1);
    const first = selected[0], last = selected[selected.length - 1];
    let ridge = `M ${first.x} ${first.y}`;
    for (let i = 1; i < selected.length; i++) {
      const prev = selected[i - 1], next = selected[i], mid = (prev.x + next.x) / 2;
      ridge += ` C ${mid} ${prev.y}, ${mid} ${next.y}, ${next.x} ${next.y}`;
    }
    return { ridge, area: `${ridge} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`, first, last };
  });
}

// Each impression echoes the outline of this actual record. Only the top edge is quantitative.
const impressions = Array.from({ length: 22 }, (_, index) => (index + 1) / 23);

export function LandscapePrint({ rows, index, total, onSelect }: {
  rows: LandscapeDay[]; index: number; total: number; onSelect: (index: number) => void;
}) {
  const id = 'engraving-' + useId().replace(/[^a-zA-Z0-9-]/g, '');
  const runs = useMemo(() => makePrint(rows, total), [rows, total]);
  const selected = rows[index];
  const x = xAt(index, rows.length);
  const threshold = [{ at: YEAR, name: '約1年分' }, { at: MONTH, name: '約1か月分' }, { at: DAY, name: '1日分' }, { at: HOUR, name: '1時間' }].find(value => value.at <= total);
  const level = threshold && baseline - threshold.at / total * 127;
  const y = baseline - (selected?.total ?? 0) / Math.max(total, 1) * 127;
  return <div className="print-plot">
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        {runs.map(({ ridge }, i) => <path key={i} id={id + '-ridge-' + i} d={ridge} />)}
        <clipPath id={id + '-seen'}><rect width={x} height={height} /></clipPath><clipPath id={id}>{runs.map(({ area }, i) => <path key={i} d={area} />)}</clipPath></defs>
      {threshold && level !== undefined && <g>
        <path d={`M 6 ${level} H ${width - margin}`} stroke="currentColor" opacity=".28" strokeDasharray="1 5" />
        <text x="6" y={level - 6} fill="currentColor" fontSize="11" letterSpacing=".4">{threshold.name}</text>
      </g>}
      {runs.map(({ area, ridge, first, last }, i) => <g key={i}>
        <path d={area} fill="currentColor" opacity=".08" />
        <path d={ridge} fill="none" stroke="currentColor" opacity=".55" strokeWidth="1.6" />
        {first.x === last.x && <circle cx={first.x} cy={first.y} r={2} fill="currentColor" />}
      </g>)}
      <g clipPath={`url(#${id}-seen)`}>{runs.map(({ ridge }, i) => <path key={i} d={ridge} fill="none" stroke="currentColor" strokeWidth="1.6" />)}
      <g clipPath={`url(#${id})`}>
        {runs.map(({ first, last }, i) => <g key={i}>
          {impressions.map(scale => {
            const fade = 1 - scale;
            const spread = last.x - first.x;
            return <use key={scale} href={'#' + id + '-ridge-' + i}
              transform={`translate(${(first.x * .1 + spread * .116) * fade} ${baseline * fade}) scale(${1 - fade * .1} ${scale})`}
              fill="none" stroke="currentColor" strokeOpacity={.55 + scale * .35} strokeWidth={.7 + scale * .3} vectorEffect="non-scaling-stroke" />;
          })}
        </g>)}
      </g></g>
      <path d={`M ${margin} ${baseline + 1} H ${width - margin}`} fill="none" stroke="currentColor" strokeOpacity=".44" strokeWidth=".8" />
      {selected && <g>
        {index < rows.length - 1 && <path d={`M ${x} 12 V ${baseline + 4}`} stroke="currentColor" strokeOpacity=".55" strokeWidth="1" strokeDasharray="2 4" />}
        {selected.total !== undefined && <circle cx={x} cy={y} r="3.6" stroke="var(--print-ground)" strokeWidth="1.8" fill="currentColor" />}
      </g>}
    </svg>
    {rows.length > 1 && <input type="range" aria-label="日付をたどる" aria-valuetext={selected.day + (selected.seconds === undefined ? '、未記録' : '、' + durationWords(selected.seconds) + 'の記録、' + (selected.partial ? '既知分の累計' : '累計') + durationWords(selected.total!))} min={0} max={rows.length - 1} step={1} value={index} onChange={event => onSelect(Number(event.target.value))} />}
  </div>;
}
