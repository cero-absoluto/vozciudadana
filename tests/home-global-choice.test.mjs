import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../apps/web/src/screens/HomeScreen.vue',import.meta.url),'utf8');
function fixture(){
 const match=source.match(/function onGlobalClick\(ids\) \{[\s\S]*?\n\}/);assert.ok(match);
 const opened=[];const ctx={protests:{filter:'local',countryFilter:'ES'},tab:{value:'queue'},globalChoiceIds:{value:['old']},clearCountryFilter(){ctx.protests.countryFilter=null;ctx.globalChoiceIds.value=[];},openDetail:id=>opened.push(id)};
 vm.createContext(ctx);vm.runInContext(match[0]+';globalThis.select=onGlobalClick;',ctx);return {ctx,opened};
}
test('overlapping globals require an explicit choice and clear the country filter',()=>{
 const f=fixture();f.ctx.select(['a','b']);assert.equal(f.ctx.protests.filter,'global');assert.equal(f.ctx.protests.countryFilter,null);assert.equal(f.ctx.tab.value,'active');assert.deepEqual(Array.from(f.ctx.globalChoiceIds.value),['a','b']);assert.equal(f.opened.length,0);
});
test('single global opens directly and discards a stale multi-choice',()=>{
 const f=fixture();f.ctx.select(['a']);assert.deepEqual(f.opened,['a']);assert.equal(f.ctx.globalChoiceIds.value.length,0);
});
