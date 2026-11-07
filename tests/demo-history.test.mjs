import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unionMinutes, summarize, createSample, monthCells, duration, addDays } from '../public/history-data.mjs';
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
