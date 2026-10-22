// H7 — comparación sintética de dos fuentes de país por prefijo/plan de numeración.
// NO es una dependencia del repositorio: la biblioteca se instala aparte, solo para esta medición.
//   mkdir /tmp/lpn && cd /tmp/lpn && npm init -y && npm i libphonenumber-js@1.12.10
//   LPN_DIR=/tmp/lpn node docs/proposals/h7-evidence/compare-numbering-sources.mjs > docs/proposals/h7-evidence/numbering-comparison.json
// Datos: los números son los ejemplos SINTÉTICOS móviles que publica la propia biblioteca (no son números reales de personas).
// Sin red ni SMS. Mide cobertura y ambigüedad de la fuente, NO la identidad del usuario ni la nacionalidad.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(process.env.LPN_DIR + '/');
const lpn = require('libphonenumber-js/max');
const examples = require('libphonenumber-js/examples.mobile.json');
const pkg = require('libphonenumber-js/package.json');

// Fuente A: tabla country_codes sembrada en el repositorio (dial_code entero, 66 filas).
const sql = fs.readFileSync(new URL('../../../supabase/migrations/20260503_country_codes.sql', import.meta.url), 'utf8');
const table = {}; let m; const re = /\('([A-Z]{2})',\s*(\d+),/g;
while ((m = re.exec(sql))) (table[m[2]] ??= []).push(m[1]);
const tableCountries = new Set(Object.values(table).flat());

const all = lpn.getCountries();

// ── Fuente B, SALIDA REAL de la biblioteca (sin interpretar) ────────────────
// raw.returned_same_iso:      parsePhoneNumberFromString(e164).country == país del ejemplo
// raw.returned_other_iso:     devolvió otro ISO (la biblioteca no expone candidatos: getPossibleCountries() devuelve 1)
// raw.no_result:              country indefinido
// ── Clasificación ADICIONAL, con fuente identificada ────────────────────────
// Fuente: los propios metadatos de la biblioteca, getCountries() + getCountryCallingCode(): cuántos ISO comparten el
// código de llamada. NO se infiere de los errores observados y NO es una medida de ambigüedad real: es un indicio
// conservador a nivel de plan («este código de llamada está asignado a más de un ISO en los metadatos»).
const byCode = {};
for (const c of all) (byCode[lpn.getCountryCallingCode(c)] ??= []).push(c);
const isShared = (cc) => byCode[cc].length > 1;

const A = { unmapped: [], unique_same_iso: [], unique_other_iso: [], multiple_in_table_contains: [], multiple_in_table_misses: [] };
const raw = { returned_same_iso: [], returned_other_iso: [], no_result: [] };
const cross = { unshared_same: 0, unshared_other: 0, unshared_none: 0, shared_same: 0, shared_other: 0, shared_none: 0 };
const possibleSizes = {}; const identicalExample = []; const otherIsoDetail = [];
const exampleOf = {};
for (const c of all) { const ex = lpn.getExampleNumber(c, examples); if (ex) exampleOf[c] = ex.number; }
for (const c of Object.keys(exampleOf)) {
  const e164 = exampleOf[c]; const cc = String(lpn.getCountryCallingCode(c));
  const set = table[cc];
  if (!set) A.unmapped.push(c);
  else if (set.length === 1) (set[0] === c ? A.unique_same_iso : A.unique_other_iso).push(`${c}->${set[0]}`);
  else (set.includes(c) ? A.multiple_in_table_contains : A.multiple_in_table_misses).push(`${c}~${set.join('/')}`);
  const parsed = lpn.parsePhoneNumberFromString(e164);
  const d = parsed?.country;
  const ps = String(parsed?.getPossibleCountries ? parsed.getPossibleCountries().length : 'n/a'); possibleSizes[ps] = (possibleSizes[ps] ?? 0) + 1;
  const key = (isShared(cc) ? 'shared_' : 'unshared_') + (!d ? 'none' : d === c ? 'same' : 'other');
  cross[key]++;
  if (!d) raw.no_result.push(c);
  else if (d === c) raw.returned_same_iso.push(c);
  else {
    raw.returned_other_iso.push(`${c}->${d}`);
    const twin = exampleOf[d] === e164; // ¿el ejemplo publicado de ese país es el MISMO número?
    otherIsoDetail.push({ example_country: c, returned: d, same_example_number_as_returned: twin });
    if (twin) identicalExample.push(c);
  }
}
const total = Object.keys(exampleOf).length;
const sharedCodes = Object.entries(byCode).filter(([, v]) => v.length > 1).map(([k, v]) => ({ calling_code: k, countries: v.length }));

const out = {
  library: { name: 'libphonenumber-js', version: pkg.version, license: pkg.license, metadata: 'max' },
  test_set: { description: 'ejemplos móviles sintéticos publicados por la biblioteca; los porcentajes describen ESTE conjunto, no precisión universal',
    countries_with_example: total },
  table_source_A: { rows: tableCountries.size, calling_codes: Object.keys(table).length,
    counts: Object.fromEntries(Object.entries(A).map(([k, v]) => [k, v.length])),
    unmapped_pct_of_test_set: +(100 * A.unmapped.length / total).toFixed(1),
    unique_other_iso: A.unique_other_iso, multiple_in_table: [...A.multiple_in_table_contains, ...A.multiple_in_table_misses] },
  library_raw_output_B: { counts: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.length])),
    returned_same_iso_pct_of_test_set: +(100 * raw.returned_same_iso.length / total).toFixed(1),
    returned_other_iso: otherIsoDetail,
    getPossibleCountries_size_distribution: possibleSizes,
    note: 'La biblioteca no expone un conjunto de candidatos ni un estado ambiguo: devuelve un ISO o ninguno.' },
  additional_classification_shared_calling_code: {
    source: 'metadatos de la biblioteca (getCountries + getCountryCallingCode); indicio a nivel de plan, no medida de ambigüedad',
    calling_codes_shared: sharedCodes.length, countries_in_shared_codes: sharedCodes.reduce((n, x) => n + x.countries, 0),
    cross_tab_with_raw_output: cross,
    every_other_iso_case_is_in_a_shared_code: raw.returned_other_iso.length === cross.shared_other && cross.unshared_other === 0,
    largest_shared: sharedCodes.sort((a, b) => b.countries - a.countries).slice(0, 5) },
};
console.log(JSON.stringify(out, null, 2));
