import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAutonomousCount } from './fixtures/handoff-autonomous-verification.mjs';

test('autonomous fixture preserves the supplied count exactly', () => {
  for (const count of [0, 42, 99]) {
    assert.equal(formatAutonomousCount(count), String(count));
  }
});
