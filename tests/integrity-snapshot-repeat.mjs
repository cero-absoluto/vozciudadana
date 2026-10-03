// Run with @electric-sql/pglite@0.5.8 available to Node.
// Usage: node integrity-snapshot-repeat.mjs <new-migration.sql> <legacy-migration.sql>
// All fixtures live in an isolated, in-memory Postgres database.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
SET search_path = public, extensions;
CREATE TABLE protests (
 id uuid PRIMARY KEY, title text, demands text, scope text, country text,
 count integer, cities integer, starts_at timestamptz, ends_at timestamptz,
 integrity_version integer DEFAULT 1, hash_integridad text
);
CREATE TABLE adhesions (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, protest_id uuid REFERENCES protests(id),
 nullifier text, public_commitment text, ciudad text, fiabilidad integer,
 created_at timestamptz DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE integrity_records (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, protest_id uuid UNIQUE REFERENCES protests(id),
 integrity_version integer, integrity_hash text, canonical_input text,
 public_commitments jsonb, total_adhesions integer, city_distribution jsonb,
 reliability_breakdown jsonb, first_adhesion timestamptz, last_adhesion timestamptz,
 first_adhesion_text text, last_adhesion_text text, closed_at timestamptz, calculated_at timestamptz
);
`);
const migration = await readFile(process.argv[2], 'utf8');
const candidate = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.'));
const legacyFile = await readFile(process.argv[3], 'utf8');
const legacy = legacyFile.slice(legacyFile.indexOf('CREATE OR REPLACE FUNCTION calculate_integrity_hash_v2'), legacyFile.indexOf('$$ LANGUAGE plpgsql;') + '$$ LANGUAGE plpgsql;'.length);
const id = '00000000-0000-4000-8000-000000000001';
const emptyId = '00000000-0000-4000-8000-000000000002';
const call = () => db.query('select calculate_integrity_hash_v2($1) as hash', [id]);
const snapshot = async () => (await db.query('select to_jsonb(r) as row from integrity_records r where protest_id=$1', [id])).rows[0].row;
const seed = async () => db.exec(`
 INSERT INTO protests VALUES ('${id}','Test','Test demands','global','NL',2,1,'2000-01-01','2000-01-02',1,NULL);
 INSERT INTO adhesions (protest_id,nullifier,ciudad,fiabilidad) VALUES
 ('${id}','a','City',100),('${id}','b','City',100);
`);
const addThird = async () => db.exec(`
 UPDATE protests SET count=3 WHERE id='${id}';
 INSERT INTO adhesions (protest_id,nullifier,ciudad,fiabilidad) VALUES ('${id}','c','City',100);
`);
await db.exec(legacy);
await seed();
await call();
await addThird();
await call();
const broken = await snapshot();
assert.equal(broken.total_adhesions,2);
assert.equal(broken.public_commitments.length,3);
console.log('PASS: original partial-upsert defect reproduced (2 totals / 3 commitments)');
await db.exec('TRUNCATE integrity_records, adhesions, protests CASCADE');
await db.exec(candidate);
await seed();
const first = (await call()).rows[0].hash;
const before = await snapshot();
assert.equal(before.total_adhesions,2);
assert.equal(before.public_commitments.length,2);
assert.equal((await db.query("select encode(extensions.digest(canonical_input,'sha256'),'hex')=integrity_hash as valid from integrity_records")).rows[0].valid,true);
assert.equal((await call()).rows[0].hash,first);
assert.deepEqual(await snapshot(),before);
console.log('PASS: first snapshot valid; unchanged repeat preserves every snapshot field');
await addThird();
assert.equal((await call()).rows[0].hash,first);
assert.deepEqual(await snapshot(),before);
assert.equal((await db.query('select public_commitment from adhesions where nullifier=\'c\'')).rows[0].public_commitment,null);
console.log('PASS: live-data changes cannot partially overwrite final snapshot or mutate new adhesion');
await db.exec("update adhesions set nullifier=null,public_commitment=null,ciudad=null");
assert.equal((await call()).rows[0].hash,first);
assert.deepEqual(await snapshot(),before);
console.log('PASS: repeat after participant-data removal preserves final evidence');
await db.exec(`update protests set integrity_version=1,hash_integridad='historical-v1' where id='${id}'`);
await call();
assert.deepEqual((await db.query('select integrity_version,hash_integridad from protests where id=$1',[id])).rows[0],{integrity_version:1,hash_integridad:'historical-v1'});
console.log('PASS: hybrid protests metadata is not migrated');
await db.exec(`insert into protests values ('${emptyId}','Empty','Empty demands','global','NL',0,0,'2000-01-01','2000-01-02',1,null)`);
await db.query('select calculate_integrity_hash_v2($1)',[emptyId]);
const empty=(await db.query('select total_adhesions,public_commitments from integrity_records where protest_id=$1',[emptyId])).rows[0];
assert.deepEqual(empty,{total_adhesions:0,public_commitments:[]});
console.log('PASS: zero-participant first closure supported');
await assert.rejects(db.query('select calculate_integrity_hash_v2($1)',['00000000-0000-4000-8000-000000000099']), /VP_INTEGRITY_PROTEST_NOT_FOUND/);
console.log('PASS: nonexistent protest cannot create phantom snapshot');
await db.exec(`update integrity_records set total_adhesions=999 where protest_id='${id}'`);
const invalidTotal=await snapshot();
await assert.rejects(call(), /VP_INTEGRITY_EXISTING_SNAPSHOT_REQUIRES_REVIEW/);
assert.deepEqual(await snapshot(),invalidTotal);
console.log('PASS: inconsistent existing snapshot rejected without repair or overwrite');
await db.exec(`update integrity_records set total_adhesions=2,integrity_hash='bad' where protest_id='${id}'`);
const invalidHash=await snapshot();
await assert.rejects(call(), /VP_INTEGRITY_EXISTING_SNAPSHOT_REQUIRES_REVIEW/);
assert.deepEqual(await snapshot(),invalidHash);
console.log('PASS: invalid existing hash rejected without rewrite');
await db.exec(`update integrity_records set integrity_hash='${first}',integrity_version=1 where protest_id='${id}'`);
await assert.rejects(call(), /VP_INTEGRITY_EXISTING_SNAPSHOT_REQUIRES_REVIEW/);
console.log('PASS: legacy-version snapshot requires explicit review');
await db.close();
