// src/config/clients.js
// Multi-tenant client registry.
// Loads clients.json and provides lookup helpers used by the WhatsApp adapter.

const fs     = require('fs');
const path   = require('path');
const logger = require('../utils/logger');

const CONFIG_PATH = path.resolve(process.cwd(), 'clients.json');

let _clients = [];

function load() {
  if (!fs.existsSync(CONFIG_PATH)) {
    logger.warn('[Clients] clients.json not found — falling back to single-client env vars');
    // Legacy single-client fallback so existing .env setups keep working
    if (process.env.WA_PHONE_NUMBER_ID) {
      _clients = [{
        id:          'default',
        name:        process.env.CLIENT_NAME || 'SnapBot Default',
        whatsapp: {
          phoneNumberId: process.env.WA_PHONE_NUMBER_ID,
          accessToken:   process.env.WA_ACCESS_TOKEN,
          verifyToken:   process.env.WA_VERIFY_TOKEN,
        },
        sheets: {
          sheetId: process.env.GOOGLE_SHEET_ID,
        },
      }];
    }
    return;
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    _clients  = JSON.parse(raw);
    logger.info(`[Clients] Loaded ${_clients.length} client(s): ${_clients.map(c => c.id).join(', ')}`);
  } catch (err) {
    logger.error('[Clients] Failed to parse clients.json:', err.message);
    process.exit(1);
  }

  // Validate each client
  for (const client of _clients) {
    const missing = [];
    if (!client.id)                          missing.push('id');
    if (!client.whatsapp?.phoneNumberId)     missing.push('whatsapp.phoneNumberId');
    if (!client.whatsapp?.accessToken)       missing.push('whatsapp.accessToken');
    if (!client.whatsapp?.verifyToken)       missing.push('whatsapp.verifyToken');
    if (!client.sheets?.sheetId)             missing.push('sheets.sheetId');
    if (missing.length) {
      logger.error(`[Clients] Client "${client.id}" missing: ${missing.join(', ')}`);
      process.exit(1);
    }
  }
}

/** Find client by WhatsApp Phone Number ID (from webhook payload metadata) */
function getByPhoneNumberId(phoneNumberId) {
  return _clients.find(c => c.whatsapp.phoneNumberId === phoneNumberId) || null;
}

/** Check if a verify token matches any client (used in webhook GET verification) */
function getByVerifyToken(verifyToken) {
  return _clients.find(c => c.whatsapp.verifyToken === verifyToken) || null;
}

/** All clients (for health check, admin, etc.) */
function getAll() {
  return _clients;
}

// Load immediately on require
load();

module.exports = { getByPhoneNumberId, getByVerifyToken, getAll };
