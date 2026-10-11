import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTimeGrid } from '../src/index.js';

/**
 * Helper: compare two ISO strings by their parsed ms value. We never compare
 * the strings directly because timezone-equivalent strings like '...Z' and
 * '...+00:00' represent the same instant.
 */
function ms(iso) {
  return Date.parse(iso);
}

/**
 * Assert that a slot list covers [start,end] with no gaps or overlaps,
 * independent of break flags. The "no gap / no overlap" invariant is the core
 * contract of the grid and worth checking on every case.
 */
function assertContiguous(slots, startIso, endIso) {
  assert.ok(slots.length > 0, 'expected at least one slot');
  assert.equal(ms(slots[0].start), ms(startIso));
  assert.equal(ms(slots[slots.length - 1].end), ms(endIso));
  for (let i = 1; i < slots.length; i++) {
    assert.equal(
      ms(slots[i].start),
      ms(slots[i - 1].end),
      `gap/overlap between slot ${i - 1} and ${i}`
    );
  }
}

test('basic grid with no breaks yields uniform slots', () => {
  const slots = generateTimeGrid(
    '2024-01-01T00:00:00.000Z',
    '2024-01-01T01:00:00.000Z',
    15 * 60 * 1000
  );
  assert.equal(slots.length, 4);
  for (const s of slots) {
    assert.equal(s.isBreak, false);
  }
  assert.equal(ms(slots[0].start), Date.parse('2024-01-01T00:00:00.000Z'));
  assert.equal(ms(slots[3].end), Date.parse('2024-01-01T01:00:00.000Z'));
});

test('last slot is truncated when interval does not divide the span', () => {
  const slots = generateTimeGrid(
    '2024-01-01T00:00:00.000Z',
    '2024-01-01T00:10:00.000Z',
    3 * 60 * 1000 // 3 min → slots at 0,3,6,9, last is 9→10
  );
  assert.equal(slots.length, 4);
  assert.equal(ms(slots[3].start), Date.parse('2024-01-01T00:09:00.000Z'));
  assert.equal(ms(slots[3].end), Date.parse('2024-01-01T00:10:00.000Z'));
  const lastWidth = ms(slots[3].end) - ms(slots[3].start);
  assert.equal(lastWidth, 60 * 1000);
});

test('zero-duration range (start === end) yields empty array', () => {
  const slots = generateTimeGrid(
    '2024-01-01T00:00:00.000Z',
    '2024-01-01T00:00:00.000Z',
    60 * 1000
  );
  assert.deepEqual(slots, []);
});

test('single slot fully inside a break is marked as break', () => {
  const slots = generateTimeGrid(
    '2024-01-01T00:00:00.000Z',
    '2024-01-01T01:00:00.000Z',
    15 * 60 * 1000,
    [{ start: '2024-01-01T00:00:00.000Z', end: '2024-01-01T00:15:00.000Z' }]
  );
  assert.equal(slots.length, 4);
  assert.equal(slots[0].isBreak, true);
  assert.equal(slots[1].isBreak, false);
  assert.equal(slots[2].isBreak, false);
  assert.equal(slots[3].isBreak, false);
  assertContiguous(
    slots,
    '2024-01-01T00:00:00.000Z',
    '2024-01-01T01:00:00.000Z'
  );
});

test('slot straddling a break start is split into non-break + break', () => {
  const slots = generateTimeGrid(
    '2024-01-01T00:00:00.000Z',
    '2024-01-01T00:30:00.000Z',
    20 * 60 * 1000, // slots: 00:00–00:20, 00:20–00:40→truncated to 00:30
    [{ start: '2024-01-01T00:10:00.000Z', end: '2024-01-01T00:25:00.000Z' }]
  );
  // Expected layout after splitting:
  //   00:00–00:10  non-break
  //   00:10–00:20  break
  //   00:20–00:25  break
  //   00:25–00:30  non-break
  assert.equal(slots.length, 4);
  assert.equal(slots[0].isBreak, false);
  assert.equal(slots[1].isBreak, true);
  assert.equal(slots[2].isBreak, true);
  assert.equal(slots[3].isBreak, false);
  assertContiguous(
    slots,
    '2024-01-01T00:00:00.000Z',
    '2024-01-01T00:30:00.000Z'
  );
});

test('break entirely outside the grid has no effect', () => {
  const slots = generateTimeGrid(
    '2024-01-01T00:00:00.000Z',
    '2024-01-01T01:00:00.000Z',
    15 * 60 * 1000,
    [{ start: '2024-01-02T00:00:00.000Z', end: '2024-01-02T01:00:00.000Z' }]
  );
  assert.equal(slots.length, 4);
  for (const s of slots) {
    assert.equal(s.isBreak, false);
  }
});

