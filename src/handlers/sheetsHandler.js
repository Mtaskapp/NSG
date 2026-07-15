// src/handlers/sheetsHandler.js  (multi-tenant)
// Logs case reports to per-client Google Sheets.
// The sheetId is passed in per call — no global config.

const { google } = require('googleapis');
const logger = require('../utils/logger');

const SHEET_NAME = 'Cases';
const HEADERS = [
  'Case ID', 'Client', 'Platform', 'User ID', 'Issue Type', 'Issue Label',
  'Description', 'Location', 'Photo URL', 'Department',
  'Dept Contact', 'Status', 'Submitted At',
];

// Cache one auth client per service account email (all clients share the same SA)
let _sheetsClient = null;

async function getClient() {
  if (_sheetsClient) return _sheetsClient;

  const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
  const auth = process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? new google.auth.GoogleAuth({ keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS, scopes })
    : new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key:   (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      scopes,
    });

  _sheetsClient = google.sheets({ version: 'v4', auth });
  return _sheetsClient;
}

async function ensureHeaders(sheets, sheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A1:M1`,
  });

  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      resource: { values: [HEADERS] },
    });
    logger.info(`[Sheets] Headers initialised in sheet ${sheetId}`);
  }
}

/**
 * Log a case report to the specified Google Sheet.
 * @param {object} report  - Full case object from engine
 * @param {string} sheetId - Google Sheet ID for this client
 */
async function logCase(report, sheetId) {
  const targetSheet = sheetId || process.env.GOOGLE_SHEET_ID;
  if (!targetSheet) {
    logger.error('[Sheets] No sheetId provided and GOOGLE_SHEET_ID not set');
    return;
  }

  const sheets = await getClient();
  await ensureHeaders(sheets, targetSheet);

  const row = [
    report.caseId,
    report.clientId  || 'default',
    report.platform,
    report.userId,
    report.issueType,
    report.issueLabel,
    report.description,
    report.location,
    report.photoUrl  || '',
    report.department,
    report.departmentContact,
    report.status,
    report.submittedAt,
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: targetSheet,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: { values: [row] },
  });

  logger.info(`[Sheets] Case ${report.caseId} → sheet ${targetSheet}`);
}

module.exports = { logCase };
