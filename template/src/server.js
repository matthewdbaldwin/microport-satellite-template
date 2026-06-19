'use strict';
require('dotenv').config();
const app = require('./app');
const logger = require('./lib/logger');

const PORT = process.env.PORT || 4100;
app.listen(PORT, () => logger.info(`__APP_NAME__ API listening on :${PORT}`));
