import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const css = fs.readFileSync('apps/web/src/style.css', 'utf8');
test('language buttons reserve at least 32px in both dimensions for touch', () => {
  const rules = [...css.matchAll(/\.lang-btn\s*\{([^}]+)\}/g)].map(m => m[1]).join(';');
  for (const dimension of ['min-width', 'min-height']) {
    const values = [...rules.matchAll(new RegExp(dimension + ':\\s*(\\d+(?:\\.\\d+)?)px', 'g'))];
    assert.ok(values.length, dimension + ' must be explicit');
    assert.ok(Number(values.at(-1)[1]) >= 32, dimension + ' must be at least 32px');
  }
});
