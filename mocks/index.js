'use strict';

/** Mock adapter. Same shape as ../integration.js. Only loaded via --mock / USE_MOCKS=true. */

const mockAgent = require('./mock-agent');
const mockDb = require('./mock-db');

module.exports = {
  processAlert: mockAgent.processAlert,
  getAllTransactions: mockDb.getAllTransactions,
  reset: mockDb.reset,
  isMock: true,
};
