// src/conversation/engine.js
// Platform-agnostic conversation state machine.
// Receives a normalized message object, returns a list of reply objects.

const { v4: uuidv4 } = require('uuid');
const { getSession, updateSession, clearSession } = require('../utils/sessionStore');
const sheetsHandler = require('../handlers/sheetsHandler');
const logger = require('../utils/logger');

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
          text: `👋 *Welcome to SnapBot*\n\nYour civic issue reporting assistant.\n\n📋 I'll help you report a problem to the right department quickly.\n\n─────────────────\n🔽 What type of issue are you reporting?`,
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
        text: `✅ *Selected:* ${issue.label}\n\n─────────────────\n📝 *Please describe the problem in a few words.*\n\n_Example: "The streetlight on Oak Street has been out for 3 days."_`,
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
        text: `📸 *Can you share a photo?*\n\nThis helps the department assess urgency.\nType *skip* to proceed without a photo.`,
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
        text: `✅ *Review your report*\n\n` +
              `📌 *Issue:* ${d.issueLabel}\n` +
              `📝 *Description:* ${d.description}\n` +
              `📍 *Location:* ${d.location}\n` +
              `📸 *Photo:* ${photoUrl ? 'Attached ✓' : 'Not provided'}\n` +
              `🏢 *Assigned to:* ${dept.name}\n\n` +
              `─────────────────\n🔽 Submit this report?`,    }, {
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
        text: `🎉 *Report submitted successfully!*\n\n` +
              `🆔 *Case ID:* ${caseId}\n` +
              `🏢 *Assigned to:* ${dept.name}\n` +
              `📧 *Contact:* ${dept.contact}\n\n` +
              `─────────────────\n` +
              `🕐 You'll receive a response within *2 business days*.\n\n` +
              `💪 Thank you for making your community better!\n\n` +
              `_Send "hi" to report another issue._`,
    }];
  }

  // ── FALLBACK ─────────────────────────────────────────────────────────────
  return [{
    type: 'text',
    text: `I didn't understand that. Send "hi" to start reporting an issue, or "help" for assistance.`,
  }];
}

module.exports = { processMessage };
