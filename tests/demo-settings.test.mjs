import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialState, applyOperation, canResume, validateSchedule, timeSummary } from '../public/settings-model.mjs';
import { installDemoEntry } from '../scripts/lib/demo-entry.mjs';

test('deleting reasons retains records, accumulated time, rules and current temporary grant', () => {
  const s = initialState(), before = structuredClone(s);
  applyOperation(s, 'delete-reasons');
  assert.equal(s.reasons, 0);
  for (const key of ['records', 'total', 'rules', 'activeGrant', 'paused']) assert.deepEqual(s[key], before[key]);
  applyOperation(s, 'delete-all');
  assert.equal(s.records, 0); assert.equal(s.total, null);
  assert.deepEqual(s.rules, before.rules); assert.equal(s.activeGrant, before.activeGrant);
});
test('reauthorization and per-schedule review never restart restriction; explicit resume follows all reviews', () => {
  const s = initialState('denied'); applyOperation(s, 'authorize');
  assert.equal(canResume(s), false); assert.equal(s.paused, true);
  applyOperation(s, 'review', s.rules[0].id); assert.equal(canResume(s), false);
  applyOperation(s, 'review', s.rules[1].id); assert.equal(canResume(s), true); assert.equal(s.paused, true);
  applyOperation(s, 'resume'); assert.equal(s.paused, false); assert.notEqual(s.observation, 'applied');
  assert.equal(s.activeGrant, false);
});
test('stop retains schedules and records, ends grants; resume never revives them', () => {
  const s = initialState(), before = structuredClone(s);
  applyOperation(s, 'stop'); assert.equal(s.paused, true); assert.equal(s.activeGrant, false);
  assert.deepEqual(s.rules, before.rules); assert.equal(s.records, before.records);
  applyOperation(s, 'resume'); assert.equal(s.activeGrant, false);
});
test('editing names and goals has no schedule, activation or grant side effects', () => {
  const s = initialState(), before = structuredClone(s);
  applyOperation(s, 'details', { id:'night', name:'', goal:'<script>test</script>' });
  assert.equal(s.rules[0].name, '');
  for (const key of ['days','start','end','apps','enabled']) assert.deepEqual(s.rules[0][key], before.rules[0][key]);
  assert.equal(s.activeGrant, before.activeGrant); assert.equal(s.paused, before.paused);
});
test('invalid or missing times, no weekdays and no targets cannot pass confirmation; overnight time is explicit', () => {
  const s = initialState().rules[0]; assert.equal(validateSchedule(s), true);
  for (const patch of [{ start:'' }, { end:'24:00' }, { days:[] }, { apps:[] }]) assert.equal(validateSchedule({ ...s, ...patch }), false);
  assert.equal(timeSummary({ ...s, start:'23:00', end:'02:00' }), '23:00〜翌02:00');
  assert.equal(timeSummary({ ...s, end:s.start }), '21:00〜翌21:00（24時間）');
});
test('demo root uses selected HTML and preserves relative assets; absent config preserves original index', () => {
  const dir = mkdtempSync(join(tmpdir(),'itoma-settings-entry-'));
  try {
    writeFileSync(join(dir,'index.html'),'original'); assert.equal(installDemoEntry(dir), null);
    writeFileSync(join(dir,'demo-entry.json'),JSON.stringify({ page:'settings-study.html' }));
    assert.throws(()=>installDemoEntry(dir), /not exported/);
    writeFileSync(join(dir,'settings-study.html'),'<script src="settings.mjs"></script>');
    assert.equal(installDemoEntry(dir),'settings-study.html'); assert.equal(readFileSync(join(dir,'index.html'),'utf8'),readFileSync(join(dir,'settings-study.html'),'utf8'));
    for (const page of ['../outside.html','index.html','https://example.com/x.html','/x.html']) {
      writeFileSync(join(dir,'demo-entry.json'),JSON.stringify({ page })); assert.throws(()=>installDemoEntry(dir), /static HTML/);
    }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
