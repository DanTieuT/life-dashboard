// Habit reminder — scheduled daily at 8pm PT (see netlify.toml: "0 3 * * *" UTC).
// Finds non-archived daily habits not yet logged today and sends ONE Telegram
// message listing them. Sends nothing if everything is already logged.
const https = require('https');
const admin = require('firebase-admin');

// Fallback: load .env directly when netlify dev skips long-value vars
if (!process.env.TELEGRAM_BOT_TOKEN) {
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

// Same send helper pattern as morning-briefing.js
function sendTelegram(text) {
  return new Promise((resolve) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
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

function todayPacific() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

exports.handler = async (event) => {
  const secret = process.env.CRON_SECRET;
  const provided = (event && event.queryStringParameters && event.queryStringParameters.secret) || '';
  const isScheduled = !event.queryStringParameters; // scheduled invocations have no query params
  if (!isScheduled && secret && provided !== secret) {
    return { statusCode: 403, body: 'Forbidden' };
  }
  try {
    initFirebase();
    const db = admin.firestore();
    const snap = await db.doc('users/aqzJe5gq4IVYdKmUIW0pNJGL2ML2/data/main').get();
    const data = snap.exists ? snap.data() : {};
    const today = todayPacific();

    const open = (data.habits || []).filter(h => {
      if (h.archived) return false;
      if (h.type !== 'daily' && h.type) return false; // daily habits only (no type = legacy daily)
      const val = h.log && h.log[today];
      const count = val === true ? 1 : (typeof val === 'number' ? val : 0);
      const target = h.dailyTarget || 1;
      return count < target;
    });

    if (!open.length) {
      console.log('[habit-reminder] all habits logged — sending nothing');
      return { statusCode: 200, body: 'All done' };
    }

    const names = open.map(h => `${h.name}${h.emoji ? ' ' + h.emoji : ''}`).join(', ');
    await sendTelegram(`⏰ Still open today: ${names}`);

    // Best-effort web push too (#26)
    try {
      const { sendPushToAll } = require('./push-notify.js');
      await sendPushToAll(db, { title: 'Habit reminder', body: `Still open today: ${open.map(h => h.name).join(', ')}` });
    } catch (e) { console.warn('[habit-reminder] push failed:', e.message); }

    return { statusCode: 200, body: `Reminded: ${open.length}` };
  } catch (e) {
    console.error('Habit reminder error:', e);
    return { statusCode: 500, body: e.message };
  }
};
