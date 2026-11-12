import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortDuration, longDuration, elapsed, age } from '../src/format.js';

test('durations, short for the page and long for the tooltips', () => {
  assert.equal(shortDuration(44_600), '45s');
  assert.equal(shortDuration(185_000), '3m05');
  assert.equal(shortDuration(72 * 60_000), '1h12');
  assert.equal(shortDuration(null), '');
  assert.equal(shortDuration(-5), '');
  assert.equal(longDuration(45_000), '45 s');
  assert.equal(longDuration(185_000), '3 min 5 s');
  assert.equal(longDuration(180_000), '3 min');
  assert.equal(longDuration(72 * 60_000), '1 h 12 min');
});

test('elapsed: to the end, or to now while it runs', () => {
  const start = '2026-11-12T10:00:00Z';
  assert.equal(elapsed(start, '2026-11-12T10:03:05Z'), 185_000);
  assert.equal(elapsed(start, null, Date.parse('2026-11-12T10:00:30Z')), 30_000);
  assert.equal(elapsed(null, null), null);
});

test('age', () => {
  const now = Date.parse('2026-11-12T12:00:00Z');
  assert.equal(age('2026-11-12T11:59:40Z', now), 'maint.');
  assert.equal(age('2026-11-12T11:50:00Z', now), '10 min');
  assert.equal(age('2026-11-12T09:00:00Z', now), '3 h');
  assert.equal(age('2026-11-09T12:00:00Z', now), '3 j');
});
