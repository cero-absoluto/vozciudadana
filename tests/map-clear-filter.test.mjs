import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Vue from 'vue';
import { compile } from '@vue/compiler-dom';

const source = fs.readFileSync('apps/web/src/components/map/WorldMap.vue', 'utf8');
const template = source.match(/<div class="map-hint" id="map-hint">[\s\S]*?<\/div>/)[0];
const render = new Function('Vue', compile(template, { mode: 'function', prefixIdentifiers: true }).code)(Vue);
function controls(node) {
  if (!node || typeof node !== 'object') return [];
  const children = Array.isArray(node.children) ? node.children.flatMap(controls) : [];
  return node.props?.onClick ? [node, ...children] : children;
}
function text(node) {
  if (typeof node === 'string') return node;
  if (!node || typeof node !== 'object') return '';
  return Array.isArray(node.children) ? node.children.map(text).join('') : typeof node.children === 'string' ? node.children : '';
}
for (const locale of ['es', 'en', 'fr', 'zh']) {
  test(`map clear filter is a named native button, pointer-operable and emits once in ${locale}`, () => {
    const messages = JSON.parse(fs.readFileSync(`apps/web/src/locales/${locale}.json`, 'utf8'));
    const events = [];
    const ctx = {
      countryFilterName: 'Malta',
      $t: key => key.split('.').reduce((value, part) => value[part], messages),
      $emit: (...args) => events.push(args),
    };
    const tree = render(ctx, []);
    const buttons = controls(tree);
    assert.equal(buttons.length, 1);
    const button = buttons[0];
    assert.equal(button.type, 'button', 'native button supplies focus and Enter/Space activation');
    assert.equal(button.props.type, 'button', 'must not submit a surrounding form');
    assert.ok(text(button).includes(messages.map.clearFilter));
    const style = button.props.style;
    const pointerEvents = typeof style === 'string' ? /pointer-events\s*:\s*auto/.test(style) :
      (style?.pointerEvents ?? style?.['pointer-events']) === 'auto';
    assert.ok(pointerEvents, 'child must override pointer-events:none inherited from map-hint');
    assert.notEqual(button.props.tabindex, -1);
    button.props.onClick();
    assert.deepEqual(events, [['clear-country']]);
    assert.ok(text(tree).includes('Malta'));
    const empty = render({ ...ctx, countryFilterName: null }, []);
    assert.equal(controls(empty).length, 0);
    assert.ok(text(empty).includes(messages.map.hint));
  });
}
