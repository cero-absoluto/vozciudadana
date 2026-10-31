import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeStoredIndex} from '../apps/api/src/lib/storedIndex.js';
test('every stored index row is in exactly one band, including zero and missing',()=>{
 const values=[0,null,30,60,75,85,100,-1,101,undefined,'85',3.5];const s=summarizeStoredIndex(values.map(fiabilidad=>({fiabilidad})));
 assert.deepEqual(s,{alta:2,media:1,base:1,baja:2,sin_dato:6});assert.equal(Object.values(s).reduce((a,b)=>a+b,0),values.length);
});
