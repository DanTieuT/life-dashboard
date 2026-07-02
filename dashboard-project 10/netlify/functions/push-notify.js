/**
 * push-notify.js — Web push notifications
 *
 * This function handles:
 *   POST /push-notify?action=subscribe  — store a push subscription
 *   POST /push-notify?action=send       — send a notification to all subscriptions
 *   GET  /push-notify?action=vapid-key  — return public VAPID key to browser
 *
 * Also exports sendPushToAll(db, {title, body, url}) for other scheduled
 * functions (habit-reminder.js, rdo-nudge.js, weekly-review.js) to call directly.
 */

const admin = require('firebase-admin');
const webpush = require('web-push');

if (!process.env.VAPID_PUBLIC_KEY) {
  try {
    const fs = require('fs'), path = require('path');
    fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^#=\s]+)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
  } catch {}
}

function initFirebase() {
  if (admin.apps.length > 0) return;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_B64
    ? JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString())
    : require('./service-account.json');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

function initVapid() {
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidEmail = process.env.VAPID_EMAIL || 'mailto:dantieut@gmail.com';
  if (!vapidPublic || !vapidPrivate) return false;
  webpush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate);
  return true;
}

const USER_UID = 'aqzJe5gq4IVYdKmUIW0pNJGL2ML2';

// Sends { title, body, url } to every stored subscription for the one user
// this app serves. Prunes subscriptions that report 404/410 (expired/revoked).
// Silently no-ops if VAPID keys aren't configured — callers wrap this in
// try/catch already, but this function itself never throws on missing config.
async function sendPushToAll(db, { title = 'Command Center', body = '', url = '/' } = {}) {
  if (!initVapid()) {
    console.warn('[push-notify] VAPID keys not configured — skipping push');
    return { sent: 0, failed: 0 };
  }
  const subsSnap = await db.collection(`users/${USER_UID}/pushSubscriptions`).get();
  const payload = JSON.stringify({ title, body, url });
  let sent = 0, failed = 0;
  for (const docSnap of subsSnap.docs) {
    const sub = docSnap.data().subscription;
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
    } catch (e) {
      failed++;
      if (e.statusCode === 404 || e.statusCode === 410) {
        await docSnap.ref.delete().catch(() => {});
      } else {
        console.warn('[push-notify] send failed:', e.message);
      }
    }
  }
  return { sent, failed };
}
module.exports.sendPushToAll = sendPushToAll;

exports.handler = async (event) => {
  const action = event.queryStringParameters?.action || '';

  // ── Return public VAPID key ──────────────────────────────────────
  if (event.httpMethod === 'GET' && action === 'vapid-key') {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'VAPID_PUBLIC_KEY not configured. See TODO comments in push-notify.js' }),
      };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey: key }),
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  // ── Store subscription ───────────────────────────────────────────
  if (action === 'subscribe') {
    const { subscription } = body;
    if (!subscription || !subscription.endpoint) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No subscription provided' }) };
    }
    try {
      initFirebase();
      const db = admin.firestore();
      // Store subscription keyed by endpoint hash
      const key = Buffer.from(subscription.endpoint).toString('base64').slice(-20);
      await db.doc(`users/${USER_UID}/pushSubscriptions/${key}`).set({
        subscription,
        createdAt: Date.now(),
        userAgent: event.headers['user-agent'] || '',
      });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, message: 'Subscription saved' }),
      };
    } catch (e) {
      console.error('Subscribe error:', e);
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── Send notification ────────────────────────────────────────────
  if (action === 'send') {
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'VAPID keys not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Netlify environment variables.',
        }),
      };
    }
    try {
      initFirebase();
      const db = admin.firestore();
      const { title = 'Command Center', message = '', url = '/' } = body;
      const { sent, failed } = await sendPushToAll(db, { title, body: message, url });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, sent, failed }),
      };
    } catch (e) {
      console.error('Send error:', e);
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
};
