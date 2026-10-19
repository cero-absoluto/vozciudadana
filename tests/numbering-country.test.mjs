// lib/numberingCountry.js — derivación del país de numeración. Sin red. Datos sintéticos (ejemplos que publica la biblioteca).
// Run: node --test tests/numbering-country.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { deriveNumberingCountry, NUMBERING_META_VERSION, NUMBERING_RESOLUTION } from '../apps/api/src/lib/numberingCountry.js';

const require = createRequire(import.meta.url);
const lpn = require('libphonenumber-js/max');
const examples = require('libphonenumber-js/examples.mobile.json');
const R = NUMBERING_RESOLUTION;

test('la dependencia está fijada exacta y la versión de metadatos se registra con ella', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../apps/api/package.json', import.meta.url), 'utf8'));
  assert.match(pkg.dependencies['libphonenumber-js'], /^\d+\.\d+\.\d+$/, 'sin ^ ni ~');
  assert.equal(NUMBERING_META_VERSION, `libphonenumber-js@${pkg.dependencies['libphonenumber-js']}/max`);
  assert.equal(require('libphonenumber-js/package.json').license, 'MIT');
});

test('resuelto sin código compartido: devuelve un país y solo entonces', () => {
  for (const [n, c] of [['+34600000001', 'ES'], ['+33600000002', 'FR'], ['+4930123456', 'DE'], ['+59899123456', 'UY']]) {
    const d = deriveNumberingCountry(n);
    assert.equal(d.resolution, R.RESOLVED_UNSHARED, n);
    assert.equal(d.country, c, n);
    assert.equal(d.metaVersion, NUMBERING_META_VERSION);
  }
});

test('código de llamada compartido: no se atribuye país (aunque la biblioteca devuelva uno)', () => {
  for (const n of ['+14165550123', '+12015550123', '+18092345678', '+447797712345', '+393123456789', '+358412345678']) {
    const raw = lpn.parsePhoneNumberFromString(n)?.country; // salida real de la biblioteca, solo informativa
    assert.ok(raw, `la biblioteca devuelve un país para ${n}, pero no se usa`);
    const d = deriveNumberingCountry(n);
    assert.equal(d.resolution, R.SHARED_CALLING_CODE, n);
    assert.equal(d.country, null, n);
  }
});

test('sin resultado: código no asignado, texto no E.164, tipos inesperados', () => {
  for (const n of ['+99912345678', 'abc', '', '34600000001', null, undefined, 34600000001, {}]) {
    const d = deriveNumberingCountry(n);
    assert.equal(d.resolution, R.NO_RESULT, String(n));
    assert.equal(d.country, null);
  }
});

test('compartido y sin resultado son valores distintos', () => {
  assert.notEqual(deriveNumberingCountry('+12015550123').resolution, deriveNumberingCountry('+99912345678').resolution);
});

test('conjunto de prueba (ejemplos móviles sintéticos): todo código NO compartido devuelve el país del ejemplo; todo compartido devuelve shared_calling_code', () => {
  // Resultado del conjunto de prueba, NO una garantía general de precisión.
  const byCode = {};
  for (const c of lpn.getCountries()) (byCode[lpn.getCountryCallingCode(c)] ??= []).push(c);
  let unshared = 0; let shared = 0;
  for (const c of lpn.getCountries()) {
    const ex = lpn.getExampleNumber(c, examples); if (!ex) continue;
    const d = deriveNumberingCountry(ex.number);
    if (byCode[lpn.getCountryCallingCode(c)].length > 1) { shared++; assert.equal(d.resolution, R.SHARED_CALLING_CODE, c); assert.equal(d.country, null, c); }
    else { unshared++; assert.equal(d.resolution, R.RESOLVED_UNSHARED, c); assert.equal(d.country, c, c); }
  }
  assert.ok(unshared > 150 && shared > 30, `unshared=${unshared} shared=${shared}`);
});

test('es pura: no modifica la entrada y es determinista', () => {
  const n = '+34600000001';
  assert.deepEqual(deriveNumberingCountry(n), deriveNumberingCountry(n));
  assert.equal(n, '+34600000001');
});
