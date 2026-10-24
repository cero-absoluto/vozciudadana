// Acceptance criteria prepared by the coordinator; implementation belongs to Claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Vue from 'vue';
import { compile } from '@vue/compiler-dom';

const source = fs.readFileSync('apps/web/src/components/layout/BottomNav.vue', 'utf8');
const template = source.match(/<template>([\s\S]*?)<\/template>/)[1];
const render = new Function('Vue', compile(template, { mode: 'function', prefixIdentifiers: true }).code)(Vue);
const routes = ['/', '/create', '/archivo', '/about'];
const keys = ['map', 'create', 'file', 'about'];
const messages = Object.fromEntries(['es', 'en', 'fr', 'zh'].map(locale =>
  [locale, JSON.parse(fs.readFileSync(`apps/web/src/locales/${locale}.json`, 'utf8'))]));
function context(locale, visits) {
  return {
    $t: key => key.split('.').reduce((value, part) => value[part], messages[locale]),
    $router: { push: route => visits.push(route) },
    isActive: route => route === '/',
  };
}
for (const locale of ['es', 'en', 'fr', 'zh']) {
  test(`bottom navigation: accessible names follow ${locale} and all destinations remain intact`, () => {
    const visits = [];
    const buttons = render(context(locale, visits), []).children;
    assert.equal(buttons.length, 4);
    buttons.forEach((button, index) => {
      assert.equal(button.type, 'button');
      assert.equal(button.props['aria-label'], messages[locale].nav[keys[index]]);
      button.props.onClick();
    });
    assert.deepEqual(visits, routes);
  });
}
test('bottom navigation: the same template follows a language change', () => {
  const ctx = context('es', []);
  assert.equal(render(ctx, []).children[0].props['aria-label'], messages.es.nav.map);
  ctx.$t = context('en', []).$t;
  assert.equal(render(ctx, []).children[0].props['aria-label'], messages.en.nav.map);
});
