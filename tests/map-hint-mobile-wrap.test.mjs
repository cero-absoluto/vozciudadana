import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const css = fs.readFileSync('apps/web/src/style.css','utf8');
function baseRule(source) {
  const rules = [...source.matchAll(/\.map-hint\s*\{([^}]+)\}/g)].map(m => m[1]);
  const base = rules.filter(rule => /position:\s*absolute/.test(rule));
  assert.equal(base.length, 1, 'select exactly one positioned base rule');
  return base[0];
}
test('map hint test selects the positioned base rule instead of the desktop font override', () => {
  assert.equal(baseRule('.map-hint{font-size:16px}.map-hint{position:absolute;white-space:normal}'), 'position:absolute;white-space:normal');
});
test('map hint stays bounded and allows long text to wrap', () => {
  const rule = baseRule(css);
  assert.match(rule, /max-width:\s*calc\(100%\s*-\s*16px\)/);
  assert.match(rule, /white-space:\s*normal/);
  assert.doesNotMatch(rule, /white-space:\s*nowrap/);
  assert.match(rule, /overflow-wrap:\s*anywhere/);
});
