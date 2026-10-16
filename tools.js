'use strict';

const crypto = require('node:crypto');
const db = require('./db');

const CATEGORIES = db.CATEGORIES;
const LARGE_EXPENSE_THRESHOLD = 10000;

function errorResult(error, code = 'INVALID_INPUT') {
  return { ok: false, error: { code, message: error } };
}

function normalizeDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const input = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-]+Z?)?$/.test(input)) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [year, month, day] = input.split('-').map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    return input;
  }
  return date.toISOString();
}

function normalizeMonth(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  return value;
}

function validAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function inferPaymentMode(text) {
  if (/\bUPI\b|VPA|@(?:ok|ybl|apl|paytm)/i.test(text)) return 'UPI';
  if (/\bcredit card\b|\bdebit card\b|\bcard ending\b|\bcard\s+\*{2,}/i.test(text)) return 'Card';
  if (/\bNEFT\b|\bIMPS\b|\bRTGS\b|\bnet banking\b|\binternet banking\b/i.test(text)) return 'Bank transfer';
  if (/\bwallet\b|\bpaytm\b/i.test(text)) return 'Wallet';
  if (/\bcash\b/i.test(text)) return 'Cash';
  return 'Unknown';
}

function extractAmount(text) {
  const patterns = [
    /(?:₹|INR\b|Rs\.?)\s*([0-9]+(?:,[0-9]{3})*(?:\.\d{1,2})?)/i,
    /\b([0-9]+(?:,[0-9]{3})*(?:\.\d{1,2})?)\s*(?:INR\b|Rupees?\b)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1].replace(/,/g, ''));
  }
  return null;
}

function extractDate(text) {
  let match = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (match) return normalizeDate(match[0]);

  match = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    return normalizeDate(`${match[3]}-${month}-${day}`);
  }
  return null;
}

function extractMerchant(text) {
  const match = text.match(
    /\b(?:paid\s+to|merchant(?:\s+name)?|to|at)\s*[:\-]?\s*(.{2,80}?)(?=\s+(?:on|via|using|ref(?:erence)?|txn|transaction|upi|a\/c|ac|card|dated|for)\b|[.,;]|$)/i,
  );
  if (!match) return null;
  const merchant = match[1]
    .replace(/\b(?:UPI|VPA)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return merchant.length >= 2 ? merchant : null;
}

/**
 * Parse common English-language bank/UPI SMS formats without an LLM.
 * The date or merchant may be null when the alert does not include it.
 */
function extractTransaction(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return errorResult('text must be a non-empty bank or UPI alert string.');
  }

  const rawAlertText = text.trim();
  const amount = extractAmount(rawAlertText);
  const merchant = extractMerchant(rawAlertText);
  const transactionDate = extractDate(rawAlertText);
  if (!amount) return errorResult('Could not find a transaction amount in the alert.', 'PARSE_FAILED');

  return {
    ok: true,
    transaction: {
      merchant,
      amount,
      category: merchant ? categorizeExpense(merchant).category : 'Other',
      transactionDate,
      paymentMode: inferPaymentMode(rawAlertText),
      rawAlertText,
    },
    missingFields: [
      ...(!merchant ? ['merchant'] : []),
      ...(!transactionDate ? ['transactionDate'] : []),
    ],
  };
}

function categorizeExpense(merchant) {
  if (typeof merchant !== 'string' || !merchant.trim()) {
    return errorResult('merchant must be a non-empty string.');
  }
  const value = merchant.toLowerCase();
  const rules = [
    ['Food', /\b(swiggy|zomato|restaurant|cafe|coffee|food|grocery|groceries|domino|pizza|eat)\b/],
    ['Travel', /\b(uber|ola|irctc|railway|metro|airline|airport|flight|bus|taxi|petrol|fuel|rapido)\b/],
    ['Shopping', /\b(amazon|flipkart|myntra|ajio|shopping|retail|store|mall|meesho)\b/],
    ['Bills', /\b(electricity|electric|water bill|broadband|internet bill|mobile recharge|recharge|utility|gas bill|bill payment)\b/],
    ['Healthcare', /\b(hospital|clinic|pharmacy|medical|medicine|health|apollo|diagnostic|chemist)\b/],
  ];

  for (const [category, pattern] of rules) {
    if (pattern.test(value)) return { ok: true, category };
  }
  return { ok: true, category: 'Other' };
}

