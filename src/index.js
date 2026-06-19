// src/index.js
require('dotenv').config();

const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const logger    = require('./utils/logger');

// WhatsApp adapter only
const { router: waRouter } = require('./adapters/whatsapp');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.set('trust proxy', 1);

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));

const limiter = rateLimit({
  windowMs: 60000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/webhook', limiter);

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

const WA_PATH = process.env.WA_WEBHOOK_PATH || '/webhook/whatsapp';
app.use(WA_PATH, waRouter);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, _next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  logger.info(`🚀 SnapBot listening on port ${PORT}`);
  logger.info(`   WhatsApp → POST ${WA_PATH}`);
  logger.info(`   Health   → GET  /health`);
});

module.exports = app;