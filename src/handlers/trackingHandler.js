const { google } = require('googleapis');
const logger = require('../utils/logger');

const SHEET_NAME = process.env.GOOGLE_SHEET_TAB || 'Cases';
let cachedSheets;
async function getSheets() {
  if (cachedSheets) return cachedSheets;
  const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
  const auth = process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? new google.auth.GoogleAuth({ keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS, scopes })
    : new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      scopes,
    });
  cachedSheets = google.sheets({ version: 'v4', auth });
  return cachedSheets;
}

async function appendTrackingRow(row, sheetId) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({ spreadsheetId: sheetId || process.env.GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A:H`, valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', resource: { values: [row] } });
}

async function findTrackingTicket(ticketId, sheetId) {
  const target = sheetId || process.env.GOOGLE_SHEET_ID;
  if (!target) return null;
  const sheets = await getSheets();
  const result = await sheets.spreadsheets.values.get({ spreadsheetId: target, range: `${SHEET_NAME}!A:H` });
  const rows = result.data.values || [];
  const row = rows.slice(1).find(values => String(values[0] || '').toUpperCase() === ticketId.toUpperCase());
  if (!row) return null;
  return { ticketId: row[0], timestamp: row[1], phoneNumber: row[2], category: row[3], description: row[4], locationUrl: row[5], imageUrl: row[6], status: row[7] || 'Pending' };
}

module.exports = { appendTrackingRow, findTrackingTicket };
