// src/utils/sessionStore.js
// In-memory store (swap for Redis in production for multi-instance deployments)

const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Returns or creates a session for a given user+platform combo.
 * Key format: "platform:userId"
 */
function getSession(platform, userId) {
  const key = `${platform}:${userId}`;
  const now = Date.now();

  if (sessions.has(key)) {
    const session = sessions.get(key);
    // Refresh TTL on access
    session.lastActive = now;
    return session;
  }

  const newSession = {
    platform,
    userId,
    step: 'WELCOME',
    data: {},
    createdAt: now,
    lastActive: now,
  };
  sessions.set(key, newSession);
  return newSession;
}

// WhatsApp-specific facade. Keeping this behind the same store makes replacing
// the Map with Redis/Postgres a one-module change.
function getWhatsAppSession(phoneNumber, clientId = 'default') {
  const session = getSession(`whatsapp:${clientId}`, phoneNumber);
  if (!session.phone_number) {
    Object.assign(session, {
      phone_number: phoneNumber,
      current_state: 'START',
      category: '',
      description: '',
      location_url: '',
      timestamp: new Date(session.createdAt),
    });
  }
  return session;
}

function updateWhatsAppSession(phoneNumber, updates, clientId = 'default') {
  return updateSession(`whatsapp:${clientId}`, phoneNumber, updates);
}

function clearWhatsAppSession(phoneNumber, clientId = 'default') {
  clearSession(`whatsapp:${clientId}`, phoneNumber);
}

function clearSession(platform, userId) {
  sessions.delete(`${platform}:${userId}`);
}

function updateSession(platform, userId, updates) {
  const session = getSession(platform, userId);
  Object.assign(session, updates);
  session.lastActive = Date.now();
  return session;
}

// Prune expired sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.lastActive > SESSION_TTL_MS) {
      sessions.delete(key);
    }
  }
}, 10 * 60 * 1000);

module.exports = {
  getSession, clearSession, updateSession,
  getWhatsAppSession, updateWhatsAppSession, clearWhatsAppSession,
};
