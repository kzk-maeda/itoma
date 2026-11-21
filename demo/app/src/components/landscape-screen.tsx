import { useMemo, useState, type CSSProperties } from 'react';
import { router } from 'expo-router';
import { ProductNavigation } from '@/components/flow/product-navigation';
import { useFlowTheme } from '@/components/flow/ui';
import { GraphiteColors } from '@/constants/theme';
import { reflectionDuration } from '../../../../modules/itoma-native/src/reflection-model';
import { periodRows, selectedDays, shiftAnchor, shortDate, sumKnown, weekStart } from '../scenarios/records';
import { GROWTH_AS_OF } from '../scenarios/time-growth';
import { durationType, editions, landscapeDays, landscapeSeries } from '../scenarios/time-landscape';
import { LandscapePrint } from './landscape-print';
import './landscape.css';

function paperDate(day: string) { return day.replaceAll('-', '.'); }
function longDate(day: string) { return `${Number(day.slice(5, 7))}月${Number(day.slice(8))}日`; }

function Arrow({ back = false }: { back?: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={back ? 'm14 5-7 7 7 7' : 'm10 5 7 7-7 7'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function PeriodLedger({ days }: { days: ReturnType<typeof landscapeDays> }) {
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [anchors, setAnchors] = useState({ week: weekStart(GROWTH_AS_OF), month: GROWTH_AS_OF.slice(0, 7) + '-01' });
  const anchor = anchors[period], rows = periodRows(days, period, anchor);
  const maximum = Math.max(1, ...rows.map(row => row.seconds ?? 0));
  const periodTotal = sumKnown(selectedDays(days, period, anchor));
  function move(direction: number) {
    const target = shiftAnchor(anchor, period, direction);
    return <button className="leaf-arrow" type="button" aria-label={direction < 0 ? '前の期間' : '次の期間'} disabled={!selectedDays(days, period, target).length} onClick={() => setAnchors({ ...anchors, [period]: target })}><Arrow back={direction < 0} /></button>;
  }
  return <section className="leaf-period" aria-labelledby="period-heading">
    <div className="leaf-section-head"><h2 id="period-heading">期間の内訳</h2>
      <div className="leaf-segment" aria-label="集計期間" role="group">{(['week', 'month'] as const).map(option =>
        <button key={option} type="button" aria-pressed={period === option} onClick={() => setPeriod(option)}>{option === 'week' ? '週' : '月'}</button>)}</div>
    </div>
    <div className="leaf-period-nav"><div><p className="leaf-label">{period === 'week' ? longDate(weekStart(anchor)) + 'からの週' : Number(anchor.slice(0, 4)) + '年' + Number(anchor.slice(5, 7)) + '月'}</p><strong>{periodTotal === undefined ? '未記録' : reflectionDuration(periodTotal)}</strong></div>
      <div className="leaf-arrows">{move(-1)}{move(1)}</div>
    </div>
    {rows.length > 0 ? <ul className="leaf-day-list">{rows.map(row => <li key={row.key}>
      <span>{row.label}</span>
      <div className="leaf-day-track" aria-hidden="true">{row.seconds !== undefined && <i style={{ width: `${row.seconds / maximum * 100}%` }} />}</div>
      <span>{row.seconds === undefined ? '未記録' : reflectionDuration(row.seconds)}{row.partial && row.seconds !== undefined ? '（既知分）' : ''}</span>
    </li>)}</ul> : <p className="leaf-note">この期間の記録はありません。</p>}
  </section>;
}

function TimePrint({ days }: { days: ReturnType<typeof landscapeDays> }) {
  const series = useMemo(() => landscapeSeries(days), [days]);
  const [selection, setSelection] = useState<number | undefined>();
  const last = days.length - 1, index = selection ?? last, current = series[index];
  const total = useMemo(() => sumKnown(days), [days]), historical = index < last;
  const amount = durationType(historical ? current.total : total);
  const partial = historical ? current.partial && current.total !== undefined : series[last]?.partial;
  return <>
    <section className="time-print" aria-labelledby="print-title">
      <div className="print-inside">
        <div className="print-meta"><span>{historical ? 'この日までの累計' : '全期間'}</span>{days.length > 0 && <span className="print-dates">{paperDate(days[0].day)} — {paperDate(current.day)}</span>}</div>
        <h2 id="print-title">重ねた時間</h2>
        <div className="print-amount" data-testid="print-total">
          {amount.prefix && <span className="print-small">{amount.prefix}</span>}<span className="print-number">{amount.number}</span><span className="print-unit">{amount.unit}</span>
          {amount.tail && <span className="print-tail">{['時間', '分'].includes(amount.unit) ? '' : 'と '}{amount.tail}</span>}
        </div>
        {partial && <p className="print-caveat">一部未記録のため、確認できた分の累計です。</p>}
      </div>
      {days.length > 0 ? <>
        <LandscapePrint rows={series} index={index} total={total ?? 0} onSelect={setSelection} />
        <div className="print-axis"><span>{shortDate(days[0].day)}</span><span>{last > 0 ? shortDate(days[last].day) : ''}</span></div>
      </> : <p className="print-empty">制限の適用が記録されると、ここに日々の積み重ねが現れます。</p>}
      {days.length > 0 && <div className="print-imprint"><span className="imprint-line" aria-hidden="true" />線の高さは、制限を適用していた時間の累計</div>}
    </section>
    {current && <section className="leaf-inspect" aria-label="日ごとの記録">
      <div className="leaf-inspect-head"><h2>{longDate(current.day)}<span>の記録</span></h2>
        <div className="leaf-arrows"><button className="leaf-arrow" type="button" aria-label="前日の記録" disabled={index <= 0} onClick={() => setSelection(index - 1)}><Arrow back /></button><button className="leaf-arrow" type="button" aria-label="翌日の記録" disabled={index >= last} onClick={() => setSelection(index + 1)}><Arrow /></button></div>
      </div>
      <p className="leaf-day-value" aria-live="polite" aria-atomic="true">{current.seconds === undefined ? 'この日は未記録です。' : <>
        <strong>{reflectionDuration(current.seconds)}</strong><span>を記録</span>

      </>}{historical && <button className="leaf-latest" type="button" onClick={() => setSelection(undefined)}>最新に戻す</button>}</p>
      <p className="leaf-note">{days.length > 1 ? '図をなぞると、日付をたどれます。' : '制限を適用していた時間の記録です。'}</p>
    </section>}
    <details className="leaf-details"><summary>集計について</summary><div>
      <p>制限が適用されていた時間を合計しています。一時解除中の時間は除いています。</p>
      {total !== undefined && <p>記録全体で{reflectionDuration(total)}です。24時間を1日分、30日を約1か月分、365日を約1年分として表示します。</p>}
    </div></details>
  </>;
}

export function LandscapeScreen({ scene }: { scene?: string }) {
  const theme = useFlowTheme();
  const id = editions.find(option => option.id === scene)?.id ?? 'days';
  const days = useMemo(() => landscapeDays(id), [id]);
  const [settings, setSettings] = useState(false);
  const variables = { '--ink': theme.text, '--muted': theme.muted, '--rule': theme.line, '--paper': theme.surface,
    '--wash': theme.background, '--tint': theme.soft, '--print-ground': theme === GraphiteColors.dark ? theme.background : GraphiteColors.dark.surface,
    '--print-ink': GraphiteColors.dark.text, '--print-quiet': GraphiteColors.dark.muted } as CSSProperties;
  return <div className="leaf-screen" style={variables}>
    <div className="leaf-scroll" data-testid="demo-scroll"><main className="leaf-page">
      <header className="leaf-header"><h1>振り返り</h1><button type="button" className="leaf-demo-button" aria-expanded={settings} onClick={() => setSettings(!settings)}>デモ設定 <span aria-hidden="true">{settings ? '−' : '＋'}</span></button></header>
      {settings && <section className="leaf-scenes" aria-label="デモ設定"><h2>架空の記録を選ぶ</h2><div>{editions.map(option => <button key={option.id} type="button" aria-pressed={id === option.id} onClick={() => { router.setParams({ scene: option.id }); setSettings(false); }}>{option.label}</button>)}</div></section>}
      <TimePrint key={id} days={days} />
      <PeriodLedger key={'period-' + id} days={days} />
    </main></div>
    <ProductNavigation current="reflection" theme={theme} />
  </div>;
}
