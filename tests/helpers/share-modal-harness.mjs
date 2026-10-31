// Mount the real Vue SFC with an in-memory host: no browser, network or new dependency.
import fs from 'node:fs';
import vm from 'node:vm';
import * as Vue from 'vue';
import { parse, compileScript } from '@vue/compiler-sfc';

export async function mountShareModal() {
  const listeners = new Map();
  const document = { activeElement: null };
  class Element {
    constructor(tag) {
      // Real DOM elements are not Vue reactive proxies. Preserve host identity
      // so document.activeElement/contains/focus comparisons model that behaviour.
      Vue.markRaw(this);
      this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.props = {}; this.style = {};
    }
    get isConnected() { return this === document.body || Boolean(this.parentNode?.isConnected); }
    get disabled() { return Boolean(this.props.disabled); }
    get hiddenByAncestor() {
      for (let node = this; node; node = node.parentNode) {
        const style = node.props.style;
        const hiddenStyle = typeof style === 'string' ? /display\s*:\s*none/.test(style) : style?.display === 'none';
        const classes = String(node.props.class ?? '').split(/\s+/);
        if (node.props.hidden || hiddenStyle || (classes.includes('modal-overlay') && !classes.includes('open'))) return true;
      }
      return false;
    }
    get offsetParent() { return this.hiddenByAncestor ? null : this.parentNode; }
    get tabIndex() { return Number(this.props.tabindex ?? (['BUTTON','INPUT','SELECT','TEXTAREA'].includes(this.tagName) || this.tagName==='A' && this.hasAttribute('href') ? 0 : -1)); }
    select() { this.selected = true; }
    getClientRects() { return this.isConnected && !this.hiddenByAncestor ? [{}] : []; }
    contains(node) { return node === this || this.children.some(c => c.contains(node)); }
    focus() {
      const native = ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(this.tagName) ||
        (this.tagName === 'A' && this.hasAttribute('href'));
      // tabindex=-1 allows programmatic focus, while an ordinary div does not.
      if (this.isConnected && !this.hiddenByAncestor && !this.disabled && (native || this.hasAttribute('tabindex'))) {
        document.activeElement = this;
        if (typeof this.props.onFocus === 'function') this.props.onFocus({target:this,currentTarget:this});
      }
    }
    getAttribute(name) { return this.props[name] == null ? null : String(this.props[name]); }
    hasAttribute(name) { return this.props[name] != null; }
    querySelectorAll(selector = '') {
      const all = this.children.flatMap(child => [child, ...child.descendants()]);
      if (selector === 'button') return all.filter(n => n.tagName === 'BUTTON');
      if (selector === 'textarea') return all.filter(n => n.tagName === 'TEXTAREA');
      return all.filter(n => !n.disabled && (['BUTTON','INPUT','SELECT','TEXTAREA'].includes(n.tagName) || n.tabIndex >= 0 || n.hasAttribute('href')));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    addEventListener(type, fn) { this.props['on' + type[0].toUpperCase() + type.slice(1)] = fn; }
    removeEventListener(type) { delete this.props['on' + type[0].toUpperCase() + type.slice(1)]; }
  }
  document.body = new Element('body');
  document.activeElement = document.body;
  document.contains = node => document.body.contains(node);
  document.addEventListener = (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); };
  document.removeEventListener = (type, fn) => listeners.get(type)?.delete(fn);
  const insert = (node, parent, anchor = null) => {
    if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1);
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node);
    node.parentNode = parent;
  };
  const remove = node => { if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1); node.parentNode = null; };
  const renderer = Vue.createRenderer({
    insert, remove, createElement: tag => new Element(tag),
    createText: text => Object.assign(new Element('#text'), { text }),
    createComment: text => Object.assign(new Element('#comment'), { text }),
    setText: (node, text) => { node.text = text; },
    setElementText: (node, text) => { node.text = text; node.children = []; },
    parentNode: node => node.parentNode,
    nextSibling: node => node.parentNode?.children[node.parentNode.children.indexOf(node) + 1] ?? null,
    patchProp: (node, key, before, after) => { node.props[key] = after; },
    querySelector: selector => selector === 'body' ? document.body : null,
    setScopeId() {},
  });
  const toasts = [], increments = [], windows = [], route = Vue.reactive({ params: {} });
  const session = new Map();
  const store = Vue.reactive({protests:[],incrementViral:id=>increments.push(id)});
  const translate = (key, params={}) => ({'share.viralMsgEvent':'Event {title}: {url}','share.viralMsg':'Website {url}'}[key] ?? key).replace(/\{(\w+)\}/g,(_,name)=>params[name]??'');
  const navigator = { clipboard: { writeText: () => Promise.resolve() } };
  const ui = Vue.reactive({ showShareModal: false, shareContext: null, shareOpenId: 0, showToast: msg => { toasts.push(msg); } });
  const { descriptor } = parse(fs.readFileSync('apps/web/src/components/shared/ShareModal.vue', 'utf8'));
  let code = compileScript(descriptor, { id: 'share-focus-test', inlineTemplate: true }).content;
  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?/g,
    (_, names) => `const { ${names.replace(/\bas\b/g, ':')} } = Vue;`)
    .replace(/^import[^\n]+from[^\n]+\n/gm, '')
    .replace('export default', 'const Component =');
  const context = vm.createContext({ Vue, document, HTMLElement: Element,
    useI18n: () => ({ t: translate }), useRoute: () => route,
    useUiStore: () => ui, useProtestsStore: () => store, fmt: String,
    sessionStorage: { getItem: key => session.get(key) ?? null }, window: { open: (...args) => { windows.push(args); return {}; } },
    navigator,
  });
  const Component = vm.runInContext(code + '; Component;', context);
  const host = new Element('div'), opener = new Element('button');
  insert(opener, document.body); insert(host, document.body); opener.focus();
  const app = renderer.createApp(Component);
  app.config.globalProperties.$t = translate;
  app.mount(host);
  const flush = async () => { await Vue.nextTick(); await Vue.nextTick(); };
  await flush();
  const dialog = () => document.body.descendants().find(n => n.props.role === 'dialog');
  const controls = () => dialog()?.querySelectorAll('button') ?? [];
  const invoke = (fn, event) => { for (const f of Array.isArray(fn) ? fn : fn ? [fn] : []) f(event); };
  const key = async (value, shiftKey = false) => {
    const target = document.activeElement;
    const event = { key: value, shiftKey, target, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    for (let node = target; node; node = node.parentNode) { event.currentTarget = node; invoke(node.props.onKeydown, event); }
    for (const fn of listeners.get('keydown') ?? []) fn(event);
    if (value === 'Tab' && !event.defaultPrevented) {
      const items=document.body.querySelectorAll('button, [href], input, select, textarea, [tabindex]').filter(n=>n.isConnected && !n.hiddenByAncestor && n.tabIndex >= 0);
      const current=items.indexOf(document.activeElement);
      if(items.length)items[(current+(shiftKey ? -1 : 1)+items.length)%items.length].focus();
    }
    await flush(); return event;
  };
  const click = async node => { invoke(node.props.onClick, { target: node, currentTarget: node }); await flush(); };
  const openSync = (context={id:'7',title:'Synthetic share event'}) => { ui.shareContext=context;ui.shareOpenId+=1;ui.showShareModal=true; };
  return { ui, document, opener, toasts, increments, windows, route, store, session, navigator, dialog, controls, flush, key, click, openSync,
    open: async context => { openSync(context); await flush(); },
    removeOpener: () => remove(opener),
    appendElement: (tag, props = {}, parent = document.body) => { const node = new Element(tag); node.props = props; insert(node, parent); return node; },
    unmount: async () => { app.unmount(); await flush(); },
  };
}
