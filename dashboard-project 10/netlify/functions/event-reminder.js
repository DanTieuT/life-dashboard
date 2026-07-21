const https = require('https');
const admin = require('firebase-admin');

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

function getPacificTime() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(now);
  const get = (type) => parts.find(p => p.type === type).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: parseInt(get('hour')),
    minute: parseInt(get('minute')),
    totalMinutes: parseInt(get('hour')) * 60 + parseInt(get('minute'))
  };
}

exports.handler = async (event) => {
  const secret = process.env.CRON_SECRET;
  const provided = (event && event.queryStringParameters && event.queryStringParameters.secret) || '';
  if (secret && provided !== secret) {
    return { statusCode: 403, body: 'Forbidden' };
  }
  try {
    initFirebase();
    const db = admin.firestore();
    const snap = await db.doc('users/aqzJe5gq4IVYdKmUIW0pNJGL2ML2/data/main').get();
    if (!snap.exists) return { statusCode: 200, body: 'no data' };
    const data = snap.data();

    const pt = getPacificTime();
    const notifications = [];

    // Merge dashboard events + cached Apple Calendar events into one list
    const dashEvents = (data.events || [])
      .filter(e => e.date === pt.date && e.time)
      .map(e => ({ name: e.name, time: e.time, source: 'dashboard' }));

    const calEvents = (data.calendarEvents || [])
      .filter(e => e.startDate === pt.date && e.time)
      .map(e => ({ name: e.title, time: e.time, source: 'calendar' }));

    const todayEvents = [...dashEvents, ...calEvents];

    for (const event of todayEvents) {
      const [h, m] = event.time.split(':').map(Number);
      const eventMinutes = h * 60 + m;
      const minutesUntil = eventMinutes - pt.totalMinutes;
      if (minutesUntil >= 25 && minutesUntil <= 35) {
        notifications.push(`⏰ Starting in ~30 min: ${event.name} at ${formatTime(event.time)}`);
      }
      if (minutesUntil >= 5 && minutesUntil <= 10) {
        notifications.push(`🔔 Starting NOW in ${minutesUntil} min: ${event.name} at ${formatTime(event.time)}`);
      }
    }

    // Check for tasks that became overdue today (due date is yesterday and not done)
    // Only send this check at 10:00-10:05 and 18:00-18:05 Pacific to avoid spam
    const isOverdueCheckTime = (pt.hour === 10 && pt.minute <= 5) || (pt.hour === 18 && pt.minute <= 5);
    if (isOverdueCheckTime) {
      const overdue = (data.projects || []).filter(t => !t.done && t.due && t.due < pt.date);
      if (overdue.length > 0) {
        const items = overdue.slice(0, 5).map(t => `  • ${t.name} (due ${t.due})`).join('\n');
        const more = overdue.length > 5 ? `\n  ...and ${overdue.length - 5} more` : '';
        notifications.push(`🔴 You have ${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}:\n${items}${more}`);
      }
    }

    for (const msg of notifications) {
      await sendTelegram(msg);
    }

    return { statusCode: 200, body: `checked ${notifications.length} notifications sent` };
  } catch (e) {
    console.error('Event reminder error:', e);
    return { statusCode: 500, body: e.message };
  }
};

function formatTime(time) {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, '0')} ${period}`;
}
