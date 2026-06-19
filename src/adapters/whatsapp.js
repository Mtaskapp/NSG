// src/adapters/whatsapp.js  (multi-tenant)
// Meta WhatsApp Cloud API adapter for SnapBot.
// Supports multiple clients, each with their own phone number and Google Sheet.

const express = require('express');
const axios   = require('axios');
const { processMessage } = require('../conversation/engine');
const clients = require('../config/clients');
const logger  = require('../utils/logger');

const router   = express.Router();
const BASE_URL = 'https://graph.facebook.com/v19.0';

// ── Webhook verification (GET) ────────────────────────────────────────────────
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe') {
    const client = clients.getByVerifyToken(token);
    if (client) {
      logger.info(`[WhatsApp] Webhook verified for client: ${client.id}`);
      return res.status(200).send(challenge);
    }
  }

  logger.warn('[WhatsApp] Webhook verification failed — token did not match any client');
  res.sendStatus(403);
});

// ── Incoming messages (POST) ──────────────────────────────────────────────────
router.post('/', async (req, res) => {
  res.sendStatus(200);

  try {
    const entry   = req.body?.entry?.[0];
    const changes = entry?.changes?.[0]?.value;
    if (!changes?.messages) return;

    const phoneNumberId = changes.metadata?.phone_number_id;
    const client        = clients.getByPhoneNumberId(phoneNumberId);

    if (!client) {
      logger.warn(`[WhatsApp] Unknown phoneNumberId: ${phoneNumberId}`);
      return;
    }

    for (const waMsg of changes.messages) {
      const msg     = normalizeMessage(waMsg, client.id, client.sheets.sheetId);
      const replies = await processMessage(msg);
      for (const reply of replies) {
        await sendMessage(waMsg.from, reply, client);
      }
    }
  } catch (err) {
    logger.error('[WhatsApp] Error processing message:', err);
  }
});

function normalizeMessage(waMsg, clientId, sheetId) {
  const platform = `whatsapp:${clientId}`;
  const base     = { platform, userId: waMsg.from, type: waMsg.type, clientId, sheetId };

  switch (waMsg.type) {
    case 'text':
      return { ...base, text: waMsg.text.body };
    case 'interactive': {
      const btn = waMsg.interactive?.button_reply || waMsg.interactive?.list_reply;
      return { ...base, type: 'button', buttonId: btn?.id, text: btn?.title };
    }
    case 'image':
      return { ...base, mediaUrl: waMsg.image?.id };
    case 'location':
      return {
        ...base,
        location: {
          lat: waMsg.location.latitude, lng: waMsg.location.longitude,
          address: waMsg.location.address || waMsg.location.name,
        },
      };
    default:
      return { ...base, text: '' };
  }
}

async function sendMessage(to, reply, client) {
  const { phoneNumberId, accessToken } = client.whatsapp;
  let payload;

  switch (reply.type) {
    case 'text':
      payload = {
        messaging_product: 'whatsapp', to, type: 'text',
        text: { body: reply.text, preview_url: false },
      };
      break;

    case 'buttons':
      if (reply.buttons.length <= 3) {
        payload = {
          messaging_product: 'whatsapp', to, type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: reply.text },
            action: {
              buttons: reply.buttons.slice(0, 3).map(b => ({
                type: 'reply',
                reply: { id: b.id, title: b.label.slice(0, 20) },
              })),
            },
          },
        };
      } else {
        payload = {
          messaging_product: 'whatsapp', to, type: 'interactive',
          interactive: {
            type: 'list',
            body: { text: reply.text },
            action: {
              button: 'Choose option',
              sections: [{ title: 'Options', rows: reply.buttons.map(b => ({ id: b.id, title: b.label.slice(0, 24) })) }],
            },
          },
        };
      }
      break;

    default:
      logger.warn(`[WhatsApp:${client.id}] Unknown reply type: ${reply.type}`);
      return;
  }

  try {
    await axios.post(`${BASE_URL}/${phoneNumberId}/messages`, payload, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    logger.error(`[WhatsApp:${client.id}] Send failed:`, err.response?.data || err.message);
  }
}

module.exports = router;
