'use strict';

/**
 * INTEGRATION POINTS with the other groups. This is the ONLY file in Group 3
 * that knows about agent.js (Group 1) and db.js (Group 2).
 *
 * ASSUMED CONTRACTS (tell Group 3 if these change; only this file needs editing):
 *
 *  Group 1 - ./agent.js
 *    processAlert(alertText: string): Promise<object>
 *      - Runs the Claude tool-use loop for ONE raw bank/UPI alert string.
 *      - Persists the parsed transaction itself (via Group 2's tools.js).
 *      - Resolves with a JSON-serialisable summary (e.g. { status, transaction, message }).
 *      - Rejects/throws on failure.
 *
 *  Group 2 - ./db.js
 *    getAllTransactions(): Transaction[] | Promise<Transaction[]>
 *      Transaction = {
 *        id: string|number,
 *        amount: number,                  // positive, in major currency units (e.g. rupees)
 *        type?: 'debit' | 'credit',       // defaults to 'debit' when absent
 *        merchant: string,
 *        category: string,                // may be null/empty -> "Uncategorized"
 *        date: string,                    // ISO-8601 (or anything `new Date()` parses)
 *      }
 *
 * Both CommonJS (module.exports / exports.fn) and ESM (export function / export default {...})
 * are supported. Modules are loaded lazily, so the server can start before they exist.
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { AppError } = require('./errors');

function createIntegration(paths = {}) {
  const files = {
    agent: paths.agentPath || path.resolve(__dirname, 'agent.js'),
    db: paths.dbPath || path.resolve(__dirname, 'db.js'),
  };
  const owners = { agent: 'Group 1 (agent.js)', db: 'Group 2 (db.js)' };
  const cache = new Map();

  async function loadModule(name) {
    if (cache.has(name)) return cache.get(name);
    const file = files[name];
    if (!fs.existsSync(file)) {
      throw new AppError(
        503,
        'MODULE_UNAVAILABLE',
        `${owners[name]} is not available yet.`,
        { expectedPath: file, hint: 'Run with --mock (npm run start:mock) to use temporary mocks.' }
      );
    }
    try {
      const mod = await import(pathToFileURL(file).href);
      cache.set(name, mod);
      return mod;
    } catch (err) {
      throw new AppError(500, 'MODULE_LOAD_FAILED', `Failed to load ${owners[name]}.`, { cause: err.message });
    }
  }

  async function resolveFunction(name, fnName) {
    const mod = await loadModule(name);
    const fn = typeof mod[fnName] === 'function' ? mod[fnName]
      : typeof mod.default?.[fnName] === 'function' ? mod.default[fnName]
      : null;
    if (!fn) {
      throw new AppError(500, 'CONTRACT_MISMATCH', `${owners[name]} does not export a function named "${fnName}".`);
    }
    return fn;
  }

  return {
    /** @param {string} alertText @returns {Promise<object>} */
    async processAlert(alertText) {
      const fn = await resolveFunction('agent', 'processAlert');
      return fn(alertText);
    },
    /** @returns {Promise<object[]>} */
    async getAllTransactions() {
      const fn = await resolveFunction('db', 'getAllTransactions');
      return fn();
    },
    /** For startup logging only. */
    describe() {
      return Object.fromEntries(Object.entries(files).map(([k, f]) => [k, { path: f, present: fs.existsSync(f) }]));
    },
  };
}

module.exports = { ...createIntegration(), createIntegration };
