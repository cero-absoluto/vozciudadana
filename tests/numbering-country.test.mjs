// lib/numberingCountry.js — derivación del país de numeración. Sin red. Datos sintéticos (ejemplos que publica la biblioteca).
// Run: node --test tests/numbering-country.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { deriveNumberingCountry, NUMBERING_META_VERSION, NUMBERING_RESOLUTION, NUMBERING_CRITERION } from '../apps/api/src/lib/numberingCountry.js';

const require = createRequire(import.meta.url);
const lpn = require('libphonenumber-js/max');
const examples = require('libphonenumber-js/examples.mobile.json');
const R = NUMBERING_RESOLUTION;

test('la dependencia está fijada exacta y la versión de metadatos se registra con ella', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../apps/api/package.json', import.meta.url), 'utf8'));
  assert.match(pkg.dependencies['libphonenumber-js'], /^\d+\.\d+\.\d+$/, 'sin ^ ni ~');
  assert.equal(NUMBERING_META_VERSION, `libphonenumber-js@${pkg.dependencies['libphonenumber-js']}/max;${NUMBERING_CRITERION}`, 'versión de la biblioteca Y del criterio');
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

test('código compartido, números IDENTIFICABLES por plan: se resuelve solo si un único país los valida (R-N2)', () => {
  // [número sintético, país esperado]. Rangos que los metadatos asignan a un único territorio.
  const cases = [['+14165550123', 'CA'], ['+16135550123', 'CA'], ['+12015550123', 'US'], ['+14155552671', 'US'], ['+17875551234', 'PR'],
    ['+18765551234', 'JM'], ['+18092345678', 'DO'],
    ['+447400123456', 'GB'], ['+447911123456', 'GG'], ['+447797712345', 'JE'], ['+447624123456', 'IM'],
    ['+79123456789', 'RU'], ['+77012345678', 'KZ'], ['+3906698212345', 'VA'], ['+3589123456', 'FI'], ['+358181234567', 'AX'],
    ['+61891621234', 'CC'], ['+4779123456', 'SJ'], ['+5997012345', 'BQ']];
  for (const [n, c] of cases) {
    const d = deriveNumberingCountry(n);
    assert.equal(d.resolution, R.RESOLVED_SHARED_UNIQUE, n); assert.equal(d.country, c, n);
    assert.deepEqual(d.candidates, [c], n);
    assert.equal(lpn.parsePhoneNumberFromString(n)?.country, c, `la biblioteca coincide: ${n}`);
  }
});

test('código compartido, casos territoriales problemáticos (#28): rangos solapados quedan NO resueltos, sin atribuir país', () => {
  // Móviles/ejemplos que los metadatos validan para más de un territorio, o para ninguno.
  const overlapping = [['+393123456789', 'IT/VA'], ['+358412345678', 'AX/FI'], ['+212612345678', 'EH/MA'], ['+61412345678', 'AU/CC/CX'],
    ['+4791234567', 'NO/SJ'], ['+590690123456', 'BL/GP/MF'], ['+18002345678', null]];
  for (const [n, set] of overlapping) {
    const d = deriveNumberingCountry(n);
    assert.equal(d.resolution, R.SHARED_CALLING_CODE, n); assert.equal(d.country, null, n); assert.equal(d.reason, 'several_iso_validate', n);
    if (set) assert.deepEqual(d.candidates.slice().sort(), set.split('/').sort(), n);
    else assert.ok(d.candidates.length > 20, 'los +1 gratuitos los valida todo el plan NANP');
  }
  // la biblioteca devolvería un país en estos casos, pero no basta: se mira el conjunto completo
  for (const n of ['+393123456789', '+358412345678', '+212612345678', '+4791234567', '+18002345678']) assert.ok(lpn.parsePhoneNumberFromString(n)?.country, n);
  // ningún país valida el número (código válido, rango sin asignar): no resuelto, sin país
  for (const n of ['+2125288123456', '+599951234567']) {
    const d = deriveNumberingCountry(n); assert.equal(d.resolution, R.SHARED_CALLING_CODE, n); assert.equal(d.reason, 'no_iso_validates', n); assert.equal(d.country, null, n);
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

test('conjunto de prueba (51 ejemplos móviles de códigos compartidos + el resto): ninguno se resuelve a un país distinto del del ejemplo', () => {
  // Resultado del conjunto de prueba, NO una garantía general de precisión.
  const byCode = {};
  for (const c of lpn.getCountries()) (byCode[lpn.getCountryCallingCode(c)] ??= []).push(c);
  const tally = { unshared: 0, sharedResolved: 0, sharedUnresolved: 0 };
  for (const c of lpn.getCountries()) {
    const ex = lpn.getExampleNumber(c, examples); if (!ex) continue;
    const d = deriveNumberingCountry(ex.number);
    if (byCode[lpn.getCountryCallingCode(c)].length > 1) {
      if (d.resolution === R.RESOLVED_SHARED_UNIQUE) { tally.sharedResolved++; assert.equal(d.country, c, `${c} resuelto a otro país`); }
      else { tally.sharedUnresolved++; assert.equal(d.resolution, R.SHARED_CALLING_CODE, c); assert.equal(d.country, null, c); }
    } else { tally.unshared++; assert.equal(d.resolution, R.RESOLVED_UNSHARED, c); assert.equal(d.country, c, c); }
  }
  assert.deepEqual(tally, { unshared: 194, sharedResolved: 36, sharedUnresolved: 15 });
});

test('la lista de candidatos sale de los metadatos, no de la declaración: la derivación solo recibe el número', () => {
  assert.equal(deriveNumberingCountry.length, 1);
});

test('es pura: no modifica la entrada y es determinista', () => {
  const n = '+34600000001';
  assert.deepEqual(deriveNumberingCountry(n), deriveNumberingCountry(n));
  assert.equal(n, '+34600000001');
});
