// Structured logger. pino — pino-http attaches a per-request child carrying the
// correlation id, so log.error inside a handler is traceable end-to-end.
'use strict';
const pino = require('pino');

const logger = pino({
  name: '__APP_SLUG__-api',
  level: process.env.LOG_LEVEL || 'info',
  base: { service: '__APP_SLUG__-api', env: process.env.NODE_ENV || 'development' },
});

module.exports = logger;
