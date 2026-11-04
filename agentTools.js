'use strict';
const tools = require('./tools');
const gmail = require('./gmail');
const https = require('https');

// --- TELEGRAM SETUP (From your teammate's code) ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegramAlert(message) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("⚠️ Telegram token/chat ID missing in .env, skipping Telegram.");
    return;
  }

  const postData = JSON.stringify({
    chat_id: TELEGRAM_CHAT_ID.trim(),
    text: message
    // parse_mode removed to fix "can't parse entities" error
  });

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${TELEGRAM_TOKEN.trim()}/sendMessage`,
    method: 'POST',
    family: 4, // Force IPv4 (fixes WSL DNS issues)
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    },
    rejectUnauthorized: false // Bypass SSL verification (fixes WSL cert issues)
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log("📱 Telegram alert sent!");
        } else {
          console.log("⚠️ Telegram Error Response:", data);
        }
        resolve();
      });
    });

    req.on('error', (error) => {
      console.error("❌ Telegram Request Error:", error.message);
      resolve();
    });

    req.write(postData);
    req.end();
  });
}

// --- EXPORTS ---
module.exports = {
  extractTransaction: (text) => {
    const res = tools.extractTransaction(text);
    if (!res.ok) throw new Error(res.error.message);
    return { 
      merchant: res.transaction.merchant || 'Unknown', 
      amount: res.transaction.amount, 
      date: res.transaction.transactionDate || new Date().toISOString().split('T')[0] 
    };
  },

  categorizeExpense: (merchant) => {
    const res = tools.categorizeExpense(merchant);
    if (!res.ok) throw new Error(res.error.message);
    return res.category;
  },

  checkBudget: (category, amount) => {
    const res = tools.checkBudget(category, amount);
    if (!res.ok) throw new Error(res.error.message);
    return {
      overBudget: res.exceedsBudget === true,
      spent: res.spent,
      limit: res.budgetLimit || 0
    };
  },

  flagAnomaly: (transaction) => {
    const res = tools.flagAnomaly({ ...transaction, transactionDate: transaction.date });
    if (!res.ok) throw new Error(res.error.message);
    return {
      flagged: res.isAnomaly,
      reason: res.flags.map(f => f.type).join(', ') || 'None'
    };
  },

  saveTransaction: (data) => {
    const payload = { 
      ...data, 
      transactionDate: data.date, 
      rawAlertText: data.rawText // Use the real text instead of 'manual'
    };
    const res = tools.saveTransaction(payload);
    if (!res.ok) throw new Error(res.error.message);
    return { id: res.transaction.id };
  },

  // THIS SENDS TO CONSOLE, TELEGRAM, AND GMAIL
  sendAlert: async (message) => {
    // 1. Log locally
    tools.sendAlert(message); 
    
    // 2. Send to Telegram (your teammate's code)
    await sendTelegramAlert(message);

    // 3. Send to Gmail
    try {
      await gmail.sendEmail("BudgetBuddy Alert", message);
    } catch (err) {
      console.error("⚠️ Gmail send failed:", err.message);
    }

    return { sent: true };
  }
};