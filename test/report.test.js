'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport } = require('../report');

const tx = (over) => ({ id: 1, amount: 100, type: 'debit', merchant: 'Shop', category: 'Food', date: '2026-10-01T10:00:00Z', ...over });

test('sums debits by category and excludes credits', () => {
  const r = buildReport([
    tx({ id: 1, amount: 100, category: 'Food' }),
    tx({ id: 2, amount: 50, category: 'Food', merchant: 'B', date: '2026-10-02T10:00:00Z' }),
    tx({ id: 3, amount: 25, category: 'Travel', merchant: 'C' }),
    tx({ id: 4, amount: 9999, type: 'credit', category: 'Income' }),
  ]);
  assert.equal(r.totals.totalSpent, 175);
  assert.equal(r.totals.totalReceived, 9999);
  assert.deepEqual(r.spendingByCategory.map((c) => [c.category, c.total, c.count]), [['Food', 150, 2], ['Travel', 25, 1]]);
});

test('avoids floating point drift', () => {
  const r = buildReport([tx({ id: 1, amount: 0.1 }), tx({ id: 2, amount: 0.2, merchant: 'B' })]);
  assert.equal(r.totals.totalSpent, 0.3);
});

test('flags duplicates inside the window, not outside', () => {
  const r = buildReport([
    tx({ id: 'a', date: '2026-10-01T10:00:00Z' }),
    tx({ id: 'b', date: '2026-10-01T10:05:00Z' }),
    tx({ id: 'c', date: '2026-10-01T18:00:00Z' }),
  ]);
  assert.equal(r.flagged.length, 1);
  assert.equal(r.flagged[0].id, 'b');
  assert.equal(r.flagged[0].flags[0].duplicateOf, 'a');
  assert.equal(r.flaggedSummary.potentialDuplicateAmount, 100);
});

test('flags large spends at or above the threshold', () => {
  const r = buildReport([tx({ id: 1, amount: 10000 }), tx({ id: 2, amount: 9999.99, merchant: 'B' })]);
  assert.deepEqual(r.flagged.map((f) => f.id), [1]);
  assert.equal(r.flagged[0].flags[0].type, 'large_spend');
});

test('skips malformed rows without throwing', () => {
  const r = buildReport([null, { id: 'x', amount: 'abc' }, tx({ id: 'y', type: 'weird' }), tx({ id: 'ok' })]);
  assert.equal(r.skipped.length, 3);
  assert.equal(r.totals.debitCount, 1);
});

test('missing category becomes Uncategorized; empty input is fine', () => {
  assert.equal(buildReport([tx({ category: null })]).spendingByCategory[0].category, 'Uncategorized');
  const empty = buildReport([]);
  assert.equal(empty.totals.totalSpent, 0);
  assert.deepEqual(empty.flagged, []);
});

test('rejects non-array input and bad options', () => {
  assert.throws(() => buildReport('nope'), TypeError);
  assert.throws(() => buildReport([], { largeSpendThreshold: -1 }), TypeError);
});
