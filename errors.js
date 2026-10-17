'use strict';

/**
 * Error with an HTTP status and a stable machine-readable code.
 * Anything that is NOT an AppError is treated as an unexpected 500.
 */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = { AppError };
