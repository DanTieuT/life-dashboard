const admin = require('firebase-admin');
const timetree = require('./timetree.js');

const TZ = 'America/Los_Angeles';
const USER_DOC = 'users/aqzJe5gq4IVYdKmUIW0pNJGL2ML2/data/main';
const WINDOW_DAYS = 60;

function initFirebase() {
  if (admin.apps.length > 0) return;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_B64
    ? JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString())
    : require('./service-account.json');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

function toLocalDate(tsMs) {
  return new Date(tsMs).toLocaleDateString('en-CA', { timeZone: TZ });
}
function utcDate(tsMs) {
  return new Date(tsMs).toISOString().slice(0, 10);
}
function fmtTime(tsMs) {
  return new Date(tsMs).toLocaleTimeString('en-US', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

exports.handler = async () => {
  const headers = { 'Content-Type': 'application/json' };
  try {
    initFirebase();

    const windowStart = Date.now();
    const windowEnd = windowStart + WINDOW_DAYS * 86400000;
    const raw = await timetree.getEventsForRange(windowStart, windowEnd);

    const events = raw.map(e => {
      const startDate = e.all_day ? utcDate(e.start_at) : toLocalDate(e.start_at);
      const endMs = e.all_day ? e.end_at - 1 : e.end_at;
      const endDate = e.all_day ? utcDate(endMs) : toLocalDate(endMs);
      return {
        id: e.uuid,
        title: e.title,
        startDate,
        endDate: endDate !== startDate ? endDate : null,
        allDay: e.all_day,
        time: e.all_day ? '' : fmtTime(e.start_at),
        endTime: e.all_day ? '' : fmtTime(e.end_at),
        location: e.location || null,
        author: e.author || null,
        startMs: e.start_at,
      };
    });

    const db = admin.firestore();
    const syncedAt = Date.now();
    await db.doc(USER_DOC).set({ timetreeEvents: events, timetreeSyncedAt: syncedAt }, { merge: true });

    console.log(`[sync-timetree] synced ${events.length} events`);
    return { statusCode: 200, headers, body: JSON.stringify({ events, syncedAt }) };
  } catch (e) {
    console.error('[sync-timetree] error:', e.message, e.body);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message, detail: e.body }) };
  }
};
