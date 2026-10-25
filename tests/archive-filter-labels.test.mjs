import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseTemplate } from '@vue/compiler-dom';
const source = fs.readFileSync('apps/web/src/screens/ArchivoScreen.vue', 'utf8');
const { descriptor, errors } = parse(source);
function elements(n) { return [...(n.type === 1 ? [n] : []), ...(n.children ?? []).flatMap(elements)]; }
const nodes = elements(parseTemplate(descriptor.template.content));
const fields = nodes.filter(n => n.tag === 'select');
const mappings = [['filtroTipo', 'archivo.filterTypeLabel'], ['filtroPais', 'archivo.filterCountryLabel'], ['filtroOrden', 'archivo.sortLabel']];
for (const [model, key] of mappings) {
  test(`archive filter ${model} has its own translated accessible name`, () => {
    assert.equal(errors.length, 0);
    assert.equal(fields.length, 3);
    const matches = fields.filter(n => n.props.some(p => p.type === 7 && p.name === 'model' && p.exp?.content === model));
    assert.equal(matches.length, 1);
    const label = matches[0].props.find(p => p.type === 7 && p.name === 'bind' && p.arg?.content === 'aria-label');
    assert.ok(label, model + ' needs a bound aria-label');
    assert.ok(label.exp.content.includes("$t('" + key + "')"));
    for (const locale of ['es', 'en', 'fr', 'zh']) {
      const messages = JSON.parse(fs.readFileSync(`apps/web/src/locales/${locale}.json`, 'utf8'));
      const value = messages.archivo[key.split('.')[1]];
      assert.ok(typeof value === 'string' && value.trim().length > 0, locale + ': ' + key);
    }
  });
}
