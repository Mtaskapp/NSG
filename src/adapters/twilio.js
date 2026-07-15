// src/adapters/twilio.js
// Twilio WhatsApp adapter for SnapBot.
// Works with both the free Twilio Sandbox and a production WhatsApp Sender —
// no code changes needed when you move from one to the other, only env vars.

const express = require('express');
const twilio = require('twilio');
const { processMessage } = require('../conversation/engine');
const logger = require('../utils/logger');

const router = express.Router();

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER = process.env.TWILIO_WHATSAPP_FROM;   // e.g. "whatsapp:+14155238886"
const APP_URL = process.env.APP_URL;
const WEBHOOK_PATH = process.env.TWILIO_WEBHOOK_PATH || '/webhook/twilio';

let client = null;

function initTwilio() {
  if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) {
    logger.warn('[Twilio] Not configured — adapter disabled');
    return null;
  }
  client = twilio(ACCOUNT_SID, AUTH_TOKEN);
  logger.info(`[Twilio] Adapter initialized — sending from ${FROM_NUMBER}`);
  return client;
}

// Twilio posts application/x-www-form-urlencoded, not JSON — parse it
// on this route only (the rest of the app uses express.json()).
router.use(express.urlencoded({ extended: false }));

// Twilio's basic Messaging API has no native quick-reply buttons unless you
// pre-create approved Content Templates. SnapBot falls back to a numbered
// text list and remembers the last list sent to each user, so a reply of
// "1", "2", etc. maps back to the correct button id.
const lastButtons = new Map(); // "whatsapp:+91..." -> [{ id, label }, ...]

// ── Incoming messages ──────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  // Ack immediately with empty TwiML so Twilio doesn't retry or auto-reply
  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');

  if (!client) return;

  if (AUTH_TOKEN && APP_URL) {
    const signature = req.header('X-Twilio-Signature');
    const fullUrl = `${APP_URL}${WEBHOOK_PATH}`;
    const valid = twilio.validateRequest(AUTH_TOKEN, signature, fullUrl, req.body);
    if (!valid) {
      logger.warn('[Twilio] Invalid request signature — ignoring');
      return;
    }
  } else {
    logger.warn('[Twilio] APP_URL not set — skipping signature validation');
  }

  try {
    const msg = normalizeMessage(req.body);
    const replies = await processMessage(msg);
    for (const reply of replies) {
      await sendMessage(req.body.From, reply);
    }
  } catch (err) {
    logger.error('[Twilio] Error processing message:', err);
  }
});

function normalizeMessage(body) {
  const from = body.From; // "whatsapp:+919226285788"
  const base = {
    platform: 'twilio',
    userId: from,
    clientId: 'default',
    sheetId: process.env.GOOGLE_SHEET_ID,  // ← add this
  };


  // Location share
  if (body.Latitude && body.Longitude) {
    return {
      ...base, type: 'location',
      location: { lat: parseFloat(body.Latitude), lng: parseFloat(body.Longitude) },
    };
  }

  // Photo
  if (parseInt(body.NumMedia || '0', 10) > 0 && body.MediaUrl0) {
    return { ...base, type: 'image', mediaUrl: body.MediaUrl0 };
  }

  const text = (body.Body || '').trim();

  // Numeric reply to a previously sent button list
  const stored = lastButtons.get(from);
  if (stored && /^\d+$/.test(text)) {
    const choice = stored[parseInt(text, 10) - 1];
    if (choice) {
      return { ...base, type: 'button', buttonId: choice.id, text: choice.label };
    }
  }

  return { ...base, type: 'text', text };
}

async function sendMessage(to, reply) {
  let body;

  switch (reply.type) {
    case 'text':
      body = reply.text;
      lastButtons.delete(to);
      break;

    case 'buttons': {
      const lines = reply.buttons.map((b, i) => `${i + 1}. ${b.label}`);
      body = `${reply.text}\n\n${lines.join('\n')}\n\n_Reply with a number_`;
      lastButtons.set(to, reply.buttons);
      break;
    }

    default:
      logger.warn(`[Twilio] Unknown reply type: ${reply.type}`);
      return;
  }

  try {
    await client.messages.create({ from: FROM_NUMBER, to, body });
  } catch (err) {
    logger.error('[Twilio] Send failed:', err.message);
  }
}

module.exports = { router, initTwilio };
