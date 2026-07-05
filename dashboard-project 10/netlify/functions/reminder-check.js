// Reminder delivery — scheduled every minute (see netlify.toml). Fires any
// reminder whose dueAt has passed: Telegram + push. One-time reminders are
// marked sent (pruned after 3 days); recurring reminders advance to their
// next occurrence. Exits fast (no Firestore write) when nothing is due.
const https = require('https');
const admin = require('firebase-admin');

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

// Next occurrence after `from`, stepping in Pacific-time calendar days so
// reminders stay at the same local time across DST changes.
function nextOccurrence(dueAt, recurrence, from) {
  let t = dueAt;
  const step = (ts, days) => {
    const d = new Date(ts);
    // add days via UTC then correct to keep the same PT wall-clock time
    const before = new Date(ts).toLocaleTimeString('en-GB', { timeZone: 'America/Los_Angeles' });
    let next = ts + days * 86400000;
    const after = new Date(next).toLocaleTimeString('en-GB', { timeZone: 'America/Los_Angeles' });
    if (before !== after) { // DST boundary — adjust by the hour difference
      const [bh] = before.split(':').map(Number);
      const [ah] = after.split(':').map(Number);
      let diff = bh - ah;
      if (diff > 12) diff -= 24; if (diff < -12) diff += 24;
      next += diff * 3600000;
    }
    return next;
  };
  const isWeekday = ts => {
    const dow = new Date(ts).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' });
    return !['Sat', 'Sun'].includes(dow);
  };
  for (let i = 0; i < 400 && t <= from; i++) {
    if (recurrence === 'daily') t = step(t, 1);
    else if (recurrence === 'weekly') t = step(t, 7);
    else if (recurrence === 'monthly') { const d = new Date(t); d.setMonth(d.getMonth() + 1); t = d.getTime(); }
    else if (recurrence === 'weekdays') { do { t = step(t, 1); } while (!isWeekday(t)); }
    else return null;
  }
  return t;
}

exports.handler = async () => {
  try {
    initFirebase();
    const db = admin.firestore();
    const ref = db.doc('users/aqzJe5gq4IVYdKmUIW0pNJGL2ML2/data/main');
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};
    let reminders = data.reminders || [];
    if (!reminders.length) return { statusCode: 200, body: 'No reminders' };

    const now = Date.now();
    const due = reminders.filter(r => !r.sent && r.dueAt <= now);
    // Prune sent one-time reminders older than 3 days
    const pruned = reminders.filter(r => !(r.sent && r.dueAt < now - 3 * 86400000));
    if (!due.length && pruned.length === reminders.length) {
      return { statusCode: 200, body: 'Nothing due' };
    }

    for (const r of due) {
      await sendTelegram(`⏰ Reminder: ${r.text}`);
      try {
        const { sendPushToAll } = require('./push-notify.js');
        await sendPushToAll(db, { title: '⏰ Reminder', body: r.text });
      } catch (e) { console.warn('[reminder-check] push failed:', e.message); }
      if (r.recurrence) {
        const next = nextOccurrence(r.dueAt, r.recurrence, now);
        if (next) r.dueAt = next; else r.sent = true;
      } else {
        r.sent = true;
      }
      r.lastSentAt = now;
    }

    await ref.update({ reminders: pruned });
    return { statusCode: 200, body: `Fired ${due.length}, kept ${pruned.length}` };
  } catch (e) {
    console.error('Reminder check error:', e);
    return { statusCode: 500, body: e.message };
  }
};
