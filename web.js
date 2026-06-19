// src/adapters/web.js
// Web chat widget adapter for SnapBot.
// Exposes a stateless REST API that the embeddable widget calls.
// POST /api/chat  { userId, text, buttonId }  → { replies: [...] }

const express = require('express');
const { processMessage } = require('../conversation/engine');
const logger  = require('../utils/logger');

const router = express.Router();

/**
 * POST /api/chat
 * Body: { userId: string, text?: string, buttonId?: string, type?: string }
 * Returns: { replies: Array<{ type, text, buttons? }> }
 */
router.post('/', async (req, res) => {
  try {
    const { userId, text, buttonId, type = 'text' } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const msg = {
      platform: 'web',
      userId: String(userId),
      type: buttonId ? 'button' : type,
      text: text || '',
      buttonId: buttonId || null,
    };

    logger.info(`[Web] userId=${userId} type=${msg.type} input="${buttonId || text}"`);

    const replies = await processMessage(msg);
    res.json({ replies });
  } catch (err) {
    logger.error('[Web] Error processing message:', err);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

module.exports = { router };
