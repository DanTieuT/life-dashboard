/**
 * push-notify.js — Push notification infrastructure scaffold
 *
 * TODO: To fully enable push notifications, you need:
 *   1. Generate VAPID keys:
 *      npx web-push generate-vapid-keys
 *   2. Add to Netlify environment variables:
 *      VAPID_PUBLIC_KEY=<your public key>
 *      VAPID_PRIVATE_KEY=<your private key>
 *      VAPID_EMAIL=mailto:dantieut@gmail.com
 *   3. Install web-push: npm install web-push
 *   4. Uncomment the web-push sending code below
 *
 * This function handles:
 *   POST /push-notify?action=subscribe  — store a push subscription
 *   POST /push-notify?action=send       — send a notification (requires VAPID keys)
 *   GET  /push-notify?action=vapid-key  — return public VAPID key to browser
 */

const admin = require('firebase-admin');

function initFirebase() {
  if (admin.apps.length > 0) return;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_B64
    ? JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString())
    : require('./service-account.json');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

const USER_UID = 'aqzJe5gq4IVYdKmUIW0pNJGL2ML2';

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
    const vapidPublic = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
    const vapidEmail = process.env.VAPID_EMAIL || 'mailto:dantieut@gmail.com';

    if (!vapidPublic || !vapidPrivate) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'VAPID keys not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Netlify environment variables.',
        }),
      };
    }

    // TODO: uncomment once web-push is installed
    // const webpush = require('web-push');
    // webpush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate);

    try {
      initFirebase();
      const db = admin.firestore();
      const subsSnap = await db.collection(`users/${USER_UID}/pushSubscriptions`).get();
      const subs = subsSnap.docs.map(d => d.data().subscription);

      const { title = 'Command Center', message = '', url = '/' } = body;
      const payload = JSON.stringify({ title, body: message, url });

      let sent = 0, failed = 0;
      for (const sub of subs) {
        try {
          // TODO: uncomment once web-push is installed
          // await webpush.sendNotification(sub, payload);
          sent++;
          console.log('Would send to:', sub.endpoint.slice(-20));
        } catch (e) {
          console.error('Push send failed:', e.message);
          failed++;
        }
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, sent, failed, note: 'web-push sending is stubbed — install web-push and uncomment the sendNotification calls' }),
      };
    } catch (e) {
      console.error('Send error:', e);
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
};
