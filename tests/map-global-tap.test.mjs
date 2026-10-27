import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import { REGION_COORDS } from '../apps/web/src/constants.js';
const source=readFileSync(new URL('../apps/web/src/components/map/WorldMap.vue',import.meta.url),'utf8');
function fixture(filter='all',protests=[{id:'global-1',scope:'global',heat:5}]){
 const match=source.match(/function handleGlobalTap\(e\) \{[\s\S]*?\n\}/);assert.ok(match,'shared global tap handler exists');
 const calls=[];const ctx={props:{filter,protests},canvasEl:{value:{getBoundingClientRect:()=>({left:10,top:20})}},REGION_COORDS,proj:coords=>{assert.deepEqual(coords,[-3,36]);return [50,60];},displayScope:p=>p.scope,emit:(...a)=>calls.push(a)};vm.createContext(ctx);vm.runInContext(match[0]+';globalThis.tap=handleGlobalTap;',ctx);return {ctx,calls};
}
test('global marker hit uses canvas coordinates and selects every overlapping global',()=>{
 const f=fixture('all',[{id:'a',scope:'global'},{id:'b',scope:'global'},{id:'c',scope:'national'}]);assert.equal(f.ctx.tap({clientX:60,clientY:80}),true);assert.equal(f.calls[0][0],'global-click');assert.deepEqual(Array.from(f.calls[0][1]),['a','b']);assert.equal(f.ctx.tap({clientX:200,clientY:200}),false);
});
test('global tap respects scope and never emits an empty selection',()=>{
 const f=fixture('national');assert.equal(f.ctx.tap({clientX:60,clientY:80}),false);assert.equal(f.calls.length,0);
 const empty=fixture('global',[]);assert.equal(empty.ctx.tap({clientX:60,clientY:80}),false);assert.equal(empty.calls.length,0);
});