test('break larger than the grid marks every slot as break', () => {
  const slots = generateTimeGrid(
    '2024-01-01T00:00:00.000Z',
    '2024-01-01T01:00:00.000Z',
    15 * 60 * 1000,
    [{ start: '2023-12-31T00:00:00.000Z', end: '2024-01-02T00:00:00.000Z' }]
  );
  assert.equal(slots.length, 4);
  for (const s of slots) {
    assert.equal(s.isBreak, true);
  }
});

test('two adjacent breaks split a single slot into three pieces', () => {
  // Grid: one 30-minute slot from 00:00 to 00:30.
  // Break A: 00:05–00:10, Break B: 00:20–00:25.
  const slots = generateTimeGrid(
    '2024-01-01T00:00:00.000Z',
    '2024-01-01T00:30:00.000Z',
    30 * 60 * 1000,
    [
      { start: '2024-01-01T00:20:00.000Z', end: '2024-01-01T00:25:00.000Z' },
      { start: '2024-01-01T00:05:00.000Z', end: '2024-01-01T00:10:00.000Z' },
    ]
  );
  // After both breaks the single slot is split into:
  //   00:00–00:05  false
  //   00:05–00:10  true
  //   00:10–00:20  false
  //   00:20–00:25  true
  //   00:25–00:30  false
  assert.equal(slots.length, 5);
  assert.equal(slots[0].isBreak, false);
  assert.equal(slots[1].isBreak, true);
  assert.equal(slots[2].isBreak, false);
  assert.equal(slots[3].isBreak, true);
  assert.equal(slots[4].isBreak, false);
  assertContiguous(
    slots,
    '2024-01-01T00:00:00.000Z',
    '2024-01-01T00:30:00.000Z'
  );
});

test('zero or negative-width breaks are ignored', () => {
  const slots = generateTimeGrid(
    '2024-01-01T00:00:00.000Z',
    '2024-01-01T00:30:00.000Z',
    15 * 60 * 1000,
    [
      { start: '2024-01-01T00:10:00.000Z', end: '2024-01-01T00:10:00.000Z' },
      { start: '2024-01-01T00:20:00.000Z', end: '4-01-01T00:10:00.000Z' },
    ].map((b, i) =>
      i === 1 ? { start: '2024-01-01T00:20:00.000Z', end: '2024-01-01T00:10:00.000Z' } : b
    )
  );
  assert.equal(slots.length, 2);
  for (const s of slots) {
    assert.equal(s.isBreak, false);
  }
});

test('non-positive interval throws', () => {
  assert.throws(() =>
    generateTimeGrid(
      '2024-01-01T00:00:00.000Z',
      '2024-01-01T01:00:00.000Z',
      0
    )
  );
  assert.throws(() =>
    generateTimeGrid(
      '2024-01-01T00:00:00.000Z',
      '2024-01-01T01:00:00.000Z',
      -1000
    )
  );
});

test('non-integer interval throws', () => {
  assert.throws(() =>
    generateTimeGrid(
      '2024-01-01T00:00:00.000Z',
      '2024-01-01T01:00:00.000Z',
      1.5
    )
  );
});

test('end before start throws', () => {
  assert.throws(() =>
    generateTimeGrid(
      '2024-01-01T01:00:00.000Z',
      '2024-01-01T00:00:00.000Z',
      60 * 1000
    )
  );
});

test('non-UTC timezone suffix is rejected', () => {
  assert.throws(() =>
    generateTimeGrid(
      '2024-01-01T00:00:00.000+05:00',
      '2024-01-01T01:00:00.000Z',
      60 * 1000
    )
  );
});

test('naked local time without Z is rejected', () => {
  assert.throws(() =>
    generateTimeGrid(
      '2024-01-01T00:00:00.000',
      '2024-01-01T01:00:00.000Z',
      60 * 1000
    )
  );
});

test('offset +00:00 is accepted as equivalent to Z', () => {
  const slots = generateTimeGrid(
    '2024-01-01T00:00:00.000+00:00',
    '2024-01-01T00:15:00.000+00:00',
    15 * 60 * 1000
  );
  assert.equal(slots.length, 1);
  assert.equal(slots[0].isBreak, false);
});

test('breaks are applied in order regardless of input order', () => {
  // Same grid and breaks as the "two adjacent breaks" test, but supplied in
  // the opposite order. The result must be identical because we sort breaks
  // before applying them.
  const slots = generateTimeGrid(
    '2024-01-01T00:00:00.000Z',
    '2024-01-01T00:30:00.000Z',
    30 * 60 * 1000,
    [
      { start: '2024-01-01T00:20:00.000Z', end: '2024-01-01T00:25:00.000Z' },
      { start: '2024-01-01T00:05:00.000Z', end: '2024-01-01T00:10:00.000Z' },
    ]
  );
  assert.equal(slots.length, 5);
  assert.equal(slots[1].isBreak, true);
  assert.equal(slots[3].isBreak, true);
});
