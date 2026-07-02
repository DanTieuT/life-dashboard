// RDO nudge — context-aware proactive message the evening before an RDO
// (9/80 day off). Scheduled daily at 6pm PT (see netlify.toml: "0 1 * * *"
// UTC); only actually sends a message on days that precede an RDO Monday.
// Suggests one open project next-action or overdue task worth tackling on
// the day off. Sends nothing on non-RDO-eve days or if there's nothing to suggest.
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

// Mirrors js/core.js isRDO() — 9/80 schedule, every-other-Monday RDO.
// Falls back to the known default schedule if Firestore hasn't persisted one
// yet (the client only writes rdoSchedule when it changes from its default).
const DEFAULT_RDO_SCHEDULE = { enabled: true, anchorDate: '2026-07-06', cycleDays: 14 };
function isRDO(dateStr, sched) {
  sched = sched || DEFAULT_RDO_SCHEDULE;
  if (!sched.enabled || !sched.anchorDate) return false;
  const d = new Date(dateStr + 'T12:00:00');
  if (d.getDay() !== 1) return false;
  const anchor = new Date(sched.anchorDate + 'T12:00:00');
  const diffDays = Math.round((d - anchor) / 86400000);
  const cycle = sched.cycleDays || 14;
  return ((diffDays % cycle) + cycle) % cycle === 0;
}

exports.handler = async (event) => {
  const secret = process.env.CRON_SECRET;
  const provided = (event && event.queryStringParameters && event.queryStringParameters.secret) || '';
  const isScheduled = !event.queryStringParameters;
  if (!isScheduled && secret && provided !== secret) {
    return { statusCode: 403, body: 'Forbidden' };
  }
  try {
    initFirebase();
    const db = admin.firestore();
    const snap = await db.doc('users/aqzJe5gq4IVYdKmUIW0pNJGL2ML2/data/main').get();
    const data = snap.exists ? snap.data() : {};

    const today = todayPacific();
    const tomorrow = new Date(new Date(today + 'T12:00:00').getTime() + 86400000).toLocaleDateString('en-CA');
    if (!isRDO(tomorrow, data.rdoSchedule)) {
      console.log('[rdo-nudge] tomorrow is not an RDO — sending nothing');
      return { statusCode: 200, body: 'Not RDO eve' };
    }

    // Overdue tasks (3+ days) take priority, then project next-actions.
    const todayDate = new Date(today + 'T12:00:00');
    const overdue = (data.projects || []).filter(t => {
      if (t.done || !t.due) return false;
      const daysOverdue = Math.round((todayDate - new Date(t.due + 'T12:00:00')) / 86400000);
      return daysOverdue >= 3;
    }).sort((a, b) => new Date(a.due) - new Date(b.due));

    const projectsWithNext = (data.userProjects || []).filter(p => !p.archived && p.nextAction && p.stage !== 'done');

    let suggestion = null;
    if (overdue.length) {
      suggestion = `overdue task "${overdue[0].name}" (due ${overdue[0].due})`;
    } else if (projectsWithNext.length) {
      const p = projectsWithNext[0];
      suggestion = `${p.emoji || '🔨'} "${p.name}": ${p.nextAction}`;
    }

    if (!suggestion) {
      console.log('[rdo-nudge] nothing to suggest — sending nothing');
      return { statusCode: 200, body: 'Nothing to suggest' };
    }

    await sendTelegram(`🔧 You're off tomorrow. Good time to tackle ${suggestion}?`);

    try {
      const { sendPushToAll } = require('./push-notify.js');
      await sendPushToAll(db, { title: "You're off tomorrow", body: `Good time to tackle ${suggestion}` });
    } catch (e) { console.warn('[rdo-nudge] push failed:', e.message); }

    return { statusCode: 200, body: 'Sent: ' + suggestion };
  } catch (e) {
    console.error('RDO nudge error:', e);
    return { statusCode: 500, body: e.message };
  }
};
