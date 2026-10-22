import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPilotCount } from './fixtures/handoff-live-pilot.mjs';

test('handoff pilot: formatting preserves the supplied count', () => {
  assert.equal(formatPilotCount(0), '0');
  assert.equal(formatPilotCount(42), '42');
});
