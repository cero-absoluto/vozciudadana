import test from 'node:test';
import assert from 'node:assert/strict';
import { formatVerificationCount } from './fixtures/handoff-e2e-verification.mjs';

test('verification fixture preserves the participation count', () => {
  assert.equal(formatVerificationCount(0), '0');
  assert.equal(formatVerificationCount(42), '42');
  assert.equal(formatVerificationCount(99), '99');
});
