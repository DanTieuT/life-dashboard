// Diagnostic endpoint: lists every calendar visible on the configured Apple
// ID via CalDAV, and which one apple-calendar.js has picked as the active
// one for JARVIS reads/writes (APPLE_CALENDAR_NAME env var, or first writable).
const appleCalendar = require('./apple-calendar.js');

exports.handler = async () => {
  const headers = { 'Content-Type': 'application/json' };
  try {
    const calendars = await appleCalendar.getCalendars();
    return { statusCode: 200, headers, body: JSON.stringify({ calendars }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
