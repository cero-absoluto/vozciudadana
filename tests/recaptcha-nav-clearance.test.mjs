import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import postcss from 'postcss';
const root=postcss.parse(fs.readFileSync('apps/web/src/style.css','utf8'));
test('reCAPTCHA badge clears bottom navigation on mobile without hiding it',()=>{
  let bottom;
  root.walkAtRules('media',m=>{
    if(!/max-width:\s*899px/.test(m.params))return;
    m.walkRules('.grecaptcha-badge',r=>r.walkDecls('bottom',d=>{bottom=d;}));
  });
  assert.ok(bottom,'mobile bottom offset is required');
  assert.equal(bottom.value,'80px');
  assert.ok(bottom.important,'override provider inline bottom position');
  root.walkRules('.grecaptcha-badge',r=>r.walkDecls(d=>{
    assert.ok(!(d.prop==='display'&&d.value==='none'));
    assert.ok(!(d.prop==='visibility'&&d.value==='hidden'));
  }));
});
