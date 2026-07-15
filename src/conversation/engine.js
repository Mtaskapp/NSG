// src/conversation/engine.js
// Platform-agnostic conversation state machine.
// Receives a normalized message object, returns a list of reply objects.

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { getSession, updateSession, clearSession } = require('../utils/sessionStore');
const sheetsHandler = require('../handlers/sheetsHandler');
const logger = require('../utils/logger');
const mediaHandler = require('../handlers/mediaHandler');
const trackingHandler = require('../handlers/trackingHandler');
const {
  getWhatsAppSession, updateWhatsAppSession, clearWhatsAppSession,
} = require('../utils/sessionStore');

// ─── Issue categories ────────────────────────────────────────────────────────
const ISSUE_TYPES = [
  { id: 'streetlight', label: '💡 Streetlight' },
  { id: 'park',        label: '🌳 Park / Garden' },
  { id: 'road',        label: '🚧 Road / Pothole' },
  { id: 'cleanliness', label: '🧹 Cleanliness' },
  { id: 'drainage',    label: '🌊 Drainage / Sewage' },
  { id: 'traffic',     label: '🚦 Traffic Signal' },
  { id: 'other',       label: '❓ Other' },
];

// ─── Department routing ───────────────────────────────────────────────────────
const DEPARTMENT_MAP = {
  streetlight: { name: 'Parks & Lighting Dept',  contact: 'lighting@city.gov' },
  park:        { name: 'Parks & Recreation Dept', contact: 'parks@city.gov'    },
  road:        { name: 'Public Works Dept',       contact: 'roads@city.gov'    },
  cleanliness: { name: 'Sanitation Dept',         contact: 'sanitation@city.gov'},
  drainage:    { name: 'Water & Drainage Dept',   contact: 'drainage@city.gov' },
  traffic:     { name: 'Traffic Mgmt Centre',     contact: 'traffic@city.gov'  },
  other:       { name: 'Municipal Office',        contact: 'info@city.gov'     },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function buildButtons(items) {
  // Returns normalized button list (adapters convert to platform format)
  return items.map(i => ({ id: i.id, label: i.label }));
}

// ─── Main engine ─────────────────────────────────────────────────────────────
/**
 * Process an incoming normalized message and return reply instructions.
 *
 * @param {object} msg - { platform, userId, type, text, buttonId, mediaUrl, location }
 * @returns {Promise<Array>} - Array of reply objects: { type, text, buttons, imageUrl }
 */
async function processMessage(msg) {
  const { platform, userId } = msg;
  const session = getSession(platform, userId);
  const input = (msg.buttonId || msg.text || '').trim().toLowerCase();

  logger.info(`[${platform}] User ${userId} | step=${session.step} | input="${input}"`);

  // ── WELCOME ────────────────────────────────────────────────────────────────
  if (session.step === 'WELCOME' || input === 'hi' || input === 'hello' || input === 'start' || input === '/start') {
    updateSession(platform, userId, { step: 'ASK_ISSUE_TYPE' });
    return [
      {
        type: 'text',
        text: `👋 Welcome to *SnapBot* — your civic issue reporting assistant!\n\nI'll help you report a problem to the right department quickly.\n\nWhat type of issue are you reporting?`,
      },
      {
        type: 'buttons',
        text: 'Choose a category:',
        buttons: buildButtons(ISSUE_TYPES),
      },
    ];
  }

  // ── ASK ISSUE TYPE ─────────────────────────────────────────────────────────
  if (session.step === 'ASK_ISSUE_TYPE') {
    const issue = ISSUE_TYPES.find(i => i.id === input || i.label.toLowerCase().includes(input));
    if (!issue) {
      return [{ type: 'text', text: 'Please tap one of the options below 👇' },
              { type: 'buttons', text: 'Issue category:', buttons: buildButtons(ISSUE_TYPES) }];
    }
    updateSession(platform, userId, { step: 'ASK_DESCRIPTION', data: { issueType: issue.id, issueLabel: issue.label } });
    return [{
      type: 'text',
      text: `Got it — *${issue.label}*.\n\nPlease describe the problem in a few words.\n_Example: "The streetlight on Oak Street has been out for 3 days."_`,
    }];
  }

  // ── ASK DESCRIPTION ───────────────────────────────────────────────────────
  if (session.step === 'ASK_DESCRIPTION') {
    if (!msg.text || msg.text.trim().length < 5) {
      return [{ type: 'text', text: 'Please type a brief description of the issue.' }];
    }
    updateSession(platform, userId, { step: 'ASK_LOCATION', data: { ...session.data, description: msg.text.trim() } });
    return [{
      type: 'text',
      text: `📍 Where is this happening?\n\nYou can:\n• Type an address or landmark\n• Share your location (tap 📎 → Location)\n• Or type "skip" to continue without location`,
    }];
  }

  // ── ASK LOCATION ──────────────────────────────────────────────────────────
  if (session.step === 'ASK_LOCATION') {
    let locationText = 'Not provided';

    if (msg.type === 'location' && msg.location) {
      locationText = `📍 ${msg.location.lat}, ${msg.location.lng}`;
      if (msg.location.address) locationText = msg.location.address;
    } else if (msg.text && msg.text.toLowerCase() !== 'skip') {
      locationText = msg.text.trim();
    }

    updateSession(platform, userId, { step: 'ASK_PHOTO', data: { ...session.data, location: locationText } });
    return [{
      type: 'text',
      text: `📸 Can you share a photo of the issue?\n\nThis helps the department assess urgency.\nType "skip" to proceed without a photo.`,
    }];
  }

  // ── ASK PHOTO ─────────────────────────────────────────────────────────────
  if (session.step === 'ASK_PHOTO') {
    let photoUrl = null;
    if (msg.type === 'image' && msg.mediaUrl) {
      photoUrl = msg.mediaUrl;
    }

    const skipPhoto = !photoUrl && msg.text && msg.text.toLowerCase() === 'skip';
    if (!photoUrl && !skipPhoto) {
      return [{ type: 'text', text: 'Please send a photo or type "skip" to continue.' }];
    }

    updateSession(platform, userId, { step: 'CONFIRM', data: { ...session.data, photoUrl } });

    const d = session.data;
    const dept = DEPARTMENT_MAP[d.issueType] || DEPARTMENT_MAP.other;

    return [{
      type: 'text',
      text: `✅ *Review your report:*\n\n` +
            `📌 *Issue:* ${d.issueLabel}\n` +
            `📝 *Description:* ${d.description}\n` +
            `📍 *Location:* ${d.location}\n` +
            `📸 *Photo:* ${photoUrl ? 'Attached' : 'Not provided'}\n` +
            `🏢 *Will be sent to:* ${dept.name}\n\n` +
            `Submit this report?`,
    }, {
      type: 'buttons',
      text: 'Confirm:',
      buttons: [
        { id: 'confirm_yes', label: '✅ Yes, Submit' },
        { id: 'confirm_no',  label: '✏️ Start Over' },
      ],
    }];
  }

  // ── CONFIRM ───────────────────────────────────────────────────────────────
  if (session.step === 'CONFIRM') {
    if (input === 'confirm_no' || input === 'no' || input === 'start over') {
      clearSession(platform, userId);
      return [{ type: 'text', text: '↩️ Report cancelled. Send "hi" to start a new report.' }];
    }

    if (input !== 'confirm_yes' && input !== 'yes') {
      return [{
        type: 'buttons',
        text: 'Please confirm:',
        buttons: [{ id: 'confirm_yes', label: '✅ Yes, Submit' }, { id: 'confirm_no', label: '✏️ Start Over' }],
      }];
    }

    // ── SUBMIT ──────────────────────────────────────────────────────────────
    const caseId = `SB-${Date.now().toString(36).toUpperCase()}`;
    const dept   = DEPARTMENT_MAP[session.data.issueType] || DEPARTMENT_MAP.other;
    const report = {
      caseId,
      platform,
      userId,
      clientId: msg.clientId || 'default',
      ...session.data,
      department: dept.name,
      departmentContact: dept.contact,
      status: 'Open',
      submittedAt: new Date().toISOString(),
    };

    try {
      await sheetsHandler.logCase(report, msg.sheetId);
      logger.info(`Case submitted: ${caseId} by ${userId} on ${platform}`);
    } catch (err) {
      logger.error('Failed to log case to Sheets:', err);
      // Don't block the user — still confirm
    }

    clearSession(platform, userId);

    return [{
      type: 'text',
      text: `🎉 *Report submitted!*\n\n` +
            `🆔 *Case ID:* \`${caseId}\`\n` +
            `🏢 *Assigned to:* ${dept.name}\n` +
            `📧 *Contact:* ${dept.contact}\n\n` +
            `You'll typically receive a response within *2 business days*.\n\n` +
            `Thank you for making your community better! 💪\n\n` +
            `_Send "hi" to report another issue._`,
    }];
  }

  // ── FALLBACK ─────────────────────────────────────────────────────────────
  return [{
    type: 'text',
    text: `I didn't understand that. Send "hi" to start reporting an issue, or "help" for assistance.`,
  }];
}

const CATEGORY_BUTTONS = [
  { id: 'cat_infra', label: '🛣️ Roads & Lights' },
  { id: 'cat_waste', label: '🗑️ Waste & Garbage' },
  { id: 'cat_water', label: '🚰 Water & Leaks' },
];

function ticketId() {
  return `VIW-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

// Exact WhatsApp Cloud API workflow. This is intentionally separate from the
// legacy cross-platform flow above so existing Telegram/LINE users are stable.
async function processWhatsAppMessage(msg, client) {
  const clientId = msg.clientId || client.id || 'default';
  const resetWords = ['hi', 'hello', 'start', 'restart', 'cancel'];
  if (msg.type === 'text' && resetWords.includes((msg.text || '').trim().toLowerCase())) {
    clearWhatsAppSession(msg.userId, clientId);
  }
  const session = getWhatsAppSession(msg.userId, clientId);
  const state = session.current_state;

  if (state === 'START') {
    updateWhatsAppSession(msg.userId, { current_state: 'AWAITING_CATEGORY' }, clientId);
    return [{ type: 'buttons', text: 'Please choose the type of issue:', buttons: CATEGORY_BUTTONS }];
  }
  if (state === 'AWAITING_CATEGORY') {
    const selected = CATEGORY_BUTTONS.find(button => button.id === msg.buttonId);
    if (!selected) return [{ type: 'buttons', text: 'Please choose one of these categories:', buttons: CATEGORY_BUTTONS }];
    updateWhatsAppSession(msg.userId, { current_state: 'AWAITING_DESC', category: selected.id }, clientId);
    return [{ type: 'text', text: 'Got it! Please text us a brief description of the specific problem.' }];
  }
  if (state === 'AWAITING_DESC') {
    if (!msg.text || !msg.text.trim()) return [{ type: 'text', text: 'Please text us a brief description of the specific problem.' }];
    updateWhatsAppSession(msg.userId, { current_state: 'AWAITING_LOC', description: msg.text.trim() }, clientId);
    return [{ type: 'location_request', text: 'Thank you. Now, please tap the location sharing tool below to pin where this issue is located.' }];
  }
  if (state === 'AWAITING_LOC') {
    if (!msg.location) return [{ type: 'text', text: 'Please share the location using WhatsApp’s location sharing tool.' }];
    const { lat, lng } = msg.location;
    updateWhatsAppSession(msg.userId, { current_state: 'AWAITING_IMAGE', location_url: `https://www.google.com/maps?q=${lat},${lng}` }, clientId);
    return [{ type: 'text', text: 'Perfect. Lastly, please snap or upload a clear picture of the issue.' }];
  }
  if (state === 'AWAITING_IMAGE') {
    if (msg.type !== 'image' || !msg.mediaId) return [{ type: 'text', text: 'Please snap or upload a clear picture of the issue.' }];
    try {
      const imageUrl = await mediaHandler.saveWhatsAppImage(msg.mediaId, client.whatsapp.accessToken);
      const id = ticketId();
      const timestamp = new Date().toISOString();
      const row = [id, timestamp, msg.userId, session.category, session.description, session.location_url, imageUrl, 'Pending'];
      await trackingHandler.appendTrackingRow(row, client.sheets.sheetId);
      clearWhatsAppSession(msg.userId, clientId);
      const base = (process.env.APP_URL || '').replace(/\/$/, '');
      const tracking = base ? `\nYou can track real-time resolution progress directly here: ${base}/${id}` : '';
      return [{ type: 'text', text: `Thank you! Your issue has been successfully logged.\n\nTicket ID: #${id}${tracking}` }];
    } catch (err) {
      logger.error(`[WhatsApp:${client.id}] Failed to finalize report:`, err.message);
      return [{ type: 'text', text: '⚠️ Something went wrong saving your report. Please try sending the photo again in a moment.' }];
    }
  }
  clearWhatsAppSession(msg.userId, clientId);
  return processWhatsAppMessage(msg, client);
}

module.exports = { processMessage, processWhatsAppMessage, CATEGORY_BUTTONS };
