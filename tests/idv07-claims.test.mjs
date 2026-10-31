import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildEvidentialScope} from '../apps/api/src/lib/evidentialScope.js';
test('regional scope never asserts a numbering-country requirement it does not enforce',()=>{
 const r=buildEvidentialScope({scope:'regional',country:'ES',country_name:'Spain',count:2});
 assert.ok(!r.demonstrates.some(x=>x.key==='demonstrates.sim_country'));
 assert.ok(!r.methods.some(x=>x.key==='methods.sim_country'));
 const n=buildEvidentialScope({scope:'national',country:'ES',country_name:'Spain',count:2});assert.ok(n.demonstrates.some(x=>x.key==='demonstrates.sim_country'));
});
for(const locale of ['es','en','fr','zh'])test('identifier and number-country wording is present without changing country placeholders: '+locale,()=>{
 const d=JSON.parse(readFileSync('apps/web/src/locales/'+locale+'.json','utf8'));
 assert.ok(d.informe.sealOne.length>30);assert.ok(d.evidence.demonstrates.sim_country.includes('{country}'));
 assert.deepEqual(d.evidence.demonstrates.sim_country.match(/\{\w+\}/g),['{country}']);
});
