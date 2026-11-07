import assert from 'node:assert/strict';
import test from 'node:test';
import { sandLevels, remainingTime, humanTime, clockTime, MINUTE } from '../public/hourglass-math.mjs';

test('sand volume corresponds to remaining fraction, conserving the total area',()=>{
  for(const fraction of [0,.01,.25,.5,.75,.99,1]){
    const {upperY,lowerY}=sandLevels(fraction),h=116-upperY,b=212-lowerY,k=106/176,total=5896;
    const upperArea=14*h+k*h*h,lowerArea=120*b-k*b*b;
    assert.ok(Math.abs(upperArea/total-fraction)<1e-10);
    assert.ok(Math.abs((upperArea+lowerArea)/total-1)<1e-10);
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
