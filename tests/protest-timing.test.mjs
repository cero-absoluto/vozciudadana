import test from 'node:test';
import assert from 'node:assert/strict';
import { protestTiming } from '../apps/web/src/protestTiming.js';

const start = Date.parse('2026-10-27T10:00:00Z');
const end = start + 3600000;
const protest = { starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() };
test('timing crosses start and end exactly, including resuming after suspension', () => {
  assert.equal(protestTiming(protest, start - 1001).seconds, 2);
  assert.equal(protestTiming(protest, start - 1).state, 'upcoming');
  assert.equal(protestTiming(protest, start).state, 'open');
  assert.equal(protestTiming(protest, end - 1).state, 'open');
  assert.equal(protestTiming(protest, end).state, 'ended');
  assert.equal(protestTiming(protest, end + 86400000).state, 'ended');
});
test('missing or invalid dates never produce a false countdown', () => {
  assert.equal(protestTiming({ ends_at: protest.ends_at }, start).state, 'open');
  assert.equal(protestTiming({ starts_at: 'invalid', ends_at: protest.ends_at }, start).state, 'open');
  assert.equal(protestTiming({ ends_at: 'invalid' }, start).state, 'unknown');
  assert.equal(protestTiming({}, start).state, 'unknown');
});
test('equivalent date offsets give the same state', () => {
  assert.equal(protestTiming({ starts_at: '2026-10-27T11:00:00+01:00', ends_at: protest.ends_at }, start).state, 'open');
});
test('joining date stays at creation before and during the scheduled protest', () => {
  const created = start - 365 * 86400000;
  const p = { ...protest, created_at: new Date(created).toISOString() };
  for (const now of [created, start - 1, start, end - 1, end]) {
    const timing = protestTiming(p, now);
    assert.equal(timing.created, created);
    assert.equal(timing.start, start);
    assert.equal(timing.end, end);
  }
  assert.equal(protestTiming(p, created).state, 'upcoming');
  assert.equal(protestTiming(p, end).state, 'ended');
});
test('missing creation date is never replaced by protest start or current time', () => {
  assert.equal(Number.isNaN(protestTiming(protest, start).created), true);
  assert.equal(Number.isNaN(protestTiming({ ...protest, created_at: 'invalid' }, start).created), true);
});
