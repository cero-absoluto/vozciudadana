import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLocation } from '../apps/web/src/lib/mapLocation.js';

test('map and badge prefer available GPS, then IP, over device settings', () => {
  const d = { gpsReady: true, gpsCountryCode: 'MT', ipCountry: 'NL', tzCountry: 'ES', simCountry: 'FR' };
  assert.deepEqual(mapLocation(d), { country: 'MT', approximate: false });
  assert.deepEqual(mapLocation({ ...d, gpsReady: false }), { country: 'NL', approximate: false });
});
test('missing IP can orient the map by timezone, explicitly as an estimate', () => {
  assert.deepEqual(mapLocation({ ipCountry: '', tzCountry: 'MT' }), { country: 'MT', approximate: true });
});
test('phone prefix is not treated as device location and absent signals stay unknown', () => {
  assert.deepEqual(mapLocation({ simCountry: 'ES' }), { country: '', approximate: false });
  assert.deepEqual(mapLocation({ ipCountry: 'invalid', tzCountry: null }), { country: '', approximate: false });
});
