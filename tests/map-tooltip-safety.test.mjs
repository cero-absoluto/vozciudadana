import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../apps/web/src/components/map/WorldMap.vue',import.meta.url),'utf8');
class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this._text='';this.className='';}
  set textContent(v){this._text=String(v);this.children=[];}
  get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
  set innerHTML(v){throw new Error('HTML parsing forbidden');}
  append(...nodes){this.children.push(...nodes);}
  appendChild(node){this.children.push(node);return node;}
  replaceChildren(...nodes){this._text='';this.children=[...nodes];}
}
test('map tooltip treats country and protest titles as literal text and clears stale content',()=>{
  const match=source.match(/function renderCountryTooltip\(tt, countryName, prot\) \{[\s\S]*?\n\}/);
  assert.ok(match,'dedicated safe renderer exists');
  const context={document:{createElement:tag=>new Element(tag)},fmt:n=>String(n)};
  vm.createContext(context);vm.runInContext(match[0]+';globalThis.render=renderCountryTooltip;',context);
  const tt=new Element();
  const country='<img src=x onerror=alert(1)>';
  const title='<svg/onload=alert(2)>';
  context.render(tt,country,{title,count:7});
  assert.ok(tt.textContent.includes(country));assert.ok(tt.textContent.includes(title));assert.ok(tt.textContent.includes('7'));
  assert.ok(!tt.children.some(n=>n.tag==='img'||n.tag==='svg'));
  context.render(tt,'Other country',null);
  assert.equal(tt.textContent,'Other country');
});
