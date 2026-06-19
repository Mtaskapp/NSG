// src/index.js
// SnapBot — Multi-platform civic issue reporting bot
// Entry point: wires Express, all adapters, and middleware.

require('dotenv').config();

const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const path        = require('path');
const logger      = require('./utils/logger');

// Adapters
const { router: waRouter }               = require('./adapters/whatsapp');
//const { router: tgRouter, initTelegram } = require('./adapters/telegram');
//const { router: lineRouter, initLine }   = require('./adapters/line');
//const { router: webRouter }              = require('./adapters/web');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security middleware ────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP relaxed for widget iframe
app.set('trust proxy', 1);

// CORS (web widget origins)
const allowedOrigins = (process.env.WEB_WIDGET_CORS_ORIGINS || '*').split(',');
app.use(cors({
  origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
  methods: ['GET', 'POST'],
}));

// Rate limiting — protect webhook endpoints
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max:      parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '60'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});
app.use('/webhook', limiter);

// ── Body parsers ──────────────────────────────────────────────────────────────
// WhatsApp / Telegram / Web: JSON body
app.use(express.json({ limit: '5mb' }));

// Static assets (widget CSS/JS if needed)
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    platforms: {
      whatsapp: !!process.env.WA_PHONE_NUMBER_ID,
      telegram: !!process.env.TELEGRAM_BOT_TOKEN,
      line:     !!process.env.LINE_CHANNEL_SECRET,
      web:      process.env.WEB_WIDGET_ENABLED !== 'false',
    },
  });
});

// ── Platform webhooks ─────────────────────────────────────────────────────────
const WA_PATH   = process.env.WA_WEBHOOK_PATH   || '/webhook/whatsapp';
const TG_PATH   = process.env.TELEGRAM_WEBHOOK_PATH || '/webhook/telegram';
const LINE_PATH = process.env.LINE_WEBHOOK_PATH || '/webhook/line';

app.use(WA_PATH,   waRouter);
app.use(TG_PATH,   tgRouter);
app.use(LINE_PATH, lineRouter);

// Web widget API (always enabled unless explicitly disabled)
if (process.env.WEB_WIDGET_ENABLED !== 'false') {
  app.use('/api/chat', webRouter);
  logger.info('[Web] Widget API enabled at /api/chat');
}

// ── 404 / Error handlers ──────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, _next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`🚀 SnapBot listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
  logger.info(`   WhatsApp  → POST ${WA_PATH}`);
  logger.info(`   Telegram  → POST ${TG_PATH}`);
  logger.info(`   LINE      → POST ${LINE_PATH}`);
  logger.info(`   Web API   → POST /api/chat`);
  logger.info(`   Health    → GET  /health`);

  // Boot adapters that need initialization
  initTelegram();
  initLine();
});

module.exports = app; // export for tests
