// Disposable Claude-first acceptance test. Never imported by the application.
// The implementation must be supplied by Claude, not by the coordinator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPilotCount } from './fixtures/claude-first-count.mjs';

test('pilot: formatting preserves non-negative safe integers exactly', () => {
  for (const value of [0, 1, 42, 99, Number.MAX_SAFE_INTEGER]) {
    assert.equal(formatPilotCount(value), String(value));
  }
});
test('pilot: invalid counts are rejected rather than silently changed', () => {
  for (const value of [-1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '42', null, undefined]) {
    assert.throws(() => formatPilotCount(value), TypeError);
  }
});
