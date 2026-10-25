import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import postcss from 'postcss';
const css=postcss.parse(fs.readFileSync('apps/web/src/style.css','utf8'));
test('mobile content ends above the fixed reCAPTCHA badge',()=>{
 let margin;css.walkAtRules('media',m=>{if(!/max-width:\s*899px/.test(m.params))return;m.walkRules('.app-main',r=>r.walkDecls('margin-bottom',d=>margin=d.value));});
 assert.equal(margin,'100px');
 let bottom;css.walkAtRules('media',m=>{if(!/max-width:\s*899px/.test(m.params))return;m.walkRules('.grecaptcha-badge',r=>r.walkDecls('bottom',d=>bottom=d.value));});assert.equal(bottom,'80px');
});
