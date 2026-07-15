const express = require('express');
const { findTrackingTicket } = require('../handlers/trackingHandler');
const clients = require('../config/clients');
const logger = require('../utils/logger');

const router = express.Router();
const esc = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

router.get('/:ticketId', async (req, res) => {
  const id = String(req.params.ticketId || '').trim().slice(0, 32);
  try {
    const sheetIds = [...new Set([
      process.env.GOOGLE_SHEET_ID,
      ...clients.getAll().map(client => client.sheets?.sheetId),
    ].filter(Boolean))];
    let ticket = null;
    for (const sheetId of sheetIds) {
      ticket = await findTrackingTicket(id, sheetId);
      if (ticket) break;
    }
    if (!ticket) return res.status(404).type('html').send('<h1>Ticket not found</h1>');
    const status = String(ticket.status || 'Pending').toLowerCase();
    const step = status.includes('resolv') ? 3 : status.includes('progress') ? 2 : 1;
    res.type('html').send(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ticket #${esc(ticket.ticketId)}</title><style>body{font:16px system-ui;margin:0;background:#f4f7fb;color:#172033}.card{max-width:620px;margin:8vh auto;padding:28px;background:white;border-radius:18px;box-shadow:0 8px 30px #17203318}h1{margin-top:0}.meta{color:#526070}.track{display:flex;align-items:center;margin:32px 0}.node{width:34px;height:34px;border-radius:50%;background:#d9e1ed;display:grid;place-items:center;position:relative;z-index:1}.node.active{background:#2563eb;color:white}.line{height:5px;background:#d9e1ed;flex:1}.line.active{background:#2563eb}.labels{display:flex;justify-content:space-between;color:#526070;font-size:13px}</style><main class="card"><h1>Issue Ticket #${esc(ticket.ticketId)}</h1><p class="meta">${esc(ticket.category)}</p><p>${esc(ticket.description)}</p><div class="track"><span class="node active">✓</span><span class="line ${step > 1 ? 'active' : ''}"></span><span class="node ${step > 1 ? 'active' : ''}">${step > 1 ? '✓' : '2'}</span><span class="line ${step > 2 ? 'active' : ''}"></span><span class="node ${step > 2 ? 'active' : ''}">${step > 2 ? '✓' : '3'}</span></div><div class="labels"><span>Pending</span><span>In-Progress</span><span>Resolved</span></div><p><strong>Current status:</strong> ${esc(ticket.status)}</p></main></html>`);
  } catch (err) {
    logger.error('[Tracking] Lookup failed:', err.message);
    res.status(500).send('Unable to load ticket');
  }
});

module.exports = router;
