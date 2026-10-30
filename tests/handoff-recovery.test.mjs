// Synthetic pipeline acceptance only; never imported by the product.
import test from 'node:test';
import assert from 'node:assert/strict';
import {add} from './fixtures/handoff-recovery/add.mjs';
test('handoff recovery fixture adds finite inputs',()=>{assert.equal(add(2,3),5);assert.equal(add(-2,3),1);assert.equal(add(0,0),0);});
test('handoff recovery fixture rejects non-finite or non-number inputs',()=>{for(const x of [NaN,Infinity,-Infinity,'2',null,undefined]){assert.throws(()=>add(x,1),TypeError);assert.throws(()=>add(1,x),TypeError);}});
