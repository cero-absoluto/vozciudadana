import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseTemplate } from '@vue/compiler-dom';

const cases = [
  ['VerifyInstitucionalScreen.vue', 2, [
    ['verificacional.emailLabel', 'email'], ['verificacional.otpLabel', 'otp'],
  ]],
];
const locales = Object.fromEntries(['es', 'en', 'fr', 'zh'].map(code =>
  [code, JSON.parse(fs.readFileSync(`apps/web/src/locales/${code}.json`, 'utf8'))]));
function elements(node) {
  return [...(node.type === 1 ? [node] : []), ...(node.children ?? []).flatMap(elements)];
}
function attr(node, name) { return node.props.find(p => p.type === 6 && p.name === name)?.value?.content; }
function bound(node, name) { return node.props.find(p => p.type === 7 && p.name === 'bind' && p.arg?.content === name)?.exp?.content; }
function model(node) { return node.props.find(p => p.type === 7 && p.name === 'model')?.exp?.content; }
function load(file) {
  const { descriptor, errors } = parse(fs.readFileSync('apps/web/src/screens/' + file, 'utf8'));
  assert.equal(errors.length, 0);
  const nodes = elements(parseTemplate(descriptor.template.content));
  return { nodes, fields: nodes.filter(n => ['input', 'select', 'textarea'].includes(n.tag)), labels: nodes.filter(n => n.tag === 'label') };
}
function translatedKeys(source) {
  return [...source.matchAll(/(?:\$t|\bt)\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
}
function accessibleSource(field, data) {
  const direct = bound(field, 'aria-label');
  if (direct) return direct;
  const labelledBy = attr(field, 'aria-labelledby');
  if (labelledBy) return labelledBy.split(/\s+/).map(id => {
    const target = data.nodes.find(n => attr(n, 'id') === id);
    assert.ok(target, 'aria-labelledby target must exist');
    return target.loc.source;
  }).join(' ');
  const id = attr(field, 'id');
  return id ? data.labels.filter(label => attr(label, 'for') === id).map(label => label.loc.source).join(' ') : '';
}
for (const [file, count, mappings] of cases) {
  test(`form labels: ${file} preserves controls and links each visible label to the correct field`, () => {
    const data = load(file);
    assert.equal(data.fields.length, count);
    for (const [key, expectedModel] of mappings) {
      const labels = data.labels.filter(label => translatedKeys(label.loc.source).includes(key));
      assert.equal(labels.length, 1, key);
      const targetId = attr(labels[0], 'for');
      assert.ok(targetId, key + ' must have a for attribute');
      const targets = data.fields.filter(field => attr(field, 'id') === targetId);
      assert.equal(targets.length, 1, key + ' must reference exactly one control');
      assert.equal(model(targets[0]), expectedModel);
    }
  });
  test(`form labels: the institution verification fields in ${file} have translated accessible names in all four languages`, () => {
    const data = load(file);
    for (const [key] of mappings) {
      const label = data.labels.find(label => translatedKeys(label.loc.source).includes(key));
      const targetId = label && attr(label, 'for');
      assert.ok(targetId, key + ' must name its control');
      const field = data.fields.find(field => attr(field, 'id') === targetId);
      assert.ok(field, key + ' must have a target control');
      const keys = translatedKeys(accessibleSource(field, data));
      assert.ok(keys.length > 0, model(field) + ' must be named without relying on a placeholder');
      for (const [locale, messages] of Object.entries(locales)) {
        assert.ok(keys.some(key => {
          const value = key.split('.').reduce((obj, part) => obj?.[part], messages);
          return typeof value === 'string' && value.trim().length > 0;
        }), model(field) + ' needs a translated name in ' + locale);
      }
    }
  });
}
test('form label IDs are unique across the reviewed screens, including conditional country selectors', () => {
  const ids = cases.flatMap(([file]) => load(file).nodes.map(node => attr(node, 'id')).filter(Boolean));
  assert.equal(new Set(ids).size, ids.length);
});
