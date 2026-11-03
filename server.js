'use strict';
require('dotenv').config(); 
const express = require('express');
const defaultConfig = require('./config');
const { buildReport } = require('./report');
const { AppError } = require('./errors');
const { processAlert } = require('./agent'); // WE WILL CREATE THIS NEXT
const gmail = require('./gmail');

function validateAlertBody(body, maxLength) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(400, 'INVALID_REQUEST', 'Request body must be a JSON object like {"text": "..."}');
  }
  // Changed to 'text' to match your interface contract
  if (body.text === undefined) {
    throw new AppError(400, 'INVALID_REQUEST', 'Missing required field "text".');
  }
  if (typeof body.text !== 'string') {
    throw new AppError(400, 'INVALID_REQUEST', 'Field "text" must be a string.');
  }
  const alert = body.text.trim();
  if (alert.length === 0) {
    throw new AppError(400, 'INVALID_REQUEST', 'Field "text" must not be empty.');
  }
  if (alert.length > maxLength) {
    throw new AppError(400, 'INVALID_REQUEST', `Field "text" must be at most ${maxLength} characters.`);
  }
  return alert;
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createApp({ config = defaultConfig, logger = console } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use(express.static(__dirname));
  app.get('/', (req, res) => res.sendFile(__dirname + '/dashboard.html'));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', mode: 'live' });
  });

  // THE REAL AGENT ENDPOINT
  app.post('/process-alert', asyncHandler(async (req, res) => {
    const alertText = validateAlertBody(req.body, config.maxAlertLength || 2000);
    try {
      // Call the Agent we are about to write
      const result = await processAlert(alertText);
      res.status(200).json(result);
    } catch (err) {
      logger.error('[AGENT_ERROR]', err);
      throw new AppError(500, 'AGENT_ERROR', 'The alert could not be processed.');
    }
  }));

  // REPORT ENDPOINT (Uses Group 2's DB)
  app.get('/report', asyncHandler(async (req, res) => {
    try {
      const db = require('./db');
      // We will assume db has a function to get all transactions.
      // If it's called something else in db.js, adjust this line.
      const transactions = db.getAllTransactions ? db.getAllTransactions() : []; 
      res.json(buildReport(transactions, config.report));
    } catch (err) {
      throw new AppError(500, 'DB_ERROR', 'Transactions could not be loaded.');
    }
  }));

  // GMAIL ROUTES (Now safely inside the app)
  app.get("/auth", (req, res) => res.redirect(gmail.authUrl()));
  app.get("/auth/callback", asyncHandler(async (req, res) => {
    await gmail.handleCallback(req.query.code);
    res.send("Gmail connected. You can close this tab.");
  }));


  app.get('/transactions', asyncHandler(async (req, res) => {
    try {
      const db = require('./db');
      // Assuming Group 2's db exports a function to get all rows. 
      // If this errors, check db.js for the correct name.
      const transactions = db.getAllTransactions ? db.getAllTransactions() : [];
      res.json(transactions);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  
  // ERROR HANDLERS
  app.use((req, res, next) => {
    next(new AppError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));
  });

  app.use((err, req, res, next) => {
    let appErr = err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    res.status(appErr.status).json({ success: false, error: { code: appErr.code, message: appErr.message } });
  });

  return app;
}

// START SERVER
if (require.main === module) {
  const app = createApp();
  const server = app.listen(defaultConfig.port, () => {
    console.log(`BudgetBuddy API listening on http://localhost:${defaultConfig.port} (LIVE mode)`);
    
    // Start Gmail polling in the background
    setInterval(async () => {
      try {
        const alerts = await gmail.fetchNewAlerts();
        for (const a of alerts) {
          console.log("Processing new email:", a.id);
          await fetch(`http://localhost:${defaultConfig.port}/process-alert`, {
            method: "POST", 
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: a.text }),
          });
        }
      } catch (err) {
        console.error("Gmail poll error:", err.message);
      }
    }, 2 * 60 * 1000); // 2 minutes
  });
}
module.exports = { createApp };