import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Vue from 'vue';
import { compile } from '@vue/compiler-dom';

const source = fs.readFileSync('apps/web/src/components/layout/AppTopbar.vue', 'utf8');
const template = source.match(/<div class="lang-switcher">[\s\S]*?<\/div>/)[0];
const langs = new Function('return ' + source.match(/const langs = (\[[\s\S]*?\]);/)[1])();
const setLangSource = source.match(/function setLang\(code\) \{[\s\S]*?\n\}/)[0];
const render = new Function('Vue', compile(template, { mode: 'function', prefixIdentifiers: true }).code)(Vue);
const codes = ['es', 'en', 'fr', 'zh'];
const names = ['Español', 'English', 'Français', '中文'];
const labels = ['ES', 'EN', 'FR', '中文'];
function buttons(node) {
  if (!node || typeof node !== 'object') return [];
  return node.type === 'button' ? [node] : (Array.isArray(node.children) ? node.children.flatMap(buttons) : []);
}
for (const selected of codes) {
  test(`language selector: names and selected state in ${selected}; changing language still updates and saves choice`, () => {
    const ui = { lang: selected }, locale = { value: selected }, saved = new Map();
    const storage = { setItem: (key, value) => saved.set(key, value) };
    const setLang = new Function('locale', 'ui', 'localStorage', setLangSource + '; return setLang;')(locale, ui, storage);
    const ctx = { langs, ui, setLang };
    const rendered = buttons(render(ctx, []));
    assert.equal(rendered.length, 4);
    rendered.forEach((button, i) => {
      assert.equal(button.props['aria-label'], names[i]);
      assert.equal(button.props['aria-pressed'], codes[i] === selected);
      assert.equal(button.props.lang, codes[i]);
      assert.equal(button.children, labels[i]);
    });
    const next = (codes.indexOf(selected) + 1) % codes.length;
    rendered[next].props.onClick();
    assert.equal(ui.lang, codes[next]);
    assert.equal(locale.value, codes[next]);
    assert.equal(saved.get('vc_lang'), codes[next]);
    const updated = buttons(render(ctx, []));
    assert.equal(updated.filter(b => b.props['aria-pressed'] === true).length, 1);
    assert.equal(updated[next].props['aria-pressed'], true);
  });
}
