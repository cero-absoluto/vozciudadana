import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {displayScope} from '../apps/web/src/constants.js';
const source=readFileSync(new URL('../apps/web/src/screens/HomeScreen.vue',import.meta.url),'utf8');
function availability(openProtests,extra={}){
 const match=source.match(/const openScopes = computed\(\(\) => ([\s\S]*?)\);\n/);assert.ok(match);
 const ctx={protests:{openProtests,filter:'local',countryFilter:'ES',...extra},displayScope};
 ctx.computed=fn=>({get value(){return fn();}});
 vm.createContext(ctx);vm.runInContext('globalThis.openScopes=computed(() => '+match[1]+')',ctx);return ctx;
}
test('availability follows effective scope of open protests',()=>{
 const c=availability([{scope:'global'},{scope:'regional',dominio_email:'x.org'},{scope:'local'}]);
 assert.deepEqual([...c.openScopes.value].sort(),['global','institutional','local']);
 assert.equal(c.openScopes.value.has('regional'),false);
});
test('availability ignores filter and country selection; empty is neutral',()=>{
 const c=availability([{scope:'national'}]);
 c.protests.filter='global';c.protests.countryFilter='FR';
 assert.deepEqual([...c.openScopes.value],['national']);
 c.protests.openProtests=[];
 assert.equal(c.openScopes.value.size,0);
});
