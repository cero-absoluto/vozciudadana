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
const A = { unmapped: [], unique_correct: [], unique_wrong: [], ambiguous_contains: [], ambiguous_misses: [] };
const B = { correct: [], undefined: [], wrong: [] };
for (const c of all) {
  const ex = lpn.getExampleNumber(c, examples);
  if (!ex) continue;
  const e164 = ex.number; const cc = String(lpn.getCountryCallingCode(c));
  const set = table[cc];
  if (!set) A.unmapped.push(c);
  else if (set.length === 1) (set[0] === c ? A.unique_correct : A.unique_wrong).push(`${c}->${set[0]}`);
  else (set.includes(c) ? A.ambiguous_contains : A.ambiguous_misses).push(`${c}~${set.join('/')}`);
  const d = lpn.parsePhoneNumberFromString(e164)?.country;
  if (!d) B.undefined.push(c); else if (d === c) B.correct.push(c); else B.wrong.push(`${c}->${d}`);
}
const ccShared = {};
for (const c of all) (ccShared[lpn.getCountryCallingCode(c)] ??= []).push(c);
const sharedCodes = Object.entries(ccShared).filter(([, v]) => v.length > 1).map(([k, v]) => ({ calling_code: k, countries: v.length }));

const total = Object.values(A).reduce((n, a) => n + a.length, 0);
const out = {
  library: { name: 'libphonenumber-js', version: pkg.version, license: pkg.license, metadata: 'max' },
  examples: 'ejemplos móviles sintéticos de la biblioteca',
  countries_with_example: total,
  table_source: { rows: tableCountries.size, calling_codes: Object.keys(table).length,
    counts: Object.fromEntries(Object.entries(A).map(([k, v]) => [k, v.length])),
    unmapped_pct: +(100 * A.unmapped.length / total).toFixed(1), unique_wrong: A.unique_wrong, ambiguous: [...A.ambiguous_contains, ...A.ambiguous_misses] },
  versioned_metadata_source: { counts: Object.fromEntries(Object.entries(B).map(([k, v]) => [k, v.length])),
    correct_pct: +(100 * B.correct.length / total).toFixed(1), undefined: B.undefined, wrong: B.wrong },
  calling_codes_shared_in_full_plan: { codes: sharedCodes.length, countries_in_them: sharedCodes.reduce((n, x) => n + x.countries, 0), largest: sharedCodes.sort((a, b) => b.countries - a.countries).slice(0, 5) },
};
console.log(JSON.stringify(out, null, 2));
