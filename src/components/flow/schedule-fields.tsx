import { TimeField } from './time-field';
import { timeRange } from '@/lib/schedule-time';
import { Body } from './ui';

export function ScheduleFields({ start, end, disabled, onChange }: {
  start: string; end: string; disabled?: boolean; onChange: (value: { start: string; end: string; nextDay: boolean }) => void;
}) {
  const range = timeRange(start, end);
  const update = (values: { start: string; end: string }) => onChange({ ...values, nextDay: timeRange(values.start, values.end)?.nextDay ?? false });
  return <>
    <TimeField label="開始時刻" value={start} disabled={disabled} onChange={value => update({ start: value, end })} />
    <TimeField label="終了時刻" value={end} disabled={disabled} onChange={value => update({ start, end: value })} />
    {range && <Body>設定する時間：{range.label}</Body>}
    <Body muted>この端末の現地時刻に従います。終了が開始より前なら、翌日に終了します。曜日は開始する日です。同じ時刻は翌日までの24時間です。</Body>
  </>;
}
