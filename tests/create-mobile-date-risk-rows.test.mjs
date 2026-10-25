import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from '@vue/compiler-sfc';
import {parse as template} from '@vue/compiler-dom';
import postcss from 'postcss';
function elements(n){return [...(n.type===1?[n]:[]),...(n.children??[]).flatMap(elements)];}
test('date and risk share a dedicated responsive row without changing their bindings',()=>{
 const {descriptor,errors}=parse(fs.readFileSync('apps/web/src/screens/CreateScreen.vue','utf8'));assert.equal(errors.length,0);
 const nodes=elements(template(descriptor.template.content));const rows=nodes.filter(n=>n.props.some(p=>p.type===6&&p.name==='class'&&p.value?.content.split(/\s+/).includes('create-date-risk')));assert.equal(rows.length,1);
 const fields=elements(rows[0]).filter(n=>['input','select'].includes(n.tag));assert.equal(fields.length,2);
 assert.deepEqual(fields.map(n=>n.props.find(p=>p.type===7&&p.name==='model')?.exp?.content),['form.starts_at','form.risk_level']);
 const css=postcss.parse(fs.readFileSync('apps/web/src/style.css','utf8'));let direction;
 css.walkAtRules('media',m=>{if(!/max-width:\s*520px/.test(m.params))return;m.walkRules('.create-date-risk',r=>r.walkDecls('flex-direction',d=>direction=d.value));});assert.equal(direction,'column');
});
