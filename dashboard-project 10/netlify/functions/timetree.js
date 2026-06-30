const https = require('https');
const { randomUUID } = require('crypto');
const { RRule, RRuleSet, rrulestr } = require('rrule');

const API_BASE = 'https://timetreeapp.com/api/v1';
const HEADERS = {
  'Content-Type': 'application/json',
  'X-Timetreea': 'web/2.1.0/en',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Origin': 'https://timetreeapp.com',
  'Referer': 'https://timetreeapp.com/',
};
const TZ = 'America/Los_Angeles';

// Module-level session cache (survives warm invocations)
let _session = null;   // { cookie, csrfToken, calendarId }

function httpsReq(options, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { ...HEADERS, ...options.headers };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const req = https.request({ ...options, headers }, (res) => {
      // Capture updated session cookie
      const setCookie = res.headers['set-cookie'];
      if (setCookie && _session) {
        const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
        const m = arr.join(';').match(/_session_id=([^;]+)/);
        if (m) _session.cookie = m[1];
      }
      // Capture CSRF token from response header
      const csrf = res.headers['x-csrf-token'];
      if (csrf && _session) _session.csrfToken = csrf;

      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          const err = new Error(`HTTP ${res.statusCode}`);
          err.statusCode = res.statusCode;
          err.body = d;
          return reject(err);
        }
        try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : {}, rawHeaders: res.headers }); }
        catch { resolve({ status: res.statusCode, body: d, rawHeaders: res.headers }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function apiReq(method, path, body, requireCsrf = false) {
  const url = new URL(API_BASE + path);
  const headers = {};
  if (_session?.cookie) headers['Cookie'] = `_session_id=${_session.cookie}`;
  if (requireCsrf && _session?.csrfToken) headers['x-csrf-token'] = _session.csrfToken;
  return httpsReq({ hostname: url.hostname, path: url.pathname + url.search, method, headers }, body);
}

async function extractCsrf() {
  return new Promise((resolve) => {
    const headers = { ...HEADERS };
    if (_session?.cookie) headers['Cookie'] = `_session_id=${_session.cookie}`;
    const req = https.request({ hostname: 'timetreeapp.com', path: '/', method: 'GET', headers }, (res) => {
      // Grab CSRF from response header first
      const csrf = res.headers['x-csrf-token'];
      if (csrf && _session) { _session.csrfToken = csrf; }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (!_session?.csrfToken) {
          const m = d.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/i);
          if (m && _session) _session.csrfToken = m[1];
        }
        resolve();
      });
    });
    req.on('error', () => resolve());
    req.setTimeout(10000, () => { req.destroy(); resolve(); });
    req.end();
  });
}

async function authenticate() {
  const email = process.env.TIMETREE_EMAIL;
  const password = process.env.TIMETREE_PASSWORD;
  if (!email || !password) throw new Error('TIMETREE_EMAIL / TIMETREE_PASSWORD not set');

  _session = { cookie: null, csrfToken: null, calendarId: null };

  const uuid = randomUUID().replace(/-/g, '');
  await apiReq('PUT', '/auth/email/signin', { uid: email, password, uuid });

  if (!_session.cookie) throw new Error('TimeTree auth failed — no session cookie');
  await extractCsrf();
}

async function ensureAuth() {
  if (_session?.cookie) return;
  await authenticate();
}

async function getCalendars() {
  await ensureAuth();
  try {
    const res = await apiReq('GET', '/calendars?since=0');
    return (res.body.calendars || []).filter(c => !c.deactivated_at);
  } catch (e) {
    if (e.statusCode === 401) { _session = null; await authenticate(); }
    const res = await apiReq('GET', '/calendars?since=0');
    return (res.body.calendars || []).filter(c => !c.deactivated_at);
  }
}

async function getCalendarId() {
  if (_session?.calendarId) return _session.calendarId;
  const calIdEnv = process.env.TIMETREE_CALENDAR_ID;
  if (calIdEnv) { if (_session) _session.calendarId = calIdEnv; return calIdEnv; }
  const cals = await getCalendars();
  const id = String(cals[0]?.id || '');
  if (_session) _session.calendarId = id;
  return id;
}

