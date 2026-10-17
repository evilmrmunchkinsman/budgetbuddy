'use strict';

/**
 * Pure reporting logic: no I/O, no database, no HTTP.
 *
 *   buildReport(transactions, options) -> report object
 *
 * Rules
 *  - Only DEBITS count as spending. Credits are totalled separately and never flagged.
 *  - "large_spend": debit amount >= options.largeSpendThreshold.
 *  - "duplicate":   a debit with the same merchant (case-insensitive) AND same amount as an
 *                   earlier debit within options.duplicateWindowMinutes. The LATER one is
 *                   flagged and points at the original via `duplicateOf`. Duplicates still
 *                   count in totals; see flaggedSummary.potentialDuplicateAmount.
 *  - Malformed rows are skipped and listed under `skipped` instead of crashing the report.
 *  - Money is summed in integer paise to avoid floating-point drift.
 */

const DEFAULT_OPTIONS = Object.freeze({
  largeSpendThreshold: 10000,
  duplicateWindowMinutes: 10,
  currency: 'INR',
});

const UNCATEGORIZED = 'Uncategorized';

const toPaise = (amount) => Math.round(amount * 100);
const fromPaise = (paise) => paise / 100;
const nonEmptyString = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function parseAmount(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[,\s]/g, '').replace(/^(?:rs\.?|inr|₹)/i, '');
    return cleaned === '' ? NaN : Number(cleaned);
  }
  return NaN;
}

function normalizeTransaction(raw, index) {
  const fallbackId = `row-${index}`;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: { id: fallbackId, reason: 'row is not an object' } };
  }
  const id = raw.id ?? fallbackId;
  const amount = parseAmount(raw.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: { id, reason: 'amount must be a positive number' } };
  }
  const type = String(raw.type ?? 'debit').trim().toLowerCase();
  if (type !== 'debit' && type !== 'credit') {
    return { error: { id, reason: `unsupported type "${raw.type}"` } };
  }
  const merchant = nonEmptyString(raw.merchant) ?? 'Unknown';
  const category = nonEmptyString(raw.category) ?? UNCATEGORIZED;

  const dateValue = raw.date ?? raw.timestamp ?? raw.created_at;
  let date = null;
  if (dateValue !== undefined && dateValue !== null && dateValue !== '') {
    const parsed = new Date(dateValue);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }

  return {
    txn: {
      id,
      type,
      amountPaise: toPaise(amount),
      merchant,
      merchantKey: merchant.toLowerCase().replace(/\s+/g, ' '),
      category,
      categoryKey: category.toLowerCase(),
      date,
    },
  };
}

/** Returns Map<txn, originalId> for debits that repeat an earlier debit inside the window. */
function findDuplicates(debits, windowMinutes) {
  const windowMs = windowMinutes * 60 * 1000;
  const groups = new Map();
  for (const txn of debits) {
    if (!txn.date) continue; // cannot judge "closeness" without a date
    const key = `${txn.merchantKey}|${txn.amountPaise}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(txn);
  }
  const duplicates = new Map();
  for (const group of groups.values()) {
    group.sort((a, b) => a.date - b.date);
    let anchor = group[0];
    for (let i = 1; i < group.length; i += 1) {
      if (group[i].date - anchor.date <= windowMs) {
        duplicates.set(group[i], anchor.id);
      } else {
        anchor = group[i]; // legit repeat purchase later on; start a new window
      }
    }
  }
  return duplicates;
}

function validateOptions(options) {
  if (!(options.largeSpendThreshold > 0)) throw new TypeError('largeSpendThreshold must be a positive number');
  if (!(options.duplicateWindowMinutes >= 0)) throw new TypeError('duplicateWindowMinutes must be >= 0');
}

function buildReport(transactions, options = {}) {
  if (!Array.isArray(transactions)) throw new TypeError('transactions must be an array');
  const opts = { ...DEFAULT_OPTIONS, ...options };
  validateOptions(opts);

  const valid = [];
  const skipped = [];
  transactions.forEach((raw, index) => {
    const { txn, error } = normalizeTransaction(raw, index);
    if (error) skipped.push(error);
    else valid.push(txn);
  });

  const debits = valid.filter((t) => t.type === 'debit');
  const credits = valid.filter((t) => t.type === 'credit');

  // --- spending by category ---
  const buckets = new Map();
  let totalSpentPaise = 0;
  for (const t of debits) {
    totalSpentPaise += t.amountPaise;
    const bucket = buckets.get(t.categoryKey) ?? { category: t.category, paise: 0, count: 0 };
    bucket.paise += t.amountPaise;
    bucket.count += 1;
    buckets.set(t.categoryKey, bucket);
  }
  const spendingByCategory = [...buckets.values()]
    .sort((a, b) => b.paise - a.paise || a.category.localeCompare(b.category))
    .map((b) => ({
      category: b.category,
      total: fromPaise(b.paise),
      count: b.count,
      percentage: totalSpentPaise === 0 ? 0 : Math.round((b.paise / totalSpentPaise) * 1000) / 10,
    }));

  // --- flags ---
  const thresholdPaise = toPaise(opts.largeSpendThreshold);
  const duplicates = findDuplicates(debits, opts.duplicateWindowMinutes);
  const flagged = [];
  let largeCount = 0;
  let duplicateCount = 0;
  let duplicatePaise = 0;

  for (const t of debits) {
    const flags = [];
    if (t.amountPaise >= thresholdPaise) {
      largeCount += 1;
      flags.push({
        type: 'large_spend',
        reason: `Amount ${fromPaise(t.amountPaise)} ${opts.currency} is at or above the large-spend threshold of ${opts.largeSpendThreshold} ${opts.currency}`,
      });
    }
    if (duplicates.has(t)) {
      duplicateCount += 1;
      duplicatePaise += t.amountPaise;
      flags.push({
        type: 'duplicate',
        duplicateOf: duplicates.get(t),
        reason: `Same merchant and amount as transaction ${duplicates.get(t)} within ${opts.duplicateWindowMinutes} minutes`,
      });
    }
    if (flags.length) {
      flagged.push({
        id: t.id,
        date: t.date ? t.date.toISOString() : null,
        merchant: t.merchant,
        category: t.category,
        amount: fromPaise(t.amountPaise),
        flags,
      });
    }
  }
  flagged.sort((a, b) => {
    if (a.date === b.date) return String(a.id).localeCompare(String(b.id));
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? -1 : 1;
  });

  const datedDebits = debits.filter((t) => t.date).map((t) => t.date.getTime());

  return {
    generatedAt: new Date().toISOString(),
    currency: opts.currency,
    period: datedDebits.length
      ? { from: new Date(Math.min(...datedDebits)).toISOString(), to: new Date(Math.max(...datedDebits)).toISOString() }
      : { from: null, to: null },
    totals: {
      transactionsAnalyzed: valid.length,
      debitCount: debits.length,
      totalSpent: fromPaise(totalSpentPaise),
      creditCount: credits.length,
      totalReceived: fromPaise(credits.reduce((sum, t) => sum + t.amountPaise, 0)),
    },
    spendingByCategory,
    flagged,
    flaggedSummary: {
      largeSpends: largeCount,
      duplicates: duplicateCount,
      potentialDuplicateAmount: fromPaise(duplicatePaise),
    },
    thresholds: {
      largeSpendThreshold: opts.largeSpendThreshold,
      duplicateWindowMinutes: opts.duplicateWindowMinutes,
    },
    skipped,
  };
}

module.exports = { buildReport, DEFAULT_OPTIONS };
