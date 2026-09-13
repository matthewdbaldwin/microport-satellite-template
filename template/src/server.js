'use strict';
require('dotenv').config();
const app = require('./app');
const logger = require('./lib/logger');

// Default port is stamped by scaffold.mjs from config.apiPort, which refuses a
// port another satellite already uses. Quoted so the raw template still lints.
const PORT = process.env.PORT || '__API_PORT__';
app.listen(PORT, () => logger.info(`__APP_NAME__ API listening on :${PORT}`));
