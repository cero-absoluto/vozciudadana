import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const css = fs.readFileSync('apps/web/src/style.css','utf8');
const rule = css.match(/\.map-hint\s*\{([^}]+)\}/)?.[1] ?? '';
test('map hint stays bounded and allows long text to wrap', () => {
  assert.match(rule, /max-width:\s*calc\(100%\s*-\s*16px\)/);
  assert.match(rule, /white-space:\s*normal/);
  assert.doesNotMatch(rule, /white-space:\s*nowrap/);
  assert.match(rule, /overflow-wrap:\s*anywhere/);
});
