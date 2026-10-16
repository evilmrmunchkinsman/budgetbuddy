'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const CATEGORIES = ['Food', 'Travel', 'Shopping', 'Bills', 'Healthcare', 'Other'];
let connection = null;

function databaseFilename() {
  return process.env.BUDGETBUDDY_DB_PATH || path.join(__dirname, 'budgetbuddy.sqlite');
}

/**
 * Open the SQLite database and create missing tables/indexes.
 * Existing tables and rows are left intact.
 */
function initDatabase(options = {}) {
  if (!connection) {
    const filename = options.filename || databaseFilename();
    if (filename !== ':memory:') {
      fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    }
    connection = new Database(filename);
    connection.pragma('journal_mode = WAL');
    connection.pragma('foreign_keys = ON');
  }

  connection.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      category TEXT NOT NULL CHECK (category IN ('Food', 'Travel', 'Shopping', 'Bills', 'Healthcare', 'Other')),
      transaction_date TEXT NOT NULL,
      payment_mode TEXT NOT NULL DEFAULT 'Unknown',
      raw_alert_text TEXT,
      dedupe_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_category_date
      ON transactions(category, transaction_date);
    CREATE INDEX IF NOT EXISTS idx_transactions_merchant_date
      ON transactions(merchant, transaction_date);

    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL CHECK (category IN ('Food', 'Travel', 'Shopping', 'Bills', 'Healthcare', 'Other')),
      budget_limit REAL NOT NULL CHECK (budget_limit > 0),
      period_month TEXT NOT NULL CHECK (
        length(period_month) = 7 AND
        substr(period_month, 5, 1) = '-' AND
        CAST(substr(period_month, 6, 2) AS INTEGER) BETWEEN 1 AND 12
      ),
      UNIQUE(category, period_month)
    );
  `);

  return connection;
}

function getDatabase() {
  return initDatabase();
}

function insertTransaction(transaction) {
  const db = getDatabase();
  const insert = db.prepare(`
    INSERT INTO transactions
      (merchant, amount, category, transaction_date, payment_mode, raw_alert_text, dedupe_key)
    VALUES
      (@merchant, @amount, @category, @transactionDate, @paymentMode, @rawAlertText, @dedupeKey)
  `);

  try {
    const result = insert.run({
      merchant: transaction.merchant,
      amount: transaction.amount,
      category: transaction.category,
      transactionDate: transaction.transactionDate,
      paymentMode: transaction.paymentMode || 'Unknown',
      rawAlertText: transaction.rawAlertText || null,
      dedupeKey: transaction.dedupeKey || null,
    });
    return { inserted: true, transaction: getTransactionById(result.lastInsertRowid) };
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' && transaction.dedupeKey) {
      const existing = findTransactionByDedupeKey(transaction.dedupeKey);
      if (existing) return { inserted: false, transaction: existing };
    }
    throw error;
  }
}

function getTransactionById(id) {
  return getDatabase()
    .prepare('SELECT * FROM transactions WHERE id = ?')
    .get(id) || null;
}

function findTransactionByDedupeKey(dedupeKey) {
  if (!dedupeKey) return null;
  return getDatabase()
    .prepare('SELECT * FROM transactions WHERE dedupe_key = ?')
    .get(dedupeKey) || null;
}

function findPotentialDuplicate(transaction) {
  const sql = `
    SELECT * FROM transactions
    WHERE lower(trim(merchant)) = lower(trim(?))
      AND abs(amount - ?) < 0.005
      AND substr(transaction_date, 1, 10) = substr(?, 1, 10)
      AND (? IS NULL OR id != ?)
    ORDER BY id DESC
    LIMIT 1
  `;
  return getDatabase()
    .prepare(sql)
    .get(
      transaction.merchant,
      transaction.amount,
      transaction.transactionDate,
      transaction.id ?? null,
      transaction.id ?? null,
    ) || null;
}

function getMonthlySpend(category, periodMonth) {
  const row = getDatabase()
    .prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM transactions
      WHERE category = ? AND substr(transaction_date, 1, 7) = ?
    `)
    .get(category, periodMonth);
  return row.total;
}

function getBudget(category, periodMonth) {
  return getDatabase()
    .prepare(`
      SELECT * FROM budgets
      WHERE category = ? AND period_month = ?
    `)
    .get(category, periodMonth) || null;
}

function setBudget({ category, budgetLimit, periodMonth }) {
  const result = getDatabase()
    .prepare(`
      INSERT INTO budgets (category, budget_limit, period_month)
      VALUES (@category, @budgetLimit, @periodMonth)
      ON CONFLICT(category, period_month)
      DO UPDATE SET budget_limit = excluded.budget_limit
    `)
    .run({ category, budgetLimit, periodMonth });
  return getBudget(category, periodMonth) || { id: result.lastInsertRowid, category, budget_limit: budgetLimit, period_month: periodMonth };
}

function closeDatabase() {
  if (connection) {
    connection.close();
    connection = null;
  }
}

module.exports = {
  CATEGORIES,
  initDatabase,
  getDatabase,
  insertTransaction,
  getTransactionById,
  findTransactionByDedupeKey,
  findPotentialDuplicate,
  getMonthlySpend,
  getBudget,
  setBudget,
  closeDatabase,
};
