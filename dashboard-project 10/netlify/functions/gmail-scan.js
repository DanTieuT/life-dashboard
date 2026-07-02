// Gmail scanner — scheduled every 30 min (see netlify.toml). Reads ONLY
// messages under the Gmail label set in GMAIL_LABEL (default "shipping" —
// Dan's Gmail filter auto-applies it to order/shipping emails), extracts
// tracking numbers with Claude, and adds new packages to appData.packages.
// Processed message IDs are stored in a side doc so emails are read once.
// No-ops gracefully until GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET /
// GMAIL_REFRESH_TOKEN are configured (see scripts/gmail-auth-setup.js).
const https = require('https');
const admin = require('firebase-admin');

if (!process.env.GMAIL_CLIENT_ID) {
  try {
    const fs = require('fs'), path = require('path');
    fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^#=\s]+)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
  } catch {}
}

const USER_UID = 'aqzJe5gq4IVYdKmUIW0pNJGL2ML2';

function initFirebase() {
  if (admin.apps.length > 0) return;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_B64
    ? JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString())
    : require('./service-account.json');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

// ── Gmail API (raw REST, refresh-token auth) ──────────────────────
async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error('Gmail token refresh failed: ' + JSON.stringify(json));
  return json.access_token;
}

async function gmailGet(token, path) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail ${path} HTTP ${res.status}`);
  return res.json();
}

function decodeB64Url(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// Pulls readable text out of a Gmail message payload (prefers text/plain).
function extractText(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decodeB64Url(payload.body.data);
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return decodeB64Url(payload.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  }
  for (const part of payload.parts || []) {
    const t = extractText(part);
    if (t) return t;
  }
  return '';
}

function header(msg, name) {
  return (msg.payload?.headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

// ── Claude extraction ─────────────────────────────────────────────
function extractWithClaude(emailText) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      system: 'You extract shipping info from emails. Respond with ONLY a JSON array (no prose, no markdown fences). Each element: {"retailer": "...", "trackingNumber": "...", "carrier": "...", "description": "..."} — description is a short human name for what was ordered (e.g. "Cayman brake pads"), carrier like UPS/FedEx/USPS if identifiable else "". Only include entries with a real tracking number (order numbers, RMA numbers, and phone numbers are NOT tracking numbers). If the email has no tracking number, respond with [].',
      messages: [{ role: 'user', content: emailText.slice(0, 8000) }],
    });
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload),
        'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01',
      },
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const text = JSON.parse(body).content?.[0]?.text || '[]';
          const match = text.match(/\[[\s\S]*\]/);
          resolve(match ? JSON.parse(match[0]) : []);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const uidGen = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

exports.handler = async () => {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
    console.log('[gmail-scan] Gmail OAuth not configured — skipping');
    return { statusCode: 200, body: 'Gmail not configured' };
  }
  try {
    initFirebase();
    const db = admin.firestore();
    const metaRef = db.doc(`users/${USER_UID}/meta/gmailScan`);
    const metaSnap = await metaRef.get();
    const processed = new Set(metaSnap.exists ? metaSnap.data().processedIds || [] : []);

    const token = await getAccessToken();
    const label = process.env.GMAIL_LABEL || 'shipping';
    const q = encodeURIComponent(`label:${label} newer_than:3d`);
    const list = await gmailGet(token, `messages?q=${q}&maxResults=20`);
    const msgs = (list.messages || []).filter(m => !processed.has(m.id));
    if (!msgs.length) {
      console.log('[gmail-scan] no new labeled emails');
      return { statusCode: 200, body: 'No new emails' };
    }

    const ref = db.doc(`users/${USER_UID}/data/main`);
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};
    const packages = data.packages || [];
    const known = new Set(packages.map(p => p.trackingNumber));

    let added = 0;
    for (const m of msgs.slice(0, 10)) { // cap Claude calls per run
      try {
        const msg = await gmailGet(token, `messages/${m.id}?format=full`);
        const subject = header(msg, 'Subject');
        const from = header(msg, 'From');
        const text = `From: ${from}\nSubject: ${subject}\n\n${extractText(msg.payload)}`;
        const found = await extractWithClaude(text);
        for (const f of found) {
          const num = (f.trackingNumber || '').replace(/\s/g, '');
          if (!num || num.length < 8 || known.has(num)) continue;
          known.add(num);
          packages.unshift({
            id: uidGen(), trackingNumber: num, carrier: f.carrier || '',
            retailer: f.retailer || '', description: f.description || '',
            status: 'NotFound', statusText: 'Found in email — awaiting first sync',
            eta: null, lastUpdate: Date.now(), lastLocation: '', events: [],
            addedAt: Date.now(), deliveredAt: null, archived: false,
            source: 'email', registered: false, emailId: m.id,
          });
          added++;
        }
      } catch (e) { console.warn('[gmail-scan] message failed:', e.message); }
      processed.add(m.id);
    }

    if (added) await ref.update({ packages });
    await metaRef.set({ processedIds: [...processed].slice(-300), lastScan: Date.now() });

    // New packages found → sync statuses right away instead of waiting for the cron
    if (added) {
      try { await require('./shipping-sync.js').handler({ queryStringParameters: { trigger: 'gmail' } }); }
      catch (e) { console.warn('[gmail-scan] immediate sync failed:', e.message); }
    }

    return { statusCode: 200, body: `Scanned ${msgs.length} emails, added ${added} packages` };
  } catch (e) {
    console.error('Gmail scan error:', e);
    return { statusCode: 500, body: e.message };
  }
};
