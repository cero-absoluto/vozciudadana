// Revisión local de la migración 20261019120000_devices_numbering_provenance.sql.
// Base de datos desechable en memoria (PGlite): NO toca producción ni ninguna copia compartida.
// Ejecutar con @electric-sql/pglite disponible en Node:
//   npm i --no-save @electric-sql/pglite@0.5.8 && node --test tests/devices-numbering-migration.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../supabase/migrations/20261019120000_devices_numbering_provenance.sql', import.meta.url), 'utf8');
const db = new PGlite();
// Esquema previo mínimo de `devices` (20260501_init + country_code + device_secret_hash + last_seen).
await db.exec(`
  create table country_codes (iso2 char(2) primary key);
  create table devices (
    id text primary key, phone_hash text not null unique, doc_hash text,
    verified_at timestamptz, created_at timestamptz not null default now(),
    country_code char(2) references country_codes(iso2), device_secret_hash text, last_seen timestamptz
  );
  insert into country_codes values ('ES'),('FR');
  insert into devices (id, phone_hash, verified_at, country_code) values ('legacy-1', 'h1', now(), 'ES'), ('legacy-2', 'h2', now(), 'FR');
`);
const before = (await db.query('select * from devices order by id')).rows;

test('la migración se aplica y es idempotente (dos veces sin error)', async () => {
  await db.exec(migration);
  await db.exec(migration);
  const cols = (await db.query(`select column_name from information_schema.columns where table_name='devices' and column_name like 'numbering_%' order by 1`)).rows.map(r => r.column_name);
  assert.deepEqual(cols, ['numbering_country', 'numbering_meta_version', 'numbering_resolution']);
});

test('sin backfill: las filas existentes siguen igual y con procedencia NULL (= sin procedencia fiable)', async () => {
  const after = (await db.query('select * from devices order by id')).rows;
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length; i++) {
    for (const k of Object.keys(before[i])) assert.deepEqual(after[i][k], before[i][k], `${before[i].id}.${k} no debe cambiar`);
    assert.equal(after[i].numbering_resolution, null);
    assert.equal(after[i].numbering_country, null);
    assert.equal(after[i].numbering_meta_version, null);
  }
});

const ins = (id, c, r, v) => db.query(
  `insert into devices (id, phone_hash, numbering_country, numbering_resolution, numbering_meta_version) values ($1, $1, $2, $3, $4)`, [id, c, r, v]);

test('acepta derivaciones coherentes', async () => {
  await ins('ok-1', 'DE', 'resolved_unshared', 'libphonenumber-js@1.12.10/max');
  await ins('ok-2', null, 'shared_calling_code', 'libphonenumber-js@1.12.10/max');
  await ins('ok-3', null, 'no_result', 'libphonenumber-js@1.12.10/max');
  await ins('ok-5', 'CA', 'resolved_shared_unique', 'libphonenumber-js@1.12.10/max;R-N2'); // código compartido, un único país
  await ins('ok-4', 'UY', 'resolved_unshared', 'libphonenumber-js@1.12.10/max'); // UY no está en country_codes: sin FK
});

test('rechaza derivaciones incoherentes', async () => {
  await assert.rejects(ins('bad-1', null, 'resolved_unshared', 'v'), /devices_numbering_provenance_coherent/);
  await assert.rejects(ins('bad-2', 'FR', 'shared_calling_code', 'v'), /devices_numbering_provenance_coherent/);
  await assert.rejects(ins('bad-3', 'FR', 'no_result', 'v'), /devices_numbering_provenance_coherent/);
  await assert.rejects(ins('bad-4', 'FR', 'resolved_unshared', null), /devices_numbering_provenance_coherent/);
  await assert.rejects(ins('bad-5', 'FR', null, 'v'), /devices_numbering_provenance_coherent/);
  await assert.rejects(ins('bad-7', null, 'resolved_shared_unique', 'v'), /devices_numbering_provenance_coherent/); // resuelto sin país
  await assert.rejects(ins('bad-8', 'CA', 'resolved_shared_unique', null), /devices_numbering_provenance_coherent/);
  await assert.rejects(ins('bad-6', null, 'country_by_declaration', 'v'), /devices_numbering_provenance_coherent/);
});

test('el contenido de adhesiones/nullifiers no existe en esta migración (solo la tabla devices cambia)', () => {
  assert.ok(!/adhesions|nullifier|integrity|hash_integridad/i.test(migration.replace(/--.*$/gm, '')), 'el SQL ejecutable no menciona adhesiones, nullifiers ni integridad');
  assert.ok(!/\bupdate\b|\bdelete\b|\binsert\b/i.test(migration.replace(/--.*$/gm, '')), 'sin backfill ni cambios de datos');
});

test('re-ejecutar la migración (con la restricción ya creada, también la versión anterior de 3 valores) la deja con los 4 valores', async () => {
  await db.exec("delete from devices where numbering_resolution = 'resolved_shared_unique'"); // filas del nuevo valor no caben en la restricción antigua
  await db.exec(`alter table devices drop constraint devices_numbering_provenance_coherent;
    alter table devices add constraint devices_numbering_provenance_coherent check (numbering_resolution is null or numbering_resolution in ('resolved_unshared','shared_calling_code','no_result'));`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261019120000_devices_numbering_provenance.sql', import.meta.url), 'utf8'));
  await ins('ok-6', 'GB', 'resolved_shared_unique', 'libphonenumber-js@1.12.10/max;R-N2');
  await assert.rejects(ins('bad-9', null, 'resolved_shared_unique', 'v'), /devices_numbering_provenance_coherent/);
});
