// #35 — La API se construye en Railway con Root Directory = /apps/api: el contexto de build NO contiene el
// lockfile de la raíz. Estas pruebas (locales, sin red) fijan lo que hace reproducible ese build.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { deriveApiLock } from '../scripts/sync-api-lock.mjs';
import { checkBuildEnv } from '../apps/api/scripts/check-build-env.mjs';

const require = createRequire(import.meta.url);
const semver = require('semver');
const repo = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const apiPkg = json('apps/api/package.json');
const rootLock = json('package-lock.json');
const apiLock = json('apps/api/package-lock.json');

test('E1 el lockfile de la API es exactamente el cierre derivado del lockfile raíz (mismas versiones, resolved e integrity)', () => {
  assert.equal(read('apps/api/package-lock.json'), JSON.stringify(deriveApiLock(rootLock, apiPkg), null, 2) + '\n',
    'desincronizado: ejecuta `node scripts/sync-api-lock.mjs` tras cambiar dependencias');
  for (const [k, v] of Object.entries(apiLock.packages)) {
    if (k === '') continue;
    const r = rootLock.packages[k];
    assert.ok(r, `${k} no está en el lockfile raíz`);
    assert.deepEqual([v.version, v.resolved, v.integrity], [r.version, r.resolved, r.integrity], k);
  }
});

test('E2 la entrada raíz del lock de la API coincide con package.json (npm ci aborta si no) y no arrastra el frontend', () => {
  assert.deepEqual(apiLock.packages[''].dependencies, apiPkg.dependencies);
  assert.equal(apiLock.name, apiPkg.name);
  const webOnly = ['vue', 'vite', 'd3', 'pinia', 'jspdf', 'vue-router', 'vue-i18n', 'topojson-client'];
  for (const n of webOnly) assert.equal(`node_modules/${n}` in apiLock.packages, false, n);
  assert.equal('apps/web' in apiLock.packages, false);
});

test('E3 ninguna versión bloqueada de la API exige un Node distinto de 22.x (el que se fija)', () => {
  for (const [k, v] of Object.entries(apiLock.packages)) {
    const range = v.engines?.node;
    if (!range) continue;
    for (const probe of ['22.0.0', '22.22.0']) assert.ok(semver.satisfies(probe, range, { includePrerelease: false }), `${k} exige node ${range}`);
  }
});

test('E4 Node 22 fijado con .nvmrc (sin engines: evita avisos EBADENGINE en el workflow de Pages, que usa Node 20 sobre el workspace raíz)', () => {
  assert.equal(read('apps/api/.nvmrc').trim(), '22');
  assert.equal(apiPkg.engines, undefined);
  assert.equal(rootLock.packages['apps/api'].engines, undefined);
});

test('E5 railway.json: la construcción comprueba el entorno y luego instala congelado; el arranque no cambia', () => {
  const r = json('apps/api/railway.json');
  assert.equal(r.build.builder, 'NIXPACKS');
  assert.equal(r.build.buildCommand, 'node scripts/check-build-env.mjs && npm ci --omit=dev');
  assert.equal(r.deploy.startCommand, 'node src/server.js');
  assert.equal(r.deploy.healthcheckPath, '/health');
});

test('E6 checkBuildEnv: falla con Node 18/20 o sin lockfile; pasa con 22 y 24', () => {
  assert.deepEqual(checkBuildEnv({ nodeVersion: '22.22.0', hasLock: true }), []);
  assert.deepEqual(checkBuildEnv({ nodeVersion: '24.1.0', hasLock: true }), []);
  assert.match(checkBuildEnv({ nodeVersion: '18.20.5', hasLock: true })[0], /Node 18\.20\.5/);
  assert.match(checkBuildEnv({ nodeVersion: '20.11.0', hasLock: true })[0], />=22/);
  assert.match(checkBuildEnv({ nodeVersion: '22.22.0', hasLock: false })[0], /package-lock/);
  assert.equal(checkBuildEnv({ nodeVersion: '18.0.0', hasLock: false }).length, 2);
});

test('E7 contexto de build equivalente a Railway: copiando SOLO apps/api, el script pasa con lock y falla sin él; la raíz no interviene', () => {
  const ctx = fs.mkdtempSync(path.join(os.tmpdir(), 'api-ctx-'));
  try {
    fs.cpSync(path.join(repo, 'apps/api'), ctx, { recursive: true, filter: (s) => !s.includes('node_modules') });
    assert.equal(fs.existsSync(path.join(ctx, '..', 'package-lock.json')), false);
    let r = spawnSync(process.execPath, ['scripts/check-build-env.mjs'], { cwd: ctx, encoding: 'utf8' });
    assert.equal(r.status, major() >= 22 ? 0 : 1, r.stderr + r.stdout);
    fs.rmSync(path.join(ctx, 'package-lock.json'));
    r = spawnSync(process.execPath, ['scripts/check-build-env.mjs'], { cwd: ctx, encoding: 'utf8' });
    assert.equal(r.status, 1); assert.match(r.stderr, /package-lock/);
  } finally { fs.rmSync(ctx, { recursive: true, force: true }); }
});
function major() { return Number(process.versions.node.split('.')[0]); }