async function getMemberMap() {
  if (_session?.memberMap) return _session.memberMap;
  const calId = await getCalendarId();
  try {
    // calendar_users is included in the v1 calendars response
    const res = await apiReq('GET', '/calendars?since=0');
    const cal = (res.body.calendars || []).find(c => String(c.id) === String(calId));
    const users = cal?.calendar_users || [];
    const map = {};
    for (const u of users) map[u.id] = u.name;
    if (_session) _session.memberMap = map;
    return map;
  } catch { return {}; }
}

// Convert local date+time string to UTC ms, accounting for DST in given timezone
function localToUtcMs(dateStr, timeStr, tz) {
  // Iterative Intl approach — handles DST correctly
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  let utcMs = Date.UTC(y, mo - 1, d, h, m, 0);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(utcMs));
    const get = (type) => +parts.find(p => p.type === type).value;
    const tzMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
    const targetMs = Date.UTC(y, mo - 1, d, h, m);
    const delta = targetMs - tzMs;
    if (Math.abs(delta) < 60000) break;
    utcMs += delta;
  }
  return utcMs;
}

function fmtEventTime(tsMs, allDay) {
  if (allDay) return '[all day]';
  return new Date(tsMs).toLocaleTimeString('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtEventDate(tsMs) {
  return new Date(tsMs).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
}

function expandEvent(e, windowStart, windowEnd, memberMap) {
  const duration = e.end_at - e.start_at;
  const base = {
    uuid: e.uuid, title: e.title, all_day: e.all_day,
    location: e.location || null, note: e.note || null,
    author_id: e.author_id, author: memberMap[e.author_id] || null,
  };

  const rruleStr = e.recurrences && e.recurrences.length ? e.recurrences.join('\n') : null;

  if (!rruleStr) {
    // Non-recurring: just check if it falls in window
    if (e.start_at < windowEnd && e.end_at > windowStart) {
      return [{
        ...base, start_at: e.start_at, end_at: e.end_at,
        dateLabel: fmtEventDate(e.start_at),
        startTime: fmtEventTime(e.start_at, e.all_day),
        endTime: e.all_day ? null : fmtEventTime(e.end_at, false),
      }];
    }
    return [];
  }

  // Recurring: expand using rrule
  try {
    // Build the full RRULE string including DTSTART
    const dtstart = new Date(e.start_at);
    const fullStr = `DTSTART:${dtstart.toISOString().replace(/[-:]/g,'').replace('.000','')}\n${rruleStr}`;
    const rule = rrulestr(fullStr, { forceset: true });
    const occurrences = rule.between(new Date(windowStart), new Date(windowEnd), true);
    return occurrences.map(occ => {
      const startMs = occ.getTime();
      const endMs = startMs + duration;
      return {
        ...base, start_at: startMs, end_at: endMs,
        dateLabel: fmtEventDate(startMs),
        startTime: fmtEventTime(startMs, e.all_day),
        endTime: e.all_day ? null : fmtEventTime(endMs, false),
      };
    });
  } catch (err) {
    console.warn('rrule expand error for', e.title, err.message);
    return [];
  }
}

async function getUpcomingEvents(days = 14) {
  await ensureAuth();
  const calId = await getCalendarId();
  if (!calId) return [];
  try {
    const [evtRes, memberMap] = await Promise.all([
      apiReq('GET', `/calendar/${calId}/events/sync?since=0`),
      getMemberMap(),
    ]);
    const events = evtRes.body.events || [];
    // Window: start of today (Pacific) to end of window
    const nowMs = Date.now();
    const todayPacific = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
    const windowStart = new Date(todayPacific + 'T00:00:00-07:00').getTime();
    const windowEnd = windowStart + days * 86400000;

    const result = [];
    for (const e of events) {
      if (e.deactivated_at || e.category === 2) continue;
      const expanded = expandEvent(e, windowStart, windowEnd, memberMap);
      result.push(...expanded);
    }
    return result.sort((a, b) => a.start_at - b.start_at);
  } catch (e) {
    console.error('TimeTree getUpcomingEvents error:', e.message);
    return [];
  }
}

async function createEvent({ title, date, time, endDate, endTime, allDay = false, location, note, recurrence }) {
  await ensureAuth();
  const calId = await getCalendarId();
  if (!calId) throw new Error('No TimeTree calendar found');

  const startMs = allDay ? Date.UTC(...date.split('-').map((n, i) => i === 1 ? +n - 1 : +n)) : localToUtcMs(date, time || '09:00', TZ);
  const endMs = allDay
    ? startMs
    : localToUtcMs(endDate || date, endTime || time || '10:00', TZ);

  const body = {
    title,
    all_day: allDay,
    start_at: startMs,
    start_timezone: TZ,
    end_at: endMs,
    end_timezone: TZ,
    category: 1,
    attendees: [],
    recurrences: recurrence ? [recurrence] : [],
    alerts: [],
    file_uuids: [],
    ...(location && { location }),
    ...(note && { note }),
  };

  try {
    const res = await apiReq('POST', `/calendar/${calId}/event`, body, true);
    return res.body.event;
  } catch (e) {
    if (e.statusCode === 403) {
      // CSRF expired — re-fetch
      await extractCsrf();
      const res = await apiReq('POST', `/calendar/${calId}/event`, body, true);
      return res.body.event;
    }
    throw e;
  }
}

// Keywords in the title that mark an event as Dan's regardless of who created it
const DAN_TITLE_KEYWORDS = ['dan', 'office', 'timesheet', 'rdo'];
// Keywords in the title that mark an event as Julia's
const JULIA_TITLE_KEYWORDS = ['julia', 'nails', 'orthodontist', 'clinic', 'earrings', 'suki'];

function isDanEvent(e) {
  const title = (e.title || '').toLowerCase();
  if (DAN_TITLE_KEYWORDS.some(k => title.includes(k))) return true;
  if (JULIA_TITLE_KEYWORDS.some(k => title.includes(k))) return false;
  // Fall back to author
  return !e.author || e.author === 'Dan Tieu' || e.author === 'Dan Tieu MCP';
}

function eventsToBlock(events) {
  if (!events.length) return '  (none)';
  const byDate = {};
  for (const e of events) {
    if (!byDate[e.dateLabel]) byDate[e.dateLabel] = [];
    byDate[e.dateLabel].push(e);
  }
  return Object.entries(byDate).map(([date, evts]) => {
    const items = evts.map(e => {
      const time = e.all_day ? '[all day]' : `${e.startTime}–${e.endTime}`;
      const loc = e.location ? ` @ ${e.location}` : '';
      return `    • ${e.title} ${time}${loc}`;
    }).join('\n');
    return `  ${date}:\n${items}`;
  }).join('\n');
}

function formatForPrompt(events) {
  const dan = events.filter(isDanEvent);
  const julia = events.filter(e => !isDanEvent(e));
  let out = "Dan's schedule:\n" + eventsToBlock(dan);
  if (julia.length) out += "\n\nJulia's schedule:\n" + eventsToBlock(julia);
  return out;
}

async function getEventsForRange(startMs, endMs) {
  await ensureAuth();
  const calId = await getCalendarId();
  if (!calId) return [];
  try {
    const [evtRes, memberMap] = await Promise.all([
      apiReq('GET', `/calendar/${calId}/events/sync?since=0`),
      getMemberMap(),
    ]);
    const events = evtRes.body.events || [];
    const result = [];
    for (const e of events) {
      if (e.deactivated_at || e.category === 2) continue;
      const expanded = expandEvent(e, startMs, endMs, memberMap);
      result.push(...expanded);
    }
    return result.sort((a, b) => a.start_at - b.start_at);
  } catch (e) {
    if (e.statusCode === 401) { _session = null; return getEventsForRange(startMs, endMs); }
    console.error('TimeTree getEventsForRange error:', e.message);
    return [];
  }
}

module.exports = { getUpcomingEvents, getEventsForRange, createEvent, getCalendars, formatForPrompt, isDanEvent, authenticate };
