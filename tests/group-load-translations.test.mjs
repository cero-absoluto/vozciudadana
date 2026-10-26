import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('group loading, error and retry messages exist in every supported locale',()=>{
 for(const locale of ['es','en','fr','zh']){
  const data=JSON.parse(fs.readFileSync(`apps/web/src/locales/${locale}.json`,'utf8'));
  for(const key of ['loading','loadError','retry'])assert.ok(typeof data.migrupo[key]==='string'&&data.migrupo[key].trim(),`${locale}: migrupo.${key}`);
 }
});
