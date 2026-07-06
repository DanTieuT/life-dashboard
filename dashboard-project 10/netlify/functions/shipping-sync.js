// Shipping sync — scheduled every 2h (see netlify.toml). For each active
// package: pulls latest status via free direct carrier APIs (UPS/FedEx/USPS,
// see carriers.js), with 17TRACK as an optional fallback for other carriers.
// On a status CHANGE sends a push notification (+ Telegram for the big ones:
// out for delivery / delivered / exception). Auto-archives packages delivered
// more than 3 days ago. No-ops gracefully until at least one carrier (or
// 17TRACK) is configured. Manual trigger: /shipping-sync?trigger=manual
const https = require('https');
const admin = require('firebase-admin');

if (!process.env.TRACK17_API_KEY && !process.env.UPS_CLIENT_ID && !process.env.FEDEX_API_KEY && !process.env.USPS_CLIENT_ID) {
  try {
    const fs = require('fs'), path = require('path');
    fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^#=\s]+)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
  } catch {}
}

const track17 = require('./track17.js');
const carriers = require('./carriers.js');

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
  if (!carriers.anyConfigured() && !track17.apiKey()) {
    console.log('[shipping-sync] no carrier APIs configured — skipping');
    return { statusCode: 200, body: 'No API keys configured' };
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

    // ── 1. Direct carrier APIs (free: UPS/FedEx/USPS) ─────────────
    const infos = new Map();
    const leftovers = [];
    for (const p of active) {
      let info = null;
      if (carriers.anyConfigured()) {
        try { info = await carriers.track(p.trackingNumber, p.carrier); }
        catch (e) { console.warn(`[shipping-sync] ${p.trackingNumber} carrier lookup failed:`, e.message); }
      }
      if (info) infos.set(p.trackingNumber, info);
      else leftovers.push(p); // unknown/unconfigured carrier
    }

    // ── 2. Optional 17TRACK fallback for anything the direct APIs
    //       couldn't handle (only if TRACK17_API_KEY is set) ───────
    if (leftovers.length && track17.apiKey()) {
      const toRegister = leftovers.filter(p => !p.registered).map(p => p.trackingNumber);
      if (toRegister.length) {
        try {
          const registered = await track17.register(toRegister);
          leftovers.forEach(p => { if (registered.has(p.trackingNumber)) p.registered = true; });
        } catch (e) { console.warn('[shipping-sync] register failed:', e.message); }
      }
      try {
        const t17 = await track17.getTrackInfo(leftovers.filter(p => p.registered).map(p => p.trackingNumber));
        for (const [num, info] of t17) infos.set(num, info);
      } catch (e) { console.warn('[shipping-sync] 17track lookup failed:', e.message); }
    }

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