function flagAnomaly(transaction) {
  if (!transaction || typeof transaction !== 'object') {
    return errorResult('transaction must be an object.');
  }
  const amount = validAmount(transaction.amount);
  const merchant = typeof transaction.merchant === 'string' ? transaction.merchant.trim() : '';
  const transactionDate = normalizeDate(transaction.transactionDate || transaction.transaction_date);
  if (!amount || !merchant || !transactionDate) {
    return errorResult('transaction requires a merchant, positive amount, and valid transactionDate.');
  }

  const flags = [];
  let duplicate = transaction.dedupeKey
    ? db.findTransactionByDedupeKey(transaction.dedupeKey)
    : null;
  if (!duplicate) {
    duplicate = db.findPotentialDuplicate({ ...transaction, merchant, amount, transactionDate });
  }
  if (duplicate && duplicate.id !== transaction.id) {
    flags.push({
      type: 'duplicate',
      message: 'A transaction with the same merchant, amount, and date already exists.',
      transactionId: duplicate.id,
    });
  }
  if (amount >= LARGE_EXPENSE_THRESHOLD) {
    flags.push({
      type: 'unusually_large',
      message: `Amount is at or above the configured default threshold of ${LARGE_EXPENSE_THRESHOLD}.`,
      threshold: LARGE_EXPENSE_THRESHOLD,
    });
  }

  return { ok: true, isAnomaly: flags.length > 0, flags };
}

function saveTransaction(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return errorResult('data must be a transaction object.');
  }
  const merchant = typeof data.merchant === 'string' ? data.merchant.trim() : '';
  const amount = validAmount(data.amount);
  const transactionDate = normalizeDate(data.transactionDate || data.transaction_date);
  const rawAlertText = typeof data.rawAlertText === 'string'
    ? data.rawAlertText.trim()
    : (typeof data.raw_alert_text === 'string' ? data.raw_alert_text.trim() : '');
  const paymentMode = typeof (data.paymentMode || data.payment_mode) === 'string'
    ? (data.paymentMode || data.payment_mode).trim() || 'Unknown'
    : 'Unknown';

  if (!merchant) return errorResult('merchant is required.');
  if (!amount) return errorResult('amount must be a positive finite number.');
  if (!transactionDate) return errorResult('transactionDate must be a valid ISO date or datetime.');

  const category = data.category || categorizeExpense(merchant).category;
  if (!CATEGORIES.includes(category)) {
    return errorResult(`category must be one of: ${CATEGORIES.join(', ')}.`);
  }

  const dedupeKey = rawAlertText
    ? crypto.createHash('sha256').update(rawAlertText.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex')
    : null;
  const transaction = { merchant, amount, category, transactionDate, paymentMode, rawAlertText, dedupeKey };
  const anomaly = flagAnomaly(transaction);
  if (!anomaly.ok) return anomaly;
  const duplicateFlag = anomaly.flags.find((flag) => flag.type === 'duplicate');
  if (duplicateFlag) {
    return {
      ok: true,
      inserted: false,
      duplicate: true,
      transaction: db.getTransactionById(duplicateFlag.transactionId),
      message: 'Duplicate transaction was not saved.',
    };
  }

  try {
    const saved = db.insertTransaction(transaction);
    if (!saved.inserted) {
      return {
        ok: true,
        inserted: false,
        duplicate: true,
        transaction: saved.transaction,
        message: 'Duplicate transaction was not saved.',
      };
    }
    return {
      ok: true,
      inserted: true,
      transaction: saved.transaction,
      anomaly: { isAnomaly: anomaly.isAnomaly, flags: anomaly.flags },
    };
  } catch (error) {
    return errorResult(`Could not save transaction: ${error.message}`, 'DATABASE_ERROR');
  }
}

function checkBudget(category, amount, periodMonth = new Date().toISOString().slice(0, 7)) {
  if (!CATEGORIES.includes(category)) {
    return errorResult(`category must be one of: ${CATEGORIES.join(', ')}.`);
  }
  const normalizedAmount = validAmount(amount);
  if (!normalizedAmount) return errorResult('amount must be a positive finite number.');
  const month = normalizeMonth(periodMonth);
  if (!month) return errorResult('periodMonth must use YYYY-MM format.');

  try {
    const budget = db.getBudget(category, month);
    const spent = db.getMonthlySpend(category, month);
    const projected = spent + normalizedAmount;
    const budgetLimit = budget ? budget.budget_limit : null;
    return {
      ok: true,
      category,
      periodMonth: month,
      spent,
      amount,
      projected,
      budgetLimit,
      remaining: budgetLimit === null ? null : budgetLimit - projected,
      exceedsBudget: budgetLimit === null ? null : projected > budgetLimit,
      budgetSet: budgetLimit !== null,
    };
  } catch (error) {
    return errorResult(`Could not check budget: ${error.message}`, 'DATABASE_ERROR');
  }
}

/**
 * Log an alert locally only; this function does not send SMS or email.
 */
function sendAlert(message) {
  if (typeof message !== 'string' || !message.trim()) {
    return errorResult('message must be a non-empty string.');
  }
  const alert = {
    ok: true,
    logged: true,
    channel: 'console',
    message: message.trim(),
    loggedAt: new Date().toISOString(),
  };
  console.log(`[BudgetBuddy alert] ${alert.message}`);
  return alert;
}

module.exports = {
  extractTransaction,
  categorizeExpense,
  checkBudget,
  flagAnomaly,
  saveTransaction,
  sendAlert,
};
