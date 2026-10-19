// Local check: the countdown is re-derived from ends_at, so a stalled/throttled
// timer cannot outlive the real closure. No backend, no network.
// Run: node --test tests/detail-closing-clock.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { setActivePinia, createPinia } from 'pinia';

const server = await createServer({ root: 'apps/web', server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const { useProtestsStore } = await server.ssrLoadModule('/src/stores/protests.js');
test.after(() => server.close());

globalThis.localStorage ??= { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
const realNow = Date.now, realFetch = globalThis.fetch;
test.afterEach(() => { Date.now = realNow; globalThis.fetch = realFetch; });

async function loaded(endsAtMs) {
  globalThis.fetch = async () => new Response(JSON.stringify([
    { id: 'p1', title: 't', scope: 'national', count: 1, ends_at: new Date(endsAtMs).toISOString() },
  ]), { status: 200, headers: { 'content-type': 'application/json' } });
  setActivePinia(createPinia());
  const st = useProtestsStore();
  await st.loadProtests();
  if (!st.protests.length) throw new Error('load failed: ' + st.error);
  return st;
}

test('normal ticking: counts down with the real clock', async () => {
  let now = 1_000_000_000_000; Date.now = () => now;
  const st = await loaded(now + 10_000);
  assert.equal(st.protests[0].timer, 10);
  now += 1000; st.tickTimers();
  assert.equal(st.protests[0].timer, 9);
});

test('stalled ticks (throttled tab / suspended device): one tick after real closure gives timer 0', async () => {
  let now = 1_000_000_000_000; Date.now = () => now;
  const st = await loaded(now + 60_000);
  now += 10 * 60_000; // clock jumps 10 min with zero ticks in between
  st.tickTimers();
  assert.equal(st.protests[0].timer, 0);
  assert.equal(st.openProtests.length, 0);
});

test('partial stall: timer catches up to the real remaining time, never below 0', async () => {
  let now = 1_000_000_000_000; Date.now = () => now;
  const st = await loaded(now + 120_000);
  now += 90_000; st.tickTimers();
  assert.equal(st.protests[0].timer, 30);
});

test('closed stays closed (no resurrection)', async () => {
  let now = 1_000_000_000_000; Date.now = () => now;
  const st = await loaded(now + 5_000);
  now += 6_000; st.tickTimers();
  now -= 6_000; st.tickTimers();
  assert.equal(st.protests[0].timer, 0);
});
