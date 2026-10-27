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
test('counts include every effective scope independently of selected filters and update to zero',()=>{
 const match=source.match(/const scopeCounts = computed\(\(\) => ([\s\S]*?)\);\n/);assert.ok(match);
 const ctx={protests:{openProtests:[{scope:'global'},{scope:'global'},{scope:'regional',dominio_email:'x.org'},{scope:'national'}],filter:'local',countryFilter:'ES'},displayScope};
 ctx.computed=fn=>({get value(){return fn();}});
 vm.createContext(ctx);vm.runInContext('globalThis.counts=computed(() => '+match[1]+')',ctx);
 assert.equal(ctx.counts.value.global,2);
 assert.equal(ctx.counts.value.institutional,1);
 assert.equal(ctx.counts.value.regional||0,0);
 ctx.protests.filter='national';ctx.protests.countryFilter='FR';
 assert.equal(ctx.counts.value.global,2);
 ctx.protests.openProtests=[];
 assert.equal(ctx.counts.value.global||0,0);
});
