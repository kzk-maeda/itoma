import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unionMinutes, summarize, createSample, monthCells, duration, addDays, HISTORY_COVERAGE, timeRange, shiftTimeAnchor, accumulationData } from '../public/history-data.mjs';
import { installDemoEntry } from '../scripts/lib/demo-entry.mjs';

test('scheduled time counts interval unions once, independent of target count or releases', () => {
  const days=[{date:'2026-10-30',plans:[{start:60,end:180},{start:120,end:240},{start:80,end:100}]}];
  const events=[{date:'2026-10-30',outcome:'ended',start:70,end:75},{date:'2026-10-30',outcome:'early',start:72,end:74}];
  assert.deepEqual(summarize(days,events,'2026-10-30','2026-10-30'),{planned:180,days:1,releases:2,releaseMinutes:7});
  assert.equal(unionMinutes([[5,3],[NaN,9],[0,10],[10,20]]),20);
});

test('failed, cancelled, unknown and out-of-period operations do not inflate completed releases', () => {
  const data=createSample();
  const result=summarize(data.days,data.events,'2026-10-26','2026-11-01');
  assert.deepEqual(result,{planned:600,days:6,releases:5,releaseMinutes:19});
  const unknown={date:'2026-10-30',outcome:'unknown',start:100,end:null};
  assert.deepEqual(summarize(data.days,[...data.events,unknown],'2026-10-26','2026-11-01'),result);
  assert.deepEqual(summarize([],[],'2026-10-26','2026-11-01'),{planned:0,days:0,releases:0,releaseMinutes:0});
  assert.equal(summarize(data.days,data.events,'2026-10-19','2026-10-25').planned,540);
});

test('calendar uses date-only arithmetic across month boundaries and Monday alignment', () => {
  assert.equal(addDays('2026-10-31',1),'2026-11-01');
  const october=monthCells(2026,10);
  assert.deepEqual(october.slice(0,4),[null,null,null,'2026-10-01']);
  assert.equal(october.filter(Boolean).length,31);
  assert.equal(monthCells(2026,11).filter(Boolean).length,30);
  assert.equal(duration(600),'10時間');
});

test('optional entry replaces the Expo demo root, keeps the named page, and rejects unsafe/missing pages', () => {
  const dir=mkdtempSync(join(tmpdir(),'itoma-demo-entry-'));
  try {
    writeFileSync(join(dir,'index.html'),'old Expo demo');
    assert.equal(installDemoEntry(dir),null);
    assert.equal(readFileSync(join(dir,'index.html'),'utf8'),'old Expo demo');
    writeFileSync(join(dir,'history.html'),'<script src="history.mjs"></script>');
    writeFileSync(join(dir,'demo-entry.json'),JSON.stringify({page:'history.html'}));
    assert.equal(installDemoEntry(dir),'history.html');
    assert.equal(readFileSync(join(dir,'index.html'),'utf8'),readFileSync(join(dir,'history.html'),'utf8'));
    for(const page of ['../outside.html','https://example.com/','/history.html','index.html','missing.html',null]){
      writeFileSync(join(dir,'demo-entry.json'),JSON.stringify({page}));
      assert.throws(()=>installDemoEntry(dir));
    }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});


test('weekly, monthly and all-time totals share an origin without resetting cumulative totals', () => {
  const {days}=createSample();
  const week=accumulationData(days,'2026-10-30','week');
  assert.equal(week.period,600);
  assert.equal(week.opening,4440);
  assert.equal(week.total,5040);
  assert.equal(week.buckets.at(-1).cumulative,5040);
  const september=accumulationData(days,'2026-09-01','month');
  const october=accumulationData(days,'2026-10-30','month');
  const november=accumulationData(days,'2026-11-01','month');
  assert.equal(september.total,2400);
  assert.equal(october.opening,september.total);
  assert.equal(october.period,2580);
  assert.equal(october.total,4980);
  assert.equal(november.opening,october.total);
  assert.equal(november.period,60);
  assert.equal(november.total,5040);
  assert.equal(november.buckets[1].minutes,null);
  assert.equal(november.buckets[1].cumulative,null);
  const all=accumulationData(days,'2026-10-30','all');
  assert.equal(all.total,november.total);
  assert.equal(all.opening,0);
  assert.equal(all.buckets.reduce((sum,row)=>sum+(row.minutes??0),0),all.total);
});

test('month buckets clip crossing weeks and keep unknown days distinct from known zero', () => {
  assert.deepEqual(timeRange('2026-11-01','week'),{start:'2026-10-26',end:'2026-11-01'});
  assert.deepEqual(timeRange('2027-01-01','week'),{start:'2026-12-28',end:'2027-01-03'});
  assert.equal(shiftTimeAnchor('2026-12-31','month',1),'2027-01-01');
  const {days}=createSample();
  const october=accumulationData(days,'2026-10-30','month');
  assert.equal(october.buckets[0].start,'2026-10-01');
  assert.equal(october.buckets[0].end,'2026-10-04');
  assert.equal(october.buckets.at(-1).end,'2026-10-31');
  assert.equal(october.buckets.reduce((sum,row)=>sum+row.minutes,0),october.period);
  const missing=accumulationData(days.filter(day=>day.date!=='2026-10-29'),'2026-10-30','week');
  assert.equal(missing.buckets[2].minutes,0); // Known day with no scheduled interval.
  assert.equal(missing.buckets[3].minutes,null); // Missing day is never a zero point.
  assert.equal(missing.buckets[3].cumulative,null);
  assert.equal(missing.incomplete,true);
  assert.equal(missing.total,4920);
  const empty=accumulationData([],'2026-10-30','week');
  assert.ok(empty.buckets.every(row=>row.minutes===null&&row.cumulative===null));
  assert.equal(empty.incomplete,true);
  assert.deepEqual(timeRange('2026-10-30','all'),HISTORY_COVERAGE);
});
