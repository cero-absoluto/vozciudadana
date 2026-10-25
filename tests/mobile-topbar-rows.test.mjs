import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import postcss from 'postcss';
const root = postcss.parse(fs.readFileSync('apps/web/src/style.css', 'utf8'));
function declarations(selector) {
  const values = {};
  root.walkAtRules('media', media => {
    if (!/max-width:\s*520px/.test(media.params)) return;
    media.walkRules(selector, rule => rule.walkDecls(d => { values[d.prop] = d.value; }));
  });
  return values;
}
test('narrow topbar gives identity and controls separate full-width rows', () => {
  assert.equal(declarations('.topbar')['flex-wrap'], 'wrap');
  assert.equal(declarations('.topbar .logo')['flex-basis'], '100%');
  assert.equal(declarations('.topbar-right')['width'], '100%');
  assert.equal(declarations('.topbar-right')['justify-content'], 'flex-end');
});
