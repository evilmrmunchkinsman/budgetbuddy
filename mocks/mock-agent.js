'use strict';

/**
 * TEMPORARY stand-in for Group 1's agent.js. NO Claude call is made: a few regexes
 * parse the sample alert formats and a keyword map guesses the category.
 */

const mockDb = require('./mock-db');

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const CATEGORY_KEYWORDS = [
  ['Food & Dining', ['cafe', 'biryani', 'dosa', 'chai', 'restaurant', 'kitchen']],
  ['Groceries', ['grocers', 'mart', 'supermarket']],
  ['Transport', ['metro', 'cab', 'petrol', 'fuel']],
  ['Utilities', ['electricity', 'broadband', 'recharge']],
  ['Entertainment', ['cinema', 'stream']],
  ['Health', ['pharmacy', 'clinic']],
  ['Shopping', ['apparel', 'electronics', 'jewellers', 'tailor']],
  ['Travel', ['airways', 'hotel', 'railway']],
];

function guessCategory(merchant) {
  const m = merchant.toLowerCase();
  for (const [category, words] of CATEGORY_KEYWORDS) {
    if (words.some((w) => m.includes(w))) return category;
  }
  return 'Other';
}

function parseAlert(text) {
  const amountMatch = text.match(/(?:Rs\.?|INR)\s?([\d,]+(?:\.\d+)?)/i);
  if (!amountMatch) throw new Error('mock agent: could not find an amount in the alert');
  const amount = Number(amountMatch[1].replace(/,/g, ''));

  const type = /\b(credited|received)\b/i.test(text) ? 'credit' : 'debit';
  const merchantRe = type === 'credit'
    ? /\b(?:by|from)\s+(.+?)(?:\.\s|\.$|\s+Ref\b|$)/i
    : /\b(?:at|to|towards)\s+(.+?)(?:\s+(?:from|on|via|Ref)\b|\s*[.(]|$)/i;
  const merchantMatch = text.match(merchantRe);
  const merchant = merchantMatch ? merchantMatch[1].trim() : 'Unknown';

  let date = new Date();
  const d = text.match(/(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2})/);
  if (d && MONTHS[d[2].toLowerCase()]) {
    const month = String(MONTHS[d[2].toLowerCase()]).padStart(2, '0');
    date = new Date(`${d[3]}-${month}-${d[1]}T${d[4]}:${d[5]}:00+05:30`); // alerts are in IST
  }

  return {
    amount,
    type,
    merchant,
    category: type === 'credit' ? 'Income' : guessCategory(merchant),
    date: date.toISOString(),
    raw_alert: text,
  };
}

async function processAlert(alertText) {
  const parsed = parseAlert(alertText);
  const transaction = await mockDb.insertTransaction(parsed);
  return { status: 'recorded', transaction, note: 'MOCK AGENT - no Claude call was made' };
}

module.exports = { processAlert, parseAlert };
