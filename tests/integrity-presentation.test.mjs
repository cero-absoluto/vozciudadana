import test from 'node:test';
import assert from 'node:assert/strict';
import { hasIntegrityDiscrepancy, verifyIntegrityPayload } from '../apps/web/src/lib/integrityVerification.js';

// Published zero-participant snapshot; no participant identifiers.
const snapshot = {
  protest_id: 'c1c10dba-b6c0-4827-af52-ec52b726a106',
  title: "-Executive Board attempted to block the University Council's legal right to consent regarding the university'",
  demands: 'We demand that the Executive Board respects the participatory framework outlined in the Regulations for the University Council of Utrecht University, ensuring that critical frameworks are not passed without an authenticated, transparent, and democratic student consensus.',
  scope: 'regional', country: 'NL', total_adhesions: 0, cities_count: 1,
  first_adhesion: '', last_adhesion: '', public_commitments: [],
  city_distribution: {}, reliability_breakdown: {}, integrity_version: 2,
  integrity_hash: 'db1fece446a60d13fc40a3d848925d729b4fed62236e26cb800d8b2fa8ccee6e',
  data_source: 'integrity_record',
};
const historical = {
  integrity_version: 1,
  hash_integridad: 'cc2d22963c8bdadd4bf90755d7d9748647905c617f8646c6df5cc925cab38b40',
};

test('hybrid record verifies v2 without reconciling or mutating v1', async () => {
  const before = structuredClone({ snapshot, historical });
  assert.equal(hasIntegrityDiscrepancy(historical, snapshot), true);
  assert.equal(await verifyIntegrityPayload(snapshot, snapshot.protest_id), 'ok');
  assert.deepEqual({ snapshot, historical }, before);
});

test('matching v2 record has no historical discrepancy', () => {
  assert.equal(hasIntegrityDiscrepancy({
    integrity_version: 2, hash_integridad: snapshot.integrity_hash,
  }, snapshot), false);
});

test('same version with different hashes still exposes discrepancy', () => {
  assert.equal(hasIntegrityDiscrepancy({ integrity_version: 2, hash_integridad: 'different' }, snapshot), true);
});

test('legacy-only response retains the legacy result', async () => {
  assert.equal(await verifyIntegrityPayload({
    protest_id: snapshot.protest_id, integrity_version: 1,
  }, snapshot.protest_id), 'v1');
});

test('changed evidence does not verify', async () => {
  assert.equal(await verifyIntegrityPayload({ ...snapshot, total_adhesions: 1 }, snapshot.protest_id), 'fail');
});

test('different protest and unavailable payload are not integrity matches', async () => {
  await assert.rejects(verifyIntegrityPayload(snapshot, 'different-protest'));
  await assert.rejects(verifyIntegrityPayload(null, snapshot.protest_id));
  await assert.rejects(verifyIntegrityPayload({ ...snapshot, public_commitments: null }, snapshot.protest_id));
});
