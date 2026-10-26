import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('participation messages have translations and preserve interpolation fields',()=>{
 const fields={lockNational:['title','time'],lockRegional:['region'],lockGlobal:['title'],geoNational:['country'],geoRegional:['country']};
 for(const locale of ['es','en','fr','zh']){
  const m=JSON.parse(fs.readFileSync(`apps/web/src/locales/${locale}.json`,'utf8')).active;
  for(const [key,params] of Object.entries(fields)){assert.ok(typeof m[key]==='string'&&m[key].trim(),`${locale}: ${key}`);for(const param of params)assert.ok(m[key].includes('{'+param+'}'),`${locale}: ${key} {${param}}`);}
 }
});
