'use strict';

const express = require('express');
const defaultConfig = require('./config');
const { buildReport } = require('./report');
const { AppError } = require('./errors');

/** Real integration by default; mocks only when explicitly requested. */
function selectAdapters(config) {
  return config.useMocks ? require('./mocks') : require('./integration');
}

function validateAlertBody(body, maxLength) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(400, 'INVALID_REQUEST', 'Request body must be a JSON object like {"alert": "..."}.');
  }
  if (body.alert === undefined) {
    throw new AppError(400, 'INVALID_REQUEST', 'Missing required field "alert".');
  }
  if (typeof body.alert !== 'string') {
    throw new AppError(400, 'INVALID_REQUEST', 'Field "alert" must be a string.');
  }
  const alert = body.alert.trim();
  if (alert.length === 0) {
    throw new AppError(400, 'INVALID_REQUEST', 'Field "alert" must not be empty.');
  }
  if (alert.length > maxLength) {
    throw new AppError(400, 'INVALID_REQUEST', `Field "alert" must be at most ${maxLength} characters.`);
  }
  if (alert.includes('\u0000')) {
    throw new AppError(400, 'INVALID_REQUEST', 'Field "alert" contains invalid characters.');
  }
  return alert;
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createApp({ config = defaultConfig, adapters = selectAdapters(config), logger = console } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  // Failures inside Group 1/2 code become clean 500s; AppErrors (e.g. 503 not available) pass through.
  const wrapUpstream = (err, code, message) => {
    if (err instanceof AppError) return err;
    logger.error(`[${code}]`, err);
    const details = config.nodeEnv === 'production' ? undefined : { cause: err && err.message };
    return new AppError(500, code, message, details);
  };

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', mode: config.useMocks ? 'mock' : 'live' });
  });

  app.post('/process-alert', asyncHandler(async (req, res) => {
    const alert = validateAlertBody(req.body, config.maxAlertLength);
    let result;
    try {
      result = await adapters.processAlert(alert);
    } catch (err) {
      throw wrapUpstream(err, 'AGENT_ERROR', 'The alert could not be processed.');
    }
    res.status(200).json({ success: true, result: result ?? null });
  }));

  app.get('/report', asyncHandler(async (req, res) => {
    let transactions;
    try {
      transactions = await adapters.getAllTransactions();
    } catch (err) {
      throw wrapUpstream(err, 'DB_ERROR', 'Transactions could not be loaded.');
    }
    if (!Array.isArray(transactions)) {
      throw new AppError(500, 'CONTRACT_MISMATCH', 'Database module did not return an array of transactions.');
    }
    res.json(buildReport(transactions, config.report));
  }));

  app.use((req, res, next) => {
    next(new AppError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let appErr = err;
    if (err && err.type === 'entity.parse.failed') {
      appErr = new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON.');
    } else if (err && err.type === 'entity.too.large') {
      appErr = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    } else if (!(err instanceof AppError)) {
      logger.error('[INTERNAL_ERROR]', err);
      appErr = new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    const body = { success: false, error: { code: appErr.code, message: appErr.message } };
    if (appErr.details) body.error.details = appErr.details;
    res.status(appErr.status).json(body);
  });

  return app;
}

module.exports = { createApp, validateAlertBody };

if (require.main === module) {
  const config = defaultConfig;
  const adapters = selectAdapters(config);
  const app = createApp({ config, adapters });
  const server = app.listen(config.port, () => {
    console.log(`BudgetBuddy API listening on http://localhost:${config.port} (${config.useMocks ? 'MOCK' : 'LIVE'} mode)`);
    if (config.useMocks) {
      console.warn('WARNING: using temporary mock adapters. Data is in-memory only.');
    } else if (adapters.describe) {
      for (const [name, info] of Object.entries(adapters.describe())) {
        if (!info.present) console.warn(`NOTE: ${name} module not found at ${info.path}; related endpoints return 503 until it exists.`);
      }
    }
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
