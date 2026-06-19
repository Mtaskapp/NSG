// src/adapters/line.js
// LINE Messaging API adapter for SnapBot

const express = require('express');
const line    = require('@line/bot-sdk');
const { processMessage } = require('../conversation/engine');
const logger  = require('../utils/logger');

const router = express.Router();

const lineConfig = {
  channelSecret:      process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

let client;

function initLine() {
  if (!lineConfig.channelSecret || !lineConfig.channelAccessToken) {
    logger.warn('[LINE] Not configured — adapter disabled');
    return null;
  }
  client = new line.messagingApi.MessagingApiClient({ channelAccessToken: lineConfig.channelAccessToken });
  logger.info('[LINE] Adapter initialized');
  return client;
}

// ── Webhook endpoint ──────────────────────────────────────────────────────────
router.post('/',
  line.middleware(lineConfig),
  async (req, res) => {
    res.sendStatus(200);

    for (const event of req.body.events) {
      try {
        await handleLineEvent(event);
      } catch (err) {
        logger.error('[LINE] Error handling event:', err);
      }
    }
  }
);

async function handleLineEvent(event) {
  if (!['message', 'postback'].includes(event.type)) return;

  const userId = event.source.userId;
  let msg;

  if (event.type === 'postback') {
    msg = { platform: 'line', userId, type: 'button', buttonId: event.postback.data, text: event.postback.data };
  } else {
    msg = normalizeMessage(event.message, userId);
  }

  const replies = await processMessage(msg);

  const lineMessages = replies.map(toLineMessage).filter(Boolean);
  if (lineMessages.length > 0) {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: lineMessages.slice(0, 5), // LINE max 5 per reply
    });
  }
}

function normalizeMessage(message, userId) {
  switch (message.type) {
    case 'text':
      return { platform: 'line', userId, type: 'text', text: message.text };
    case 'image':
      return { platform: 'line', userId, type: 'image', mediaUrl: message.id };
    case 'location':
      return {
        platform: 'line', userId, type: 'location',
        location: { lat: message.latitude, lng: message.longitude, address: message.address },
      };
    default:
      return { platform: 'line', userId, type: 'text', text: '' };
  }
}

function toLineMessage(reply) {
  switch (reply.type) {
    case 'text':
      return { type: 'text', text: reply.text };

    case 'buttons':
      return {
        type: 'template',
        altText: reply.text,
        template: {
          type: 'buttons',
          text: reply.text.slice(0, 160),
          actions: reply.buttons.slice(0, 4).map(b => ({
            type: 'postback',
            label: b.label.slice(0, 20),
            data: b.id,
            displayText: b.label,
          })),
        },
      };

    default:
      return null;
  }
}

module.exports = { router, initLine };
