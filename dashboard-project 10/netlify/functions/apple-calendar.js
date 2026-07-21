// Apple iCloud Calendar via CalDAV — replacement for the old TimeTree integration.
// Requires an iCloud app-specific password (appleid.apple.com → Sign-In and
// Security → App-Specific Passwords), NOT the real Apple ID password:
//   APPLE_ID=you@icloud.com
//   APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
//   APPLE_CALENDAR_NAME=Home   (optional — display name of the calendar to use;
//                                defaults to the first writable calendar found)
const { DAVClient } = require('tsdav');
const ICAL = require('ical.js');
const { randomUUID } = require('crypto');

const SERVER_URL = 'https://caldav.icloud.com';
const TZ = 'America/Los_Angeles';

// Module-level session cache (survives warm invocations)
let _client = null;
let _calendar = null;

async function authenticate() {
  const username = process.env.APPLE_ID;
  const password = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  if (!username || !password) throw new Error('APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD not set');

  const client = new DAVClient({
    serverUrl: SERVER_URL,
    credentials: { username, password },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
  await client.login();

  const calendars = await client.fetchCalendars();
  const writable = calendars.filter(c => (c.components || []).includes('VEVENT'));
  const wantName = process.env.APPLE_CALENDAR_NAME;
  const calendar = (wantName && writable.find(c => (typeof c.displayName === 'string' ? c.displayName : '') === wantName))
    || writable[0];
  if (!calendar) throw new Error('No writable Apple Calendar found on this account');

  _client = client;
  _calendar = calendar;
}

async function ensureAuth() {
  if (_client && _calendar) return;
  await authenticate();
}

async function getCalendars() {
  await ensureAuth();
  const calendars = await _client.fetchCalendars();
  return calendars.map(c => ({ id: c.url, name: c.displayName }));
}

// ── ICS parsing/building ────────────────────────────────────────────
function parseICS(icsText) {
  try {
    const jcal = ICAL.parse(icsText);
    const comp = new ICAL.Component(jcal);
    return comp.getAllSubcomponents('vevent').map(v => new ICAL.Event(v));
  } catch {
    return [];
  }
}

// Expand a (possibly recurring) VEVENT into concrete occurrences inside [windowStart, windowEnd].
// Does not special-case modified/cancelled recurrence instances (EXDATE/RECURRENCE-ID) —
// same limitation the old TimeTree rrule-based expansion had.
function expandICALEvent(icalEvent, windowStart, windowEnd) {
  const results = [];
  try {
    const allDay = icalEvent.startDate.isDate;
    const durationSec = icalEvent.duration ? icalEvent.duration.toSeconds()
      : (icalEvent.endDate.toUnixTime() - icalEvent.startDate.toUnixTime());
    const base = {
      uuid: icalEvent.uid,
      title: icalEvent.summary || '(untitled)',
      all_day: allDay,
      location: icalEvent.location || null,
      note: icalEvent.description || null,
    };

    const withLabels = (startMs, endMs) => ({
      ...base, start_at: startMs, end_at: endMs,
      dateLabel: fmtEventDate(startMs),
      startTime: fmtEventTime(startMs, allDay),
      endTime: allDay ? null : fmtEventTime(endMs, false),
    });

    if (icalEvent.isRecurring()) {
      const seed = ICAL.Time.fromJSDate(new Date(Math.min(windowStart, icalEvent.startDate.toUnixTime() * 1000)));
      const iter = icalEvent.iterator(seed);
      let next, guard = 0;
      while ((next = iter.next()) && guard++ < 3000) {
        const startMs = next.toUnixTime() * 1000;
        if (startMs > windowEnd) break;
        const endMs = startMs + durationSec * 1000;
        if (endMs > windowStart) results.push(withLabels(startMs, endMs));
      }
    } else {
      const startMs = icalEvent.startDate.toUnixTime() * 1000;
      const endMs = icalEvent.endDate ? icalEvent.endDate.toUnixTime() * 1000 : startMs + durationSec * 1000;
      if (startMs < windowEnd && endMs > windowStart) results.push(withLabels(startMs, endMs));
    }
  } catch (e) {
    console.warn('Apple Calendar expand error:', e.message);
  }
  return results;
}

function pad(n) { return String(n).padStart(2, '0'); }

// Local date+time string → UTC ms, accounting for DST in the given timezone
function localToUtcMs(dateStr, timeStr, tz) {
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

function toICALDateTime(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
function toICALDateOnly(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}
function icsEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function buildICS({ uid, title, startMs, endMs, allDay, location, note, recurrence }) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//dashboard//calendar//EN', 'BEGIN:VEVENT',
    `UID:${uid}`, `DTSTAMP:${toICALDateTime(Date.now())}`];
  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${toICALDateOnly(startMs)}`);
    lines.push(`DTEND;VALUE=DATE:${toICALDateOnly(endMs + 86400000)}`); // DTEND is exclusive
  } else {
    lines.push(`DTSTART:${toICALDateTime(startMs)}`);
    lines.push(`DTEND:${toICALDateTime(endMs)}`);
  }
  lines.push(`SUMMARY:${icsEscape(title)}`);
  if (location) lines.push(`LOCATION:${icsEscape(location)}`);
  if (note) lines.push(`DESCRIPTION:${icsEscape(note)}`);
  if (recurrence) lines.push(recurrence.toUpperCase().startsWith('RRULE:') ? recurrence : `RRULE:${recurrence}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

function calendarObjectUrl(uid) {
  const base = _calendar.url.endsWith('/') ? _calendar.url : _calendar.url + '/';
  return `${base}${uid}.ics`;
}

async function fetchObjectByUrl(url) {
  try {
    const objs = await _client.fetchCalendarObjects({ calendar: _calendar, objectUrls: [url] });
    return objs.find(o => o.data) || null;
  } catch {
    return null;
  }
}

// Wide-window fallback for events we didn't create ourselves (so the UID-as-filename
// shortcut in calendarObjectUrl() doesn't apply) — e.g. events added directly on the phone.
async function findObjectByUid(uid) {
  const now = Date.now();
  const objects = await _client.fetchCalendarObjects({
    calendar: _calendar,
    timeRange: { start: new Date(now - 400 * 86400000).toISOString(), end: new Date(now + 400 * 86400000).toISOString() },
  });
  for (const obj of objects) {
    if (!obj.data) continue;
    if (parseICS(obj.data).some(v => v.uid === uid)) return obj;
  }
  return null;
}

async function resolveObjectForUid(uid) {
  const direct = await fetchObjectByUrl(calendarObjectUrl(uid));
  if (direct) return direct;
  return findObjectByUid(uid);
}

// ── Public API (mirrors the old timetree.js surface) ────────────────
async function getEventsForRange(startMs, endMs) {
  await ensureAuth();
  try {
    const objects = await _client.fetchCalendarObjects({
      calendar: _calendar,
      timeRange: { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() },
    });
    const result = [];
    for (const obj of objects) {
      if (!obj.data) continue;
      for (const ve of parseICS(obj.data)) result.push(...expandICALEvent(ve, startMs, endMs));
    }
    return result.sort((a, b) => a.start_at - b.start_at);
  } catch (e) {
    console.error('Apple Calendar getEventsForRange error:', e.message);
    return [];
  }
}

async function getUpcomingEvents(days = 14) {
  const todayPacific = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const windowStart = new Date(todayPacific + 'T00:00:00-07:00').getTime();
  return getEventsForRange(windowStart, windowStart + days * 86400000);
}

async function createEvent({ title, date, time, endDate, endTime, allDay = false, location, note, recurrence }) {
  await ensureAuth();
  const uid = `${randomUUID()}@dashboard`;
  const startMs = allDay
    ? Date.UTC(...date.split('-').map((n, i) => i === 1 ? +n - 1 : +n))
    : localToUtcMs(date, time || '09:00', TZ);
  const endMs = allDay ? startMs : localToUtcMs(endDate || date, endTime || time || '10:00', TZ);

  const ics = buildICS({ uid, title, startMs, endMs, allDay, location, note, recurrence });
  const res = await _client.createCalendarObject({ calendar: _calendar, iCalString: ics, filename: `${uid}.ics` });
  if (!res.ok) throw new Error(`Apple Calendar create failed: HTTP ${res.status}`);
  return { uuid: uid, title, all_day: allDay, start_at: startMs, end_at: endMs, location: location || null, note: note || null };
}

async function updateEvent(eventUuid, { title, date, time, endDate, endTime, allDay, location, note }) {
  await ensureAuth();
  const obj = await resolveObjectForUid(eventUuid);
  if (!obj) throw new Error('Event not found on Apple Calendar: ' + eventUuid);
  const existing = parseICS(obj.data)[0];
  if (!existing) throw new Error('Could not parse existing Apple Calendar event');

  const isAllDay = allDay != null ? allDay : existing.startDate.isDate;
  let startMs, endMs;
  if (date) {
    startMs = isAllDay
      ? Date.UTC(...date.split('-').map((n, i) => i === 1 ? +n - 1 : +n))
      : localToUtcMs(date, time || '09:00', TZ);
    const eDate = endDate || date;
    endMs = isAllDay
      ? Date.UTC(...eDate.split('-').map((n, i) => i === 1 ? +n - 1 : +n))
      : localToUtcMs(eDate, endTime || time || '10:00', TZ);
  } else {
    startMs = existing.startDate.toUnixTime() * 1000;
    endMs = existing.endDate.toUnixTime() * 1000;
  }

  const ics = buildICS({
    uid: eventUuid,
    title: title != null ? title : existing.summary,
    startMs, endMs, allDay: isAllDay,
    location: location != null ? location : existing.location,
    note: note != null ? note : existing.description,
  });

  const res = await _client.updateCalendarObject({ calendarObject: { url: obj.url, etag: obj.etag, data: ics } });
  if (!res.ok) throw new Error(`Apple Calendar update failed: HTTP ${res.status}`);
  return { uuid: eventUuid, title: title != null ? title : existing.summary, start_at: startMs, end_at: endMs };
}

async function deleteEvent(eventUuid) {
  await ensureAuth();
  const obj = await resolveObjectForUid(eventUuid);
  if (!obj) throw new Error('Event not found on Apple Calendar: ' + eventUuid);
  const res = await _client.deleteCalendarObject({ calendarObject: { url: obj.url, etag: obj.etag } });
  if (!res.ok && res.status !== 404) throw new Error(`Apple Calendar delete failed: HTTP ${res.status}`);
}

// ── Dan vs. Julia split (same title-keyword heuristic as the old TimeTree module) ──
const DAN_TITLE_KEYWORDS = ['dan', 'office', 'timesheet', 'rdo'];
const JULIA_TITLE_KEYWORDS = ['julia', 'nails', 'orthodontist', 'clinic', 'earrings', 'suki'];

function isDanEvent(e) {
  const title = (e.title || '').toLowerCase();
  if (DAN_TITLE_KEYWORDS.some(k => title.includes(k))) return true;
  if (JULIA_TITLE_KEYWORDS.some(k => title.includes(k))) return false;
  return true; // personal calendar defaults to Dan's when unclear
}

function fmtEventTime(tsMs, allDay) {
  if (allDay) return '[all day]';
  return new Date(tsMs).toLocaleTimeString('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
}
function fmtEventDate(tsMs) {
  return new Date(tsMs).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
}

function eventsToBlock(events) {
  if (!events.length) return '  (none)';
  const byDate = {};
  for (const e of events) (byDate[fmtEventDate(e.start_at)] ||= []).push(e);
  return Object.entries(byDate).map(([date, evts]) => {
    const items = evts.map(e => {
      const time = e.all_day ? '[all day]' : `${fmtEventTime(e.start_at)}–${fmtEventTime(e.end_at)}`;
      const loc = e.location ? ` @ ${e.location}` : '';
      return `    • ${e.title} ${time}${loc} [id:${e.uuid}]`;
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

module.exports = {
  getUpcomingEvents, getEventsForRange, createEvent, updateEvent, deleteEvent,
  getCalendars, formatForPrompt, isDanEvent, authenticate,
};
