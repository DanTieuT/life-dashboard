// dashboard-context.js — read side of the ChatGPT bridge (see CHATGPT_BRIDGE.md).
// GET only. Returns the same rich context object Telegram JARVIS's system
// prompt is built from (dashboard-lib.js's buildContext), as JSON.
const admin = require('firebase-admin');

// Fallback: load .env directly when netlify dev skips long-value vars
if (!process.env.GPT_BRIDGE_KEY) {
  try {
    const fs = require('fs'), path = require('path');
    fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^#=\s]+)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
  } catch {}
}

const { buildContext, calendarSvc } = require('./dashboard-lib.js');

function initFirebase() {
  if (admin.apps.length > 0) return;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_B64
    ? JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString())
    : require('./service-account.json');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

exports.handler = async (event) => {
  const key = event.queryStringParameters?.key || event.headers?.['x-gpt-key'];
  if (key !== process.env.GPT_BRIDGE_KEY || !process.env.GPT_BRIDGE_KEY) {
    return { statusCode: 401, body: 'Unauthorized' };
  }
  if (event.httpMethod && event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    initFirebase();
    const db = admin.firestore();
    const [snap, calEvents, readableCalendars] = await Promise.all([
      db.doc('users/aqzJe5gq4IVYdKmUIW0pNJGL2ML2/data/main').get(),
      calendarSvc.getUpcomingEvents(14).catch((e) => { console.error('[dashboard-context] calendar error:', e.message); return []; }),
      calendarSvc.getReadableCalendarNames().catch((e) => { console.error('[dashboard-context] calendar list error:', e.message); return []; }),
    ]);
    const data = snap.exists ? snap.data() : {};
    const ctx = buildContext(data);
    ctx.calendarEvents = calendarSvc.formatForPrompt(calEvents);
    // Authoritative answer to "what calendars can you see" — without this,
    // an empty calendar (no events in the 14-day window) is indistinguishable
    // from one that's genuinely inaccessible.
    ctx.readableCalendars = readableCalendars;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ctx),
    };
  } catch (e) {
    console.error('dashboard-context error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
