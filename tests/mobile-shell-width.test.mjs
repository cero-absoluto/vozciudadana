import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync('apps/web/src/App.vue', 'utf8');
const base = source.match(/#app-shell\s*\{([^}]+)\}/)?.[1];
test('mobile app shell explicitly fits the parent width despite auto horizontal margins', () => {
  assert.ok(base);
  assert.match(base, /(?:^|;)\s*width:\s*100%\s*;/);
  assert.match(base, /max-width:\s*520px\s*;/);
  assert.match(base, /min-width:\s*0\s*;/);
});
