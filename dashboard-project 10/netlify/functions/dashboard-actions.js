// dashboard-actions.js — write side of the ChatGPT bridge (see CHATGPT_BRIDGE.md).
// POST { "actions": [ {type, ...}, ... ] } — same action schema Telegram
// JARVIS already speaks internally (dashboard-lib.js's applyActions).
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

const { applyActions, runCalendarSideEffects } = require('./dashboard-lib.js');

function initFirebase() {
  if (admin.apps.length > 0) return;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_B64
    ? JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString())
    : require('./service-account.json');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

exports.handler = async (event) => {
  const key = event.queryStringParameters?.key || event.headers?.['x-gpt-key'];
  console.log('[dashboard-actions] auth debug: headerNames=%j receivedLen=%s expectedLen=%s match=%s',
    Object.keys(event.headers || {}), key ? key.length : null,
    process.env.GPT_BRIDGE_KEY ? process.env.GPT_BRIDGE_KEY.length : null,
    key === process.env.GPT_BRIDGE_KEY);
  if (key !== process.env.GPT_BRIDGE_KEY || !process.env.GPT_BRIDGE_KEY) {
    return { statusCode: 401, body: 'Unauthorized' };
  }
  if (event.httpMethod && event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const actions = Array.isArray(body.actions) ? body.actions : [];
  console.log('dashboard-actions received:', JSON.stringify(actions));
  if (!actions.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No actions provided' }) };
  }

  try {
    initFirebase();
    const db = admin.firestore();
    const userRef = db.doc('users/aqzJe5gq4IVYdKmUIW0pNJGL2ML2/data/main');
    const snap = await userRef.get();
    const data = snap.exists ? snap.data() : {};

    const { labels, spendingAlert } = applyActions(data, actions);
    await userRef.set(data);
    await runCalendarSideEffects(actions);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, applied: labels, spendingAlert: spendingAlert || null }),
    };
  } catch (e) {
    console.error('dashboard-actions error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
