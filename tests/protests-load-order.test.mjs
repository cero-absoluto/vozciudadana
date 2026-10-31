import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createPinia, setActivePinia } from 'pinia';

const server = await createServer({ root: 'apps/web', server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const { useProtestsStore } = await server.ssrLoadModule('/src/stores/protests.js');
test.after(() => server.close());
const originalFetch = globalThis.fetch;
globalThis.localStorage ??= { getItem() { return null; }, setItem() {}, removeItem() {} };
test.afterEach(() => { globalThis.fetch = originalFetch; });

function setup() {
  setActivePinia(createPinia());
  const pending = [];
  globalThis.fetch = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  return { store: useProtestsStore(), pending };
}
function response(id) {
  return new Response(JSON.stringify([{ id, title: id, scope: 'global', ends_at: new Date(Date.now() + 60000).toISOString() }]), { status: 200 });
}

test('an older response cannot replace the latest requested list', async () => {
  const { store, pending } = setup();
  const older = store.loadProtests();
  const latest = store.loadProtests();
  pending[1].resolve(response('latest')); await latest;
  pending[0].resolve(response('older')); await older;
  assert.deepEqual(store.protests.map(p => p.id), ['latest']);
  assert.equal(store.error, null);
});

test('an older failure cannot hide a successful newer load behind an error', async () => {
  const { store, pending } = setup();
  const older = store.loadProtests();
  const latest = store.loadProtests();
  pending[1].resolve(response('latest')); await latest;
  pending[0].reject(new Error('old network failure')); await older;
  assert.equal(store.error, null);
  assert.equal(store.protests[0].id, 'latest');
});

test('an older completion cannot clear loading while the latest request is pending', async () => {
  const { store, pending } = setup();
  const older = store.loadProtests();
  const latest = store.loadProtests();
  pending[0].resolve(response('older')); await older;
  assert.equal(store.loading, true);
  pending[1].resolve(response('latest')); await latest;
  assert.equal(store.loading, false);
});

test('the latest failure remains visible even when an older request then succeeds', async () => {
  const { store, pending } = setup();
  const older = store.loadProtests();
  const latest = store.loadProtests();
  pending[1].reject(new Error('current network failure')); await latest;
  pending[0].resolve(response('older')); await older;
  assert.equal(store.error, 'API_NETWORK_ERROR');
  assert.equal(store.protests.length, 0);
  assert.equal(store.loading, false);
});
