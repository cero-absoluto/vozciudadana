import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('apps/web/src/stores/protests.js','utf8');
function harness(){const messages=Object.fromEntries(['es','en','fr','zh'].map(l=>[l,JSON.parse(fs.readFileSync('apps/web/src/locales/'+l+'.json','utf8'))]));const locale={value:'en'};const t=(key,params={})=>key.split('.').reduce((v,k)=>v[k],messages[locale.value]).replace(/\{(\w+)\}/g,(_,k)=>params[k]??'');const device={simCountry:'ES',ipCountry:'ES',getLocks:()=>({})};const context={ref:v=>({value:v}),computed:f=>({get value(){return f();}}),defineStore:(_,f)=>f,useDeviceStore:()=>device,REGIONS:{EU:{name:'Europe'}},fmtTime:()=> '10:00',i18n:{global:{t,locale}}};vm.createContext(context);vm.runInContext(source.replace(/^import .*;\n/gm,'').replace('export const useProtestsStore','const useProtestsStore')+'\nglobalThis.store=useProtestsStore();',context);return {store:context.store,locale,t,device};}
test('participation lock explanations follow language and preserve rejection flags',()=>{
 const h=harness();
 for(const lang of ['es','en','fr','zh']){h.locale.value=lang;
  for(const scope of ['national','regional','global']){h.store.protests.value=[{id:'old',scope,joined:true,region:'EU',title:'Existing',timer:600}];const result=h.store.canJoin({id:'new',scope,region:'EU',country:'ES'});assert.equal(result.ok,false);assert.equal(result.lock,true);const key={national:'lockNational',regional:'lockRegional',global:'lockGlobal'}[scope];assert.equal(result.msg,h.t('active.'+key,{title:'Existing',time:'10:00',region:'Europe'}));}
 }
});
test('geographic explanations translate without changing eligibility or institutional exemption',()=>{
 const h=harness();h.store.protests.value=[];
 for(const lang of ['es','en','fr','zh']){h.locale.value=lang;
  const national=h.store.canJoin({id:'n',scope:'national',country:'FR',countryName:'France'});assert.equal(national.ok,false);assert.equal(national.geo,true);assert.equal(national.msg,h.t('active.geoNational',{country:'France'}));
  const regional=h.store.canJoin({id:'r',scope:'regional',convocatoria_pais:'FR',countryName:'France'});assert.equal(regional.ok,false);assert.equal(regional.geo,true);assert.equal(regional.msg,h.t('active.geoRegional',{country:'France'}));
  assert.equal(h.store.canJoin({id:'i',scope:'regional',dominio_email:'example.edu',convocatoria_pais:'FR'}).ok,true);
  assert.equal(h.store.canJoin({id:'a',scope:'national',country:'ES'}).ok,true);
 }
});
