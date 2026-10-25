import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import postcss from 'postcss';
const css=postcss.parse(fs.readFileSync('apps/web/src/style.css','utf8'));
function mobile(selector){const values={};css.walkAtRules('media',m=>{if(!/max-width:\s*520px/.test(m.params))return;m.walkRules(selector,r=>r.walkDecls(d=>values[d.prop]=d.value));});return values;}
test('create controls may shrink within their flex columns',()=>{
  assert.equal(mobile('#s-create .fg')['min-width'],'0');
  const fields=mobile('#s-create .fg input, #s-create .fg textarea, #s-create .fg select');
  assert.equal(fields['min-width'],'0');assert.equal(fields.width,'100%');assert.equal(fields['max-width'],'100%');
});
