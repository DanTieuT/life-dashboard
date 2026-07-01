const https = require('https');
const admin = require('firebase-admin');

const TZ = 'America/Los_Angeles';
const USER_DOC = 'users/aqzJe5gq4IVYdKmUIW0pNJGL2ML2/data/main';
const WINDOW_DAYS = 60; // fetch 60 days ahead so the calendar month view has coverage

function initFirebase() {
  if (admin.apps.length > 0) return;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_B64
    ? JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString())
    : require('./service-account.json');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

// ── iCal fetch ────────────────────────────────────────────────────────────────
function fetchIcal(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchIcal(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── iCal parser ───────────────────────────────────────────────────────────────
function parseIcal(text) {
  // Unfold continuation lines (RFC 5545 §3.1)
  const unfolded = text.replace(/\r\n([ \t])/g, '$1').replace(/\n([ \t])/g, '$1');
  const lines = unfolded.split(/\r\n|\r|\n/);

  const events = [];
  let cur = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT')   { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;

    const ci = line.indexOf(':');
    if (ci < 0) continue;
    const keyFull = line.slice(0, ci);
    const value   = line.slice(ci + 1);

    // Split key from params:  DTSTART;TZID=America/Los_Angeles
    const [keyName, ...paramParts] = keyFull.split(';');
    const params = {};
    for (const p of paramParts) {
      const eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq)] = p.slice(eq + 1);
    }

    cur[keyName] = { value, params };
  }

  return events;
}

// Convert a tzid + local datetime parts to UTC ms (iterative Intl approach)
function tzLocalToUtcMs(tzid, y, mo, d, h, min) {
  let utcMs = Date.UTC(y, mo, d, h, min, 0);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(utcMs));
    const g = (t) => +parts.find(p => p.type === t).value;
    const tzMs  = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
    const delta = Date.UTC(y, mo, d, h, min) - tzMs;
    if (Math.abs(delta) < 60000) break;
    utcMs += delta;
  }
  return utcMs;
}

// Parse a DTSTART/DTEND field → { allDay, ms }
function parseField(field) {
  if (!field) return null;
  const { value, params } = field;
  const isDate = params.VALUE === 'DATE' || /^\d{8}$/.test(value);

  if (isDate) {
    const y = +value.slice(0,4), mo = +value.slice(4,6)-1, d = +value.slice(6,8);
    return { allDay: true, ms: Date.UTC(y, mo, d) };
  }

  const y   = +value.slice(0,4),  mo  = +value.slice(4,6)-1, d  = +value.slice(6,8);
  const h   = +value.slice(9,11), min = +value.slice(11,13);
  const isUtc = value.endsWith('Z');
  const tzid  = params.TZID;

  let ms;
  if (isUtc) {
    ms = Date.UTC(y, mo, d, h, min);
  } else if (tzid) {
    ms = tzLocalToUtcMs(tzid, y, mo, d, h, min);
  } else {
    ms = Date.UTC(y, mo, d, h, min); // floating — treat as UTC
  }
  return { allDay: false, ms };
}

function msToLocalDate(ms) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ });
}
function msToLocalTime(ms) {
  return new Date(ms).toLocaleTimeString('en-US', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async () => {
  const headers = { 'Content-Type': 'application/json' };
  try {
    const icalUrl = process.env.TIMETREE_ICAL_URL;
    if (!icalUrl) throw new Error('TIMETREE_ICAL_URL not set');

    const icsText = await fetchIcal(icalUrl);
    const raw = parseIcal(icsText);

    const now      = Date.now();
    const windowEnd = now + WINDOW_DAYS * 86400000;

    const events = [];
    for (const e of raw) {
      const start = parseField(e.DTSTART);
      const end   = parseField(e.DTEND || e.DTSTART);
      if (!start) continue;

      // Skip events outside window
      if (start.ms < now - 86400000) continue; // allow 1 day past for all-day end-time edge
      if (start.ms > windowEnd) continue;

      const startDate = start.allDay
        ? new Date(start.ms).toISOString().slice(0, 10)
        : msToLocalDate(start.ms);

      // All-day DTEND in iCal is exclusive (the day after), subtract 1ms
      const endMs = (end && !end.allDay) ? end.ms : (end ? end.ms - 1 : start.ms);
      const endDate = end?.allDay
        ? new Date(endMs).toISOString().slice(0, 10)
        : (end ? msToLocalDate(endMs) : startDate);

      events.push({
        id:        (e.UID?.value || '').replace(/[^a-zA-Z0-9_-]/g, '_'),
        title:     e.SUMMARY?.value || '(no title)',
        startDate,
        endDate:   endDate !== startDate ? endDate : null,
        allDay:    start.allDay,
        time:      start.allDay ? '' : msToLocalTime(start.ms),
        endTime:   (end && !end.allDay) ? msToLocalTime(endMs) : '',
        location:  e.LOCATION?.value || null,
        startMs:   start.ms,
      });
    }

    events.sort((a, b) => a.startMs - b.startMs);

    initFirebase();
    const db = admin.firestore();
    const syncedAt = Date.now();
    await db.doc(USER_DOC).set({ timetreeEvents: events, timetreeSyncedAt: syncedAt }, { merge: true });

    console.log(`[sync-timetree] synced ${events.length} events from iCal`);
    return { statusCode: 200, headers, body: JSON.stringify({ events, syncedAt }) };
  } catch (e) {
    console.error('[sync-timetree] error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
