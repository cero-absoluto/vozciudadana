import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const iso='2026-03-18T12:30:00Z';
function formatter(file,name){const source=fs.readFileSync(file,'utf8');const match=source.match(new RegExp('function '+name+'\\([^)]*\\) \\{[\\s\\S]*?^\\}','m'));assert.ok(match,'formatter exists');const locale={value:'en'};const context={locale,Date};vm.createContext(context);vm.runInContext(match[0]+'\nglobalThis.format='+name+';',context);return {locale,format:context.format,source};}
test('group request dates follow the selected app language and react to language changes',()=>{
 const h=formatter('apps/web/src/screens/MiGrupoScreen.vue','formatFecha');
 assert.match(h.source,/const \{ t, locale \} = useI18n\(\)/);
 for(const lang of ['es','en','fr','zh']){h.locale.value=lang;assert.equal(h.format(iso),new Date(iso).toLocaleDateString(lang,{day:'numeric',month:'short'}));}
 assert.equal(h.format(null),'—');
});
test('detail closure dates follow the app language instead of browser default',()=>{
 const h=formatter('apps/web/src/screens/DetailScreen.vue','fmtCloseDate');
 for(const lang of ['es','en','fr','zh']){h.locale.value=lang;assert.equal(h.format(iso),new Date(iso).toLocaleString(lang,{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}));}
 assert.equal(h.format(null),'');
});
