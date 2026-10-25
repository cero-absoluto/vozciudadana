import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Vue from 'vue';
import { compile } from '@vue/compiler-dom';

const source = fs.readFileSync('apps/web/src/screens/HomeScreen.vue', 'utf8');
const fragment = source.split('<!-- Overlay bienvenida')[1].split('<!-- World map -->')[0];
const template = fragment.slice(fragment.indexOf('-->') + 3);
const render = new Function('Vue', compile(template, { mode: 'function', prefixIdentifiers: true }).code)(Vue);
const closeSource = source.match(/function cerrarOverlay\(\) \{[\s\S]*?\n\}/)[0];
function clickTargets(node) {
  if (!node || typeof node !== 'object') return [];
  return [...(node.props?.onClick ? [node] : []),
    ...(Array.isArray(node.children) ? node.children.flatMap(clickTargets) : [])];
}
function setup(locale = 'es') {
  const visible = { value: true }, saved = new Map(), cleared = [];
  const close = new Function('showMapOverlay', 'localStorage', 'timerInterval', 'clearInterval',
    closeSource + '; return cerrarOverlay;')(visible, { setItem: (key, value) => saved.set(key, value) }, 23, id => cleared.push(id));
  const messages = JSON.parse(fs.readFileSync(`apps/web/src/locales/${locale}.json`, 'utf8'));
  const ctx = { get showMapOverlay() { return visible.value; }, timerWidth: 50, cerrarOverlay: close,
    $t: key => key.split('.').reduce((value, part) => value[part], messages) };
  return { visible, saved, cleared, tree: () => render(ctx, []), target: () => clickTargets(render(ctx, []))[0] };
}
function keyboard(target, key) {
  const event = { key, preventDefault() {}, stopPropagation() {} };
  const handler = target.props.onKeydown;
  if (target.type === 'button' && !handler) target.props.onClick(); // native browser activation
  else {
    assert.ok(handler, 'custom button must handle keyboard activation');
    for (const fn of Array.isArray(handler) ? handler : [handler]) fn(event);
  }
}
function closed(overlay) {
  assert.equal(overlay.visible.value, false);
  assert.equal(overlay.saved.get('vc_map_intro'), '1');
  assert.deepEqual(overlay.cleared, [23]);
  assert.equal(clickTargets(overlay.tree()).length, 0);
}
for (const locale of ['es', 'en', 'fr', 'zh']) {
  test(`welcome overlay is named, keyboard-focusable and closes with Enter/Space in ${locale}`, () => {
    for (const key of ['Enter', ' ']) {
      const overlay = setup(locale), target = overlay.target();
      assert.ok(target);
      if (target.type !== 'button') {
        assert.equal(target.props.role, 'button');
        assert.equal(Number(target.props.tabindex), 0);
      } else assert.equal(target.props.type, 'button');
      assert.ok(typeof target.props['aria-label'] === 'string' && target.props['aria-label'].trim());
      keyboard(target, key);
      closed(overlay);
    }
  });
}
test('welcome overlay still closes with a click and remembers the dismissal', () => {
  const overlay = setup();
  overlay.target().props.onClick();
  closed(overlay);
});
test('unrelated keyboard keys do not dismiss the welcome overlay', () => {
  const overlay = setup(), target = overlay.target();
  if (target.props.onKeydown) keyboard(target, 'ArrowRight');
  assert.equal(overlay.visible.value, true);
  assert.equal(overlay.saved.size, 0);
});
