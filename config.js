'use strict';

/**
 * Environment handling for Group 3. Loads .env, validates values, fails fast.
 * Secrets such as ANTHROPIC_API_KEY are intentionally NOT read here (Group 1 owns them).
 */
require('dotenv').config();

function readNumber(name, fallback, { min = 0, max = Infinity, integer = false } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  const ok = Number.isFinite(value) && value >= min && value <= max;
  if (!ok || (integer && !Number.isInteger(value))) {
    throw new Error(`Invalid environment variable ${name}="${raw}" (expected ${integer ? 'an integer' : 'a number'} between ${min} and ${max})`);
  }
  return value;
}

function readBoolean(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

const nodeEnv = process.env.NODE_ENV || 'development';
const useMocks = process.argv.includes('--mock') || readBoolean('USE_MOCKS', false);

if (useMocks && nodeEnv === 'production') {
  throw new Error('Mock adapters are not allowed when NODE_ENV=production.');
}

const currency = (process.env.CURRENCY || 'INR').trim().toUpperCase();
if (!/^[A-Z]{3}$/.test(currency)) {
  throw new Error(`Invalid environment variable CURRENCY="${process.env.CURRENCY}" (expected a 3-letter code)`);
}

const config = Object.freeze({
  nodeEnv,
  port: readNumber('PORT', 3000, { min: 0, max: 65535, integer: true }),
  useMocks,
  maxAlertLength: readNumber('MAX_ALERT_LENGTH', 1000, { min: 1, max: 20000, integer: true }),
  report: Object.freeze({
    largeSpendThreshold: readNumber('LARGE_SPEND_THRESHOLD', 10000, { min: 0.01 }),
    duplicateWindowMinutes: readNumber('DUPLICATE_WINDOW_MINUTES', 10, { min: 0, max: 1440 }),
    currency,
  }),
});

module.exports = config;
