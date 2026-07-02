// Shipping sync — scheduled every 2h (see netlify.toml). For each active
// package: registers it with 17TRACK if needed, pulls latest status, and on
// a status CHANGE sends a push notification (+ Telegram for the big ones:
// out for delivery / delivered / exception). Auto-archives packages
// delivered more than 3 days ago. No-ops gracefully if TRACK17_API_KEY
// isn't configured. Manual trigger: /shipping-sync?trigger=manual
const https = require('https');
const admin = require('firebase-admin');

if (!process.env.TRACK17_API_KEY) {
  try {
    const fs = require('fs'), path = require('path');
    fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^#=\s]+)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
  } catch {}
}

const track17 = require('./track17.js');

function initFirebase() {
  if (admin.apps.length > 0) return;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_B64
    ? JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString())
    : require('./service-account.json');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

function sendTelegram(text) {
  return new Promise((resolve) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return resolve();
    const body = JSON.stringify({ chat_id: chatId, text });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve);
    req.write(body);
    req.end();
  });
}

const ARCHIVE_AFTER_DAYS = 3;
// Statuses important enough for a Telegram message (push fires on any change).
const TELEGRAM_STATUSES = new Set(['OutForDelivery', 'Delivered', 'DeliveryFailure', 'Exception', 'AvailableForPickup']);
const STATUS_LABEL = {
  OutForDelivery: '🚚 Out for delivery', Delivered: '✅ Delivered',
  DeliveryFailure: '⚠️ Delivery failed', Exception: '⚠️ Delivery exception',
  AvailableForPickup: '📍 Ready for pickup', InTransit: '📦 In transit',
  InfoReceived: '🏷️ Label created', NotFound: '⏳ Awaiting scan', Expired: '🕸️ Expired',
};

exports.handler = async (event) => {
  if (!track17.apiKey()) {
    console.log('[shipping-sync] TRACK17_API_KEY not set — skipping');
    return { statusCode: 200, body: 'No API key configured' };
  }
  try {
    initFirebase();
    const db = admin.firestore();
    const ref = db.doc('users/aqzJe5gq4IVYdKmUIW0pNJGL2ML2/data/main');
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};
    const packages = data.packages || [];

    const active = packages.filter(p => !p.archived && p.status !== 'Delivered');
    if (!active.length) {
      console.log('[shipping-sync] no active packages');
      return { statusCode: 200, body: 'Nothing to sync' };
    }

    // Register any not-yet-registered numbers
    const toRegister = active.filter(p => !p.registered).map(p => p.trackingNumber);
    if (toRegister.length) {
      try {
        const registered = await track17.register(toRegister);
        active.forEach(p => { if (registered.has(p.trackingNumber)) p.registered = true; });
      } catch (e) { console.warn('[shipping-sync] register failed:', e.message); }
    }

    // Pull status for everything registered
    const nums = active.filter(p => p.registered).map(p => p.trackingNumber);
    const infos = await track17.getTrackInfo(nums);

    const notifications = [];
    for (const p of active) {
      const info = infos.get(p.trackingNumber);
      if (!info) continue;
      const changed = info.status !== p.status;
      p.statusText = info.statusText || p.statusText;
      p.carrier = info.carrier || p.carrier;
      p.eta = info.eta || p.eta;
      p.lastLocation = info.lastLocation || p.lastLocation;
      p.events = info.events.length ? info.events : p.events;
      p.lastUpdate = Date.now();
      if (changed) {
        p.status = info.status;
        if (info.status === 'Delivered') p.deliveredAt = info.deliveredAt || Date.now();
        notifications.push(p);
      }
    }

    // Auto-archive old deliveries (server-side mirror of the client logic)
    const cutoff = Date.now() - ARCHIVE_AFTER_DAYS * 86400000;
    packages.forEach(p => {
      if (p.status === 'Delivered' && !p.archived && p.deliveredAt && p.deliveredAt < cutoff) p.archived = true;
    });

    await ref.update({ packages });

    // Notify on changes
    for (const p of notifications) {
      const name = p.description || p.retailer || p.trackingNumber;
      const label = STATUS_LABEL[p.status] || p.status;
      const msg = `${label}: ${name}${p.status === 'OutForDelivery' ? ' — arriving today' : ''}`;
      try {
        const { sendPushToAll } = require('./push-notify.js');
        await sendPushToAll(db, { title: 'Package update', body: msg });
      } catch (e) { console.warn('[shipping-sync] push failed:', e.message); }
      if (TELEGRAM_STATUSES.has(p.status)) await sendTelegram(msg);
    }

    return { statusCode: 200, body: `Synced ${active.length}, ${notifications.length} changes` };
  } catch (e) {
    console.error('Shipping sync error:', e);
    return { statusCode: 500, body: e.message };
  }
};
