import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../apps/web/src/components/map/WorldMap.vue',import.meta.url),'utf8');
function fixture(json){
 const match=source.match(/async function loadWorldMap\(\) \{[\s\S]*?\n\}/);assert.ok(match,'map loading has a dedicated lifecycle-aware function');
 let draws=0;
 const ctx={d3:{json},mapLoading:{value:false},mapLoadError:{value:false},worldMapDisposed:false,worldData:null,document:{hidden:false},autoFrame(){},drawFrame(){draws++;}};
 vm.createContext(ctx);vm.runInContext(match[0]+';globalThis.load=loadWorldMap;',ctx);return {ctx,draws:()=>draws};
}
const topology={type:'Topology',objects:{countries:{type:'GeometryCollection',geometries:[]}},arcs:[]};
test('map download failure can recover with a manual retry and concurrent loads are ignored',async()=>{
 let calls=0,resolve;
 const f=fixture(()=>{calls++;return calls===1?Promise.reject(new Error('offline')):new Promise(r=>resolve=r);});
 await f.ctx.load();assert.equal(f.ctx.mapLoadError.value,true);assert.equal(f.ctx.mapLoading.value,false);
 const pending=f.ctx.load();await f.ctx.load();assert.equal(calls,2);assert.equal(f.ctx.mapLoading.value,true);
 resolve(topology);await pending;assert.equal(f.ctx.mapLoadError.value,false);assert.equal(f.ctx.mapLoading.value,false);assert.equal(f.draws(),1);
});
test('map loading never starts drawing after component disposal',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>resolve=r));const pending=f.ctx.load();f.ctx.worldMapDisposed=true;resolve(topology);await pending;assert.equal(f.draws(),0);
});
