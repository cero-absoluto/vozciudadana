import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { REGION_COORDS } from '../apps/web/src/constants.js';
const source=readFileSync(new URL('../apps/web/src/components/map/WorldMap.vue',import.meta.url),'utf8');
function fixture(reduceMotion=false) {
 const match=source.match(/function drawGlobalParallel\(vis, now\) \{[\s\S]*?\n\}/);
 assert.ok(match);
 const lines=[],colors=[];
 const ctx={save(){},beginPath(){},stroke(){colors.push(this.strokeStyle);},restore(){}};
 const sandbox={ctx,REGION_COORDS,reduceMotion,displayScope:p=>p.scope,gp:line=>lines.push(line)};
 vm.createContext(sandbox);vm.runInContext(match[0]+';globalThis.draw=drawGlobalParallel',sandbox);
 return {draw:sandbox.draw,lines,colors,ctx};
}
test('one 2px green parallel spans all longitudes at the marker latitude',()=>{
 const f=fixture();f.draw([{scope:'global'},{scope:'global'}],0);
 assert.equal(f.lines.length,1);assert.equal(f.ctx.lineWidth,2);
 const points=f.lines[0].coordinates;
 assert.equal(points[0][0],-180);assert.equal(points.at(-1)[0],180);
 assert.ok(points.every(p=>p[1]===REGION_COORDS.global[1]));
 assert.match(f.colors[0],/^rgba\(76,255,164,/);
});
test('no parallel without visible globals; reduced motion is steady',()=>{
 const f=fixture(true);f.draw([{scope:'national'}],0);assert.equal(f.lines.length,0);
 f.draw([{scope:'global'}],0);f.draw([{scope:'global'}],1800);
 assert.equal(f.colors[0],f.colors[1]);
 const pulse=fixture();pulse.draw([{scope:'global'}],0);pulse.draw([{scope:'global'}],1800);
 assert.notEqual(pulse.colors[0],pulse.colors[1]);
});
