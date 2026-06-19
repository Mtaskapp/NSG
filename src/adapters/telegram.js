// src/adapters/telegram.js
// Telegram Bot API adapter for SnapBot

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { processMessage } = require('../conversation/engine');
const logger = require('../utils/logger');

const router  = express.Router();
const TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const USE_WH  = process.env.TELEGRAM_USE_WEBHOOK === 'true';
const APP_URL = process.env.APP_URL;

let bot;

function initTelegram() {
  if (!TOKEN) {
    logger.warn('[Telegram] No token configured — adapter disabled');
    return null;
  }

  if (USE_WH && APP_URL) {
    // Webhook mode (production)
    bot = new TelegramBot(TOKEN, { webHook: false });
    const webhookPath = process.env.TELEGRAM_WEBHOOK_PATH || '/webhook/telegram';
    bot.setWebHook(`${APP_URL}${webhookPath}`).then(() => {
      logger.info(`[Telegram] Webhook set: ${APP_URL}${webhookPath}`);
    });
  } else {
    // Long-polling mode (development)
    bot = new TelegramBot(TOKEN, { polling: true });
    logger.info('[Telegram] Using long-polling (dev mode)');

    bot.on('message', handleTelegramUpdate);
    bot.on('callback_query', handleCallbackQuery);
  }

  return bot;
}

// ── Webhook route (production) ────────────────────────────────────────────────
router.post('/', (req, res) => {
  res.sendStatus(200);
  if (!bot) return;

  const update = req.body;
  if (update.message)        handleTelegramUpdate(update.message);
  if (update.callback_query) handleCallbackQuery(update.callback_query);
});

// ── Handle incoming text/photo/location messages ──────────────────────────────
async function handleTelegramUpdate(message) {
  try {
    const userId = String(message.chat.id);
    const msg    = normalizeMessage(message, userId);
    const replies = await processMessage(msg);

    for (const reply of replies) {
      await sendReply(userId, reply);
    }
  } catch (err) {
    logger.error('[Telegram] Error handling message:', err);
  }
}

// ── Handle inline keyboard button clicks ──────────────────────────────────────
async function handleCallbackQuery(query) {
  try {
    await bot.answerCallbackQuery(query.id);
    const userId = String(query.message.chat.id);
    const msg    = {
      platform: 'telegram',
      userId,
      type: 'button',
      buttonId: query.data,
      text: query.data,
    };
    const replies = await processMessage(msg);
    for (const reply of replies) {
      await sendReply(userId, reply);
    }
  } catch (err) {
    logger.error('[Telegram] Error handling callback:', err);
  }
}

function normalizeMessage(message, userId) {
  if (message.location) {
    return {
      platform: 'telegram', userId, type: 'location',
      location: { lat: message.location.latitude, lng: message.location.longitude },
    };
  }
  if (message.photo) {
    const largest = message.photo[message.photo.length - 1];
    return { platform: 'telegram', userId, type: 'image', mediaUrl: largest.file_id };
  }
  return {
    platform: 'telegram', userId, type: 'text',
    text: message.text || '',
  };
}

// ── Send reply to Telegram ────────────────────────────────────────────────────
async function sendReply(chatId, reply) {
  if (!bot) return;

  switch (reply.type) {
    case 'text':
      await bot.sendMessage(chatId, reply.text, { parse_mode: 'Markdown' });
      break;

    case 'buttons':
      // Build inline keyboard
      const keyboard = chunkArray(reply.buttons, 2).map(row =>
        row.map(b => ({ text: b.label, callback_data: b.id }))
      );
      await bot.sendMessage(chatId, reply.text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
      break;

    default:
      logger.warn(`[Telegram] Unknown reply type: ${reply.type}`);
  }
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

module.exports = { router, initTelegram };
