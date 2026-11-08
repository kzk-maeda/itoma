import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DAY_BASE,createState,validPlan,reviewGrant,confirmPlan,confirmGrant,expireGrants} from '../public/companion-model.mjs';
import {installDemoEntry} from '../scripts/lib/demo-entry.mjs';

test('a purpose and duration remain drafts until the person confirms',()=>{
 const s=createState();const original={...s.rule};s.planDraft={purpose:'  何もしないで休む  ',minutes:30};
 assert(validPlan(s.planDraft));assert.deepEqual(s.rule,original);
 assert(confirmPlan(s,DAY_BASE));assert.equal(s.rule.purpose,'何もしないで休む');assert.equal(s.rule.end,DAY_BASE+1800000);
 assert.equal(s.rule.revision,original.revision+1);assert.equal(s.planDraft.purpose,'');assert(!confirmPlan(s,DAY_BASE));
 assert(!validPlan({purpose:' \n',minutes:60}));assert(!validPlan({purpose:'自分の時間',minutes:17}));
});

test('free text reasons are required but their content is never scored or classified',()=>{
 for(const reason of ['友人に返信する','なんとなく見たい','休みたい','<img src=x onerror=alert(1)>']){
  const s=createState();s.unlockDraft={app:'YouTube',reason};const offer=reviewGrant(s,DAY_BASE);
  assert(offer);assert.equal(offer.reason,reason);assert.deepEqual(s.grants,{});
 }
 const s=createState();s.unlockDraft={app:'X',reason:' \n '};assert.equal(reviewGrant(s,DAY_BASE),null);
 s.unlockDraft.reason='x'.repeat(201);assert.equal(reviewGrant(s,DAY_BASE),null);
});

test('confirmation caps deadlines at the rule end and refuses stale/duplicate requests',()=>{
 const s=createState();s.unlockDraft={app:'X',reason:'用事'};const late=s.rule.end-120000;
 assert.equal(reviewGrant(s,late).minutes,2);assert(!confirmGrant(s,late,s.rule.revision+1));
 assert(confirmGrant(s,late,s.rule.revision));assert.equal(s.grants.X.until,s.rule.end);
 assert(!confirmGrant(s,late,s.rule.revision));assert.equal(reviewGrant(s,s.rule.end),null);
});

test('different apps have independent absolute deadlines across visits and expiry',()=>{
 const s=createState();s.unlockDraft={app:'X',reason:'返信'};assert(confirmGrant(s,DAY_BASE,1));const xEnd=s.grants.X.until;
 s.unlockDraft={app:'YouTube',reason:'手順確認'};assert(confirmGrant(s,DAY_BASE+60000,1));const yEnd=s.grants.YouTube.until;
 assert.equal(s.grants.X.until,xEnd);assert(yEnd>xEnd);assert(expireGrants(s,xEnd));assert(!s.grants.X);assert.equal(s.grants.YouTube.until,yEnd);
 assert(expireGrants(s,yEnd));assert.deepEqual(s.grants,{});
});

test('uncertain/failed states never silently create a successful unlock',()=>{
 for(const status of ['unknown','failed']){const s=createState();s.status=status;s.unlockDraft={app:'X',reason:'用事'};assert.equal(reviewGrant(s,DAY_BASE),null);assert(!confirmGrant(s,DAY_BASE,1));assert.deepEqual(s.grants,{});}
});

test('the demo root opens the scenario page and rejects invalid/missing entry files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'itoma-companion-'));
 try{writeFileSync(join(dir,'index.html'),'Expo');assert.equal(installDemoEntry(dir),null);
 writeFileSync(join(dir,'companion.html'),'<h1>Companion</h1>');writeFileSync(join(dir,'demo-entry.json'),JSON.stringify({page:'companion.html'}));
 assert.equal(installDemoEntry(dir),'companion.html');assert.equal(readFileSync(join(dir,'index.html'),'utf8'),'<h1>Companion</h1>');
 for(const page of ['../escape.html','https://example.com','index.html','missing.html']){writeFileSync(join(dir,'demo-entry.json'),JSON.stringify({page}));assert.throws(()=>installDemoEntry(dir));}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
