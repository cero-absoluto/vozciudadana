import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as d3 from 'd3';

// Exercise the actual component's projection and event handlers without a DOM
// or downloading the world atlas. Country selection is counted independently.
const source = fs.readFileSync('apps/web/src/components/map/WorldMap.vue', 'utf8');
const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
  .replace(/^import .*;\s*$/gm, '');
function map(width, height) {
  const handlers = {};
  let resize, mounted, selections = 0;
  const parent = { clientWidth: width, clientHeight: height };
  const canvas = {
    parentElement: parent, style: {},
    getContext: () => ({}),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: parent.clientWidth }),
    addEventListener: (name, handler) => { handlers[name] = handler; },
  };
  const context = vm.createContext({
    ref: () => ({ value: canvas }), watch() {},
    onMounted: fn => { mounted = fn; }, onUnmounted() {},
    useI18n: () => ({ t: x => x }),
    defineProps: () => ({ protests: [], height }),
    defineEmits: () => () => { selections++; },
    d3: { ...d3, json: () => ({ then() {} }), geoContains: () => true },
    topojson: { feature: () => ({ features: [{ id: '470', properties: { name: 'Malta' } }] }) },
    ISO_NUM_TO_A2: { '470': 'MT' },
    ResizeObserver: class { constructor(fn) { resize = fn; } observe() {} },
    document: { addEventListener() {} }, window: { innerWidth: width },
    setTimeout: fn => fn(), cancelAnimationFrame() {},
  });
  vm.runInContext(script, context);
  mounted();
  const run = code => vm.runInContext(code, context);
  run('zoom = 6; offX = -530; offY = 380; buildProj(); worldData = {};');
  const centre = () => Array.from(run('proj.invert([W / 2, H / 2])'));
  const fire = (name, event = {}) => handlers[name]({ preventDefault() {}, ...event });
  return { run, centre, fire, parent, resize: () => resize(), selections: () => selections };
}
function sameCentre(a, b) {
  a.forEach((value, i) => assert.ok(Math.abs(value - b[i]) < 1e-8, `${a} != ${b}`));
}
test('a later location signal updates initial framing until the user moves', () => {
  const m = map(390, 220);
  m.run("globalThis.framed = []; frameCountry = country => framed.push(country); props.homeCountry = 'MT'; autoFrame();");
  m.run("props.homeCountry = 'NL'; autoFrame(); autoFrame();");
  assert.deepEqual(Array.from(m.run('framed')), ['MT', 'NL']);
  m.run("userMoved = true; props.homeCountry = 'ES'; autoFrame();");
  assert.deepEqual(Array.from(m.run('framed')), ['MT', 'NL']);
});
for (const [label, width, height] of [['desktop', 1100, 500], ['mobile', 390, 220]]) {
  test(`${label}: buttons and off-centre wheel keep geographic centre, including zoom limits`, () => {
    const m = map(width, height), initial = m.centre();
    for (let i = 0; i < 50; i++) { m.run('zoomIn()'); sameCentre(initial, m.centre()); }
    assert.equal(m.run('zoom'), 100);
    for (let i = 0; i < 60; i++) { m.run('zoomOut()'); sameCentre(initial, m.centre()); }
    assert.equal(m.run('zoom'), 0.7);
    m.fire('wheel', { clientX: 5, clientY: 10, deltaY: -1 });
    sameCentre(initial, m.centre());
    m.fire('wheel', { clientX: width - 5, clientY: height - 5, deltaY: 1 });
    sameCentre(initial, m.centre());
    assert.equal(m.selections(), 0);
  });
  test(`${label}: pinch keeps centre and lifting fingers never selects a country`, () => {
    const m = map(width, height), initial = m.centre();
    const touches = [{ clientX: 20, clientY: 30 }, { clientX: 80, clientY: 30 }];
    m.fire('touchstart', { touches });
    m.fire('touchmove', { touches: [touches[0], { clientX: 140, clientY: 30 }] });
    sameCentre(initial, m.centre());
    m.fire('touchend', { touches: [touches[0]], changedTouches: [touches[1]] });
    m.fire('touchend', { touches: [], changedTouches: [touches[0]] });
    assert.equal(m.selections(), 0);
    sameCentre(initial, m.centre());
  });
  test(`${label}: resize preserves explored centre and reset still returns to world`, () => {
    const m = map(width, height), initial = m.centre();
    m.parent.clientWidth = width * 0.75;
    m.parent.clientHeight = height * 1.2;
    m.resize();
    sameCentre(initial, m.centre());
    assert.equal(m.run('zoom'), 6);
    m.run('resetView()');
    sameCentre([0, 0], m.centre());
    assert.equal(m.run('zoom'), 1);
  });
}
