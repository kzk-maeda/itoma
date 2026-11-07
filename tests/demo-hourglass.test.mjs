import assert from 'node:assert/strict';
import test from 'node:test';
import { sandLevels, remainingTime, humanTime, clockTime, MINUTE, BOWL_AREA, bowlAreaBelow } from '../public/hourglass-math.mjs';

test('sand volume corresponds to remaining fraction, conserving the total area',()=>{
  for(const fraction of [0,.01,.25,.5,.75,.99,1]){
    const {upperY,lowerY}=sandLevels(fraction);
    const upperArea=bowlAreaBelow(upperY),lowerArea=BOWL_AREA-bowlAreaBelow(240-lowerY);
    assert.ok(Math.abs(upperArea/BOWL_AREA-fraction)<1e-6);
    assert.ok(Math.abs((upperArea+lowerArea)/BOWL_AREA-1)<1e-10);
  }
});
test('sand is bounded for ended or invalid input, with no negative or excessive volume',()=>{
  assert.deepEqual(sandLevels(-1),sandLevels(0));assert.deepEqual(sandLevels(2),sandLevels(1));assert.deepEqual(sandLevels(NaN),sandLevels(0));
});
test('absolute deadlines do not restart when the view is shown again',()=>{
  const acceptedAt=1000,expiresAt=acceptedAt+5*MINUTE;
  assert.equal(remainingTime(expiresAt,acceptedAt+2*MINUTE),3*MINUTE);
  assert.equal(remainingTime(expiresAt,expiresAt+1),0);
});
test('period and grant labels cover rounding and expiry without implying extra time',()=>{
  assert.equal(humanTime(90*MINUTE),'1時間30分');assert.equal(humanTime(60*MINUTE),'1時間');assert.equal(humanTime(1),'1分未満');assert.equal(humanTime(0),'終了');
  assert.equal(clockTime(5*MINUTE),'5:00');assert.equal(clockTime(-1),'0:00');
});
