import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Vue from 'vue';
import { compile } from '@vue/compiler-dom';

const source = fs.readFileSync('apps/web/src/components/layout/BottomNav.vue', 'utf8');
const template = source.match(/<template>([\s\S]*?)<\/template>/)[1];
const render = new Function('Vue', compile(template, { mode: 'function', prefixIdentifiers: true }).code)(Vue);
const activeExpression = source.match(/const isActive = ([^\n]+);/)[1];
const routes = ['/', '/create', '/archivo', '/about'];
const labelKeys = ['nav.map', 'nav.create', 'nav.file', 'nav.about'];
function setup(path) {
  const route = { path };
  const isActive = new Function('route', 'return ' + activeExpression)(route);
  const ctx = { isActive, $t: key => key, $router: { push: path => { route.path = path; } } };
  return { route, ctx, buttons: () => render(ctx, []).children };
}
function check(buttons, path) {
  assert.equal(buttons.length, 4);
  buttons.forEach((button, index) => {
    const current = button.props['aria-current'];
    if (routes[index] === path) assert.equal(current, 'page');
    else assert.ok([undefined, null, false, 'false'].includes(current));
    assert.equal(button.props['aria-label'], labelKeys[index]);
  });
  assert.equal(buttons.filter(b => b.props['aria-current'] === 'page').length, routes.includes(path) ? 1 : 0);
}
for (const path of [...routes, '/detail/example', '/privacy']) {
  test(`bottom navigation: accessible current page matches route ${path}`, () => {
    check(setup(path).buttons(), path);
  });
}
test('bottom navigation: navigating updates current page and preserves all destinations', () => {
  const nav = setup('/');
  for (let index = 0; index < routes.length; index++) {
    nav.buttons()[index].props.onClick();
    assert.equal(nav.route.path, routes[index]);
    check(nav.buttons(), routes[index]);
  }
});
