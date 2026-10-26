import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../apps/web/src/components/map/WorldMap.vue',import.meta.url),'utf8');
test('country heat and visible protests follow the selected effective scope',()=>{
 const visible=source.match(/function getVisibleProtests\(\) \{[\s\S]*?\n\}/);const heat=source.match(/function getHeat\(iso\) \{[\s\S]*?\n\}/);assert.ok(visible);assert.ok(heat);
 const national={id:'n',country:'ES',scope:'national',heat:90};const local={id:'l',country:'ES',scope:'local',heat:12};const institutional={id:'i',country:'ES',scope:'local',institutional:true,heat:30};
 const ctx={props:{filter:'local',protests:[national,local,institutional]},ISO_NUM_TO_A2:{'724':'ES'},displayScope:p=>p.institutional?'institutional':p.scope};vm.createContext(ctx);vm.runInContext(visible[0]+'\n'+heat[0]+';globalThis.visible=getVisibleProtests;globalThis.heat=getHeat;',ctx);
 assert.deepEqual(Array.from(ctx.visible(),p=>p.id),['l']);assert.equal(ctx.heat('724'),12);
 ctx.props.filter='institutional';assert.deepEqual(Array.from(ctx.visible(),p=>p.id),['i']);assert.equal(ctx.heat('724'),30);
 ctx.props.filter='global';assert.equal(ctx.visible().length,0);assert.equal(ctx.heat('724'),0);
 ctx.props.filter='all';assert.equal(ctx.visible().length,3);
});
