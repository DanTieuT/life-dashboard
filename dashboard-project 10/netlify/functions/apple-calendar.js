// Apple iCloud Calendar via CalDAV — replacement for the old TimeTree integration.
// Requires an iCloud app-specific password (appleid.apple.com → Sign-In and
// Security → App-Specific Passwords), NOT the real Apple ID password:
//   APPLE_ID=you@icloud.com
//   APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
//   APPLE_CALENDAR_NAME=Shared D+J   (optional override for the write-target calendar below)
const { DAVClient } = require('tsdav');
const ICAL = require('ical.js');
const { randomUUID } = require('crypto');

const SERVER_URL = 'https://caldav.icloud.com';
const TZ = 'America/Los_Angeles';

// Calendars pulled into the dashboard (today's schedule, JARVIS context, calendar tab).
// Julia's Calendar events are attributed to her by source calendar, not title guessing —
// the rest can hold either person's events (or are Dan's by default), so those still
// fall back to keywords.
const READ_CALENDAR_NAMES = ['Shared D+J', 'Dan’s Calendar', 'Dan’s Work Calendar', 'Julia’s Calendar', 'Home', 'Work', 'Personal Private', 'Stock Events', 'Julia Location', 'Julia’s Workouts'];
// Every calendar that's unambiguously Julia's own, regardless of event
// title — isDanEvent() trusts this before falling back to keyword
// guessing, since a title-based guess only works when the title happens to
// mention her (a location calendar's "events" might just be city names).
const JULIA_CALENDAR_NAMES = new Set(['Julia’s Calendar', 'Julia Location', 'Julia’s Workouts']);
// Where JARVIS writes new events (add_calendar_event) — override with APPLE_CALENDAR_NAME.
const WRITE_CALENDAR_NAME = process.env.APPLE_CALENDAR_NAME || 'Shared D+J';

// Module-level session cache (survives warm invocations)
let _client = null;
let _writeCalendar = null;
let _readCalendars = null;

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
  const nameOf = c => (typeof c.displayName === 'string' ? c.displayName : '');

  const writeCalendar = writable.find(c => nameOf(c) === WRITE_CALENDAR_NAME) || writable[0];
  if (!writeCalendar) throw new Error('No writable Apple Calendar found on this account');

  const readCalendars = READ_CALENDAR_NAMES
    .map(name => writable.find(c => nameOf(c) === name))
    .filter(Boolean);
  if (!readCalendars.length) readCalendars.push(writeCalendar);
  if (!readCalendars.some(c => c.url === writeCalendar.url)) readCalendars.push(writeCalendar);

  _client = client;
  _writeCalendar = writeCalendar;
  _readCalendars = readCalendars;
}

async function ensureAuth() {
  if (_client && _writeCalendar) return;
  await authenticate();
}

async function getCalendars() {
  await ensureAuth();
  const calendars = await _client.fetchCalendars();
  return calendars.map(c => ({
    id: c.url,
    name: typeof c.displayName === 'string' ? c.displayName : '',
    components: c.components || [],
    write: c.url === _writeCalendar.url,
    read: _readCalendars.some(rc => rc.url === c.url),
  }));
}

// Authoritative "what can you actually see" — the live intersection of
// READ_CALENDAR_NAMES and what actually exists on the account, not just the
// static configured list (which could name a calendar that's since been
// deleted or renamed). Feeds getDashboardContext's readableCalendars field
// so "what calendars can you see" has a real answer instead of the model
// inferring access from whether events happen to exist in the date window —
// an empty calendar would otherwise look indistinguishable from an
// inaccessible one.
async function getReadableCalendarNames() {
  await ensureAuth();
  return _readCalendars.map(c => (typeof c.displayName === 'string' ? c.displayName : '')).filter(Boolean);
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
function expandICALEvent(icalEvent, windowStart, windowEnd, calendarName) {
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
      calendarName: calendarName || null,
    };

    const withLabels = (startMs, endMs) => ({
      ...base, start_at: startMs, end_at: endMs,
      dateLabel: fmtEventDate(startMs, allDay),
      startTime: fmtEventTime(startMs, allDay),
      endTime: allDay ? null : fmtEventTime(endMs, false),
    });

    if (icalEvent.isRecurring()) {
      // No manual seed here — ICAL.Time.fromJSDate() doesn't preserve the DATE-only
      // (all-day) nature of the seed, which silently corrupts occurrence times for
      // all-day recurring events (e.g. a weekly all-day event started showing as a
      // timed 17:00 UTC block instead of midnight, shifting it onto the wrong day).
      // Iterating from DTSTART and skipping/breaking on the window is slightly more
      // work but always correct; guard bound covers years of daily recurrence.
      const iter = icalEvent.iterator();
      let next, guard = 0;
      while ((next = iter.next()) && guard++ < 10000) {
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

// UTC "Z" timestamp — only for DTSTAMP (creation metadata), never for the
// event's own start/end, or Apple Calendar tags the event "GMT" underneath
// the time since it's not tied to a named timezone.
function toICALDateTime(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
// Local wall-clock time in `tz`, no Z/offset — paired with DTSTART/DTEND;TZID=...
function toICALLocalDateTime(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find(p => p.type === type).value;
  return `${get('year')}${get('month')}${get('day')}T${get('hour') === '24' ? '00' : get('hour')}${get('minute')}${get('second')}`;
}
function toICALDateOnly(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}
// Builds an ICAL.Time via direct field construction (year/month/day/...)
// rather than string parsing — ICAL.Time.fromString() requires dashes/colons
// our compact toICALLocalDateTime()/toICALDateOnly() strings don't have, and
// direct field assignment is what's already proven correct for EXDATE above.
function icalTimeFromLocal(ms, tz, isDate) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type) => +parts.find(p => p.type === type).value;
  return new ICAL.Time({
    year: get('year'), month: get('month'), day: get('day'),
    hour: isDate ? 0 : (get('hour') % 24), minute: isDate ? 0 : get('minute'), second: isDate ? 0 : get('second'),
    isDate: !!isDate,
  });
}
function icsEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// Minimal current-era VTIMEZONE for America/Los_Angeles (post-2007 US DST rules —
// matches the tail of what Apple's own client embeds). Required alongside any
// DTSTART/DTEND;TZID=America/Los_Angeles so the event isn't shown as a bare
// UTC/GMT time.
const VTIMEZONE_PT = [
  'BEGIN:VTIMEZONE', 'TZID:America/Los_Angeles',
  'BEGIN:DAYLIGHT', 'DTSTART:20070311T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'TZNAME:PDT', 'TZOFFSETFROM:-0800', 'TZOFFSETTO:-0700', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'DTSTART:20071104T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'TZNAME:PST', 'TZOFFSETFROM:-0700', 'TZOFFSETTO:-0800', 'END:STANDARD',
  'END:VTIMEZONE',
].join('\r\n');

function buildICS({ uid, title, startMs, endMs, allDay, location, note, recurrence }) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//dashboard//calendar//EN', 'BEGIN:VEVENT',
    `UID:${uid}`, `DTSTAMP:${toICALDateTime(Date.now())}`];
  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${toICALDateOnly(startMs)}`);
    lines.push(`DTEND;VALUE=DATE:${toICALDateOnly(endMs + 86400000)}`); // DTEND is exclusive
  } else {
    lines.push(`DTSTART;TZID=${TZ}:${toICALLocalDateTime(startMs, TZ)}`);
    lines.push(`DTEND;TZID=${TZ}:${toICALLocalDateTime(endMs, TZ)}`);
  }
  lines.push(`SUMMARY:${icsEscape(title)}`);
  if (location) lines.push(`LOCATION:${icsEscape(location)}`);
  if (note) lines.push(`DESCRIPTION:${icsEscape(note)}`);
  if (recurrence) lines.push(recurrence.toUpperCase().startsWith('RRULE:') ? recurrence : `RRULE:${recurrence}`);
  lines.push('END:VEVENT');
  if (!allDay) lines.push(VTIMEZONE_PT);
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function calendarObjectUrl(uid) {
  const base = _writeCalendar.url.endsWith('/') ? _writeCalendar.url : _writeCalendar.url + '/';
  return `${base}${uid}.ics`;
}

async function fetchObjectByUrl(url) {
  try {
    const objs = await _client.fetchCalendarObjects({ calendar: _writeCalendar, objectUrls: [url] });
    return objs.find(o => o.data) || null;
  } catch {
    return null;
  }
}

// Wide-window fallback for events we didn't create ourselves (so the UID-as-filename
// shortcut in calendarObjectUrl() doesn't apply) — e.g. events added directly on the phone,
// or ones living on a read calendar other than the write target (Julia's, Dan's Work, etc).
async function findObjectByUid(uid) {
  const now = Date.now();
  for (const calendar of _readCalendars) {
    const objects = await _client.fetchCalendarObjects({
      calendar,
      timeRange: { start: new Date(now - 400 * 86400000).toISOString(), end: new Date(now + 400 * 86400000).toISOString() },
    });
    for (const obj of objects) {
      if (!obj.data) continue;
      if (parseICS(obj.data).some(v => v.uid === uid)) return obj;
    }
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
  const result = [];
  for (const calendar of _readCalendars) {
    const calendarName = typeof calendar.displayName === 'string' ? calendar.displayName : '';
    try {
      const objects = await _client.fetchCalendarObjects({
        calendar,
        timeRange: { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() },
      });
      for (const obj of objects) {
        if (!obj.data) continue;
        for (const ve of parseICS(obj.data)) result.push(...expandICALEvent(ve, startMs, endMs, calendarName));
      }
    } catch (e) {
      console.error(`Apple Calendar getEventsForRange error (${calendarName}):`, e.message);
    }
  }
  return result.sort((a, b) => a.start_at - b.start_at);
}

async function getUpcomingEvents(days = 14) {
  const todayPacific = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const windowStart = new Date(todayPacific + 'T00:00:00-07:00').getTime();
  return getEventsForRange(windowStart, windowStart + days * 86400000);
}

async function createEvent({ title, date, time, endDate, endTime, allDay = false, location, note, recurrence, calendar }) {
  await ensureAuth();
  const uid = `${randomUUID()}@dashboard`;
  const startMs = allDay
    ? Date.UTC(...date.split('-').map((n, i) => i === 1 ? +n - 1 : +n))
    : localToUtcMs(date, time || '09:00', TZ);
  const endMs = allDay ? startMs : localToUtcMs(endDate || date, endTime || time || '10:00', TZ);

  // Silently falling back to the default calendar on a non-matching name
  // was a real bug, not a safe default — Dan asked for a specific calendar,
  // got no error, and the event landed somewhere else entirely with the
  // response claiming success. Fail loudly instead.
  let target = _writeCalendar;
  if (calendar) {
    target = _readCalendars.find(c => (typeof c.displayName === 'string' ? c.displayName : '') === calendar);
    if (!target) throw new Error(`Unknown calendar "${calendar}" — not in the readable calendar list, event NOT created`);
  }

  const ics = buildICS({ uid, title, startMs, endMs, allDay, location, note, recurrence });
  const res = await _client.createCalendarObject({ calendar: target, iCalString: ics, filename: `${uid}.ics` });
  if (!res.ok) throw new Error(`Apple Calendar create failed: HTTP ${res.status}`);
  return { uuid: uid, title, all_day: allDay, start_at: startMs, end_at: endMs, location: location || null, note: note || null };
}

// Adds an EXDATE property to `vevent` at local date `dateStr` (YYYY-MM-DD),
// matching DTSTART's value-type (all-day vs timed) and TZID so the exclusion
// actually lines up with a real occurrence. Mutates `vevent` in place.
function addExdate(vevent, dateStr) {
  const dtstartProp = vevent.getFirstProperty('dtstart');
  const dtstartVal = dtstartProp.getFirstValue();
  const [y, mo, d] = dateStr.split('-').map(Number);
  const exVal = dtstartVal.clone();
  exVal.year = y; exVal.month = mo; exVal.day = d;
  const exdateProp = new ICAL.Property('exdate', vevent);
  const tzid = dtstartProp.getParameter('tzid');
  if (tzid) exdateProp.setParameter('TZID', tzid);
  exdateProp.setValue(exVal);
  vevent.addProperty(exdateProp);
}

// Fetches + parses the raw component for an existing event (not just the
// flattened ICAL.Event summary parseICS() returns) — needed so update/delete
// can mutate RRULE/EXDATE-bearing properties in place instead of rebuilding
// the object from scratch and silently dropping them.
async function fetchVComponent(eventUuid) {
  const obj = await resolveObjectForUid(eventUuid);
  if (!obj) return null;
  const jcal = ICAL.parse(obj.data);
  const comp = new ICAL.Component(jcal);
  const vevent = comp.getFirstSubcomponent('vevent');
  if (!vevent) return null;
  return { obj, comp, vevent, event: new ICAL.Event(vevent) };
}

async function updateEvent(eventUuid, { title, date, time, endDate, endTime, allDay, location, note }) {
  await ensureAuth();
  const parsed = await fetchVComponent(eventUuid);
  if (!parsed) throw new Error('Event not found on Apple Calendar: ' + eventUuid);
  const { obj, comp, vevent, event } = parsed;

  // Changing date/time on a recurring event is ambiguous — "reschedule just
  // this Saturday" vs "change what time it recurs at every week" — and the
  // old code silently did neither correctly (it dropped the RRULE entirely,
  // turning the whole series into a single one-off event). Block it with a
  // clear message instead of guessing wrong. Title/location/note edits are
  // safe to apply to the whole series and still allowed.
  if (event.isRecurring() && (date || time || endDate || endTime)) {
    throw new Error(
      `RECURRING_DATE_CHANGE_UNSUPPORTED: "${event.summary}" repeats — changing its date/time isn't ` +
      `supported yet (per-occurrence reschedule needs a feature that doesn't exist). To move just one ` +
      `occurrence: delete that occurrence (delete_calendar_event with occurrence_date) and add a new ` +
      `one-off event instead. Title/location/note can still be edited on the whole series.`
    );
  }

  if (title != null) vevent.updatePropertyWithValue('summary', title);
  if (location != null) vevent.updatePropertyWithValue('location', location);
  if (note != null) vevent.updatePropertyWithValue('description', note);

  // Non-recurring events can still have their date/time changed freely.
  let startMs = event.startDate.toUnixTime() * 1000;
  let endMs = event.endDate.toUnixTime() * 1000;
  if (date && !event.isRecurring()) {
    const isAllDay = allDay != null ? allDay : event.startDate.isDate;
    startMs = isAllDay
      ? Date.UTC(...date.split('-').map((n, i) => i === 1 ? +n - 1 : +n))
      : localToUtcMs(date, time || '09:00', TZ);
    const eDate = endDate || date;
    endMs = isAllDay
      ? Date.UTC(...eDate.split('-').map((n, i) => i === 1 ? +n - 1 : +n))
      : localToUtcMs(eDate, endTime || time || '10:00', TZ);
    vevent.updatePropertyWithValue('dtstart', icalTimeFromLocal(startMs, TZ, isAllDay));
    vevent.updatePropertyWithValue('dtend', icalTimeFromLocal(isAllDay ? endMs + 86400000 : endMs, TZ, isAllDay));
    // updatePropertyWithValue() preserves whatever TZID param the property
    // already had — only need to touch it when isAllDay actually flips the
    // value type (timed→all-day drops TZID; all-day→timed adds it). ical.js
    // stores the param key lowercase ('tzid'); setParameter('TZID', ...)
    // silently created a SECOND, differently-cased param instead of
    // overwriting — caught via a direct round-trip test, not guessed.
    for (const name of ['dtstart', 'dtend']) {
      const prop = vevent.getFirstProperty(name);
      const hasTzid = prop.getParameter('tzid');
      if (isAllDay && hasTzid) prop.removeParameter('tzid');
      else if (!isAllDay && !hasTzid) prop.setParameter('tzid', TZ);
    }
  }

  const res = await _client.updateCalendarObject({ calendarObject: { url: obj.url, etag: obj.etag, data: comp.toString() } });
  if (!res.ok) throw new Error(`Apple Calendar update failed: HTTP ${res.status}`);
  return { uuid: eventUuid, title: title != null ? title : event.summary, start_at: startMs, end_at: endMs };
}

async function deleteEvent(eventUuid, { occurrenceDate, deleteSeries = false } = {}) {
  await ensureAuth();
  const parsed = await fetchVComponent(eventUuid);
  if (!parsed) throw new Error('Event not found on Apple Calendar: ' + eventUuid);
  const { obj, comp, vevent, event } = parsed;

  if (event.isRecurring() && !deleteSeries) {
    if (!occurrenceDate) {
      throw new Error(
        `RECURRING_NEEDS_OCCURRENCE: "${event.summary}" repeats — deleting it needs to know whether you ` +
        `mean just one occurrence or the whole series. Pass occurrence_date (YYYY-MM-DD) to remove a single ` +
        `date, or delete_series: true to remove all of them.`
      );
    }
    // Single-occurrence delete: add an EXDATE instead of deleting the object,
    // so the rest of the series is untouched.
    addExdate(vevent, occurrenceDate);
    const res = await _client.updateCalendarObject({ calendarObject: { url: obj.url, etag: obj.etag, data: comp.toString() } });
    if (!res.ok) throw new Error(`Apple Calendar occurrence-delete failed: HTTP ${res.status}`);
    return;
  }

  // Non-recurring, or an explicit whole-series delete.
  const res = await _client.deleteCalendarObject({ calendarObject: { url: obj.url, etag: obj.etag } });
  if (!res.ok && res.status !== 404) throw new Error(`Apple Calendar delete failed: HTTP ${res.status}`);
}

// ── Dan vs. Julia split — trust the source calendar first, fall back to
// title keywords for the shared/ambiguous calendars (same heuristic the old
// TimeTree module used, since Shared D+J and Dan's calendars can hold either person's events) ──
const DAN_TITLE_KEYWORDS = ['dan', 'office', 'timesheet', 'rdo'];
const JULIA_TITLE_KEYWORDS = ['julia', 'nails', 'orthodontist', 'clinic', 'earrings', 'suki'];

function isDanEvent(e) {
  if (JULIA_CALENDAR_NAMES.has(e.calendarName)) return false;
  const title = (e.title || '').toLowerCase();
  if (DAN_TITLE_KEYWORDS.some(k => title.includes(k))) return true;
  if (JULIA_TITLE_KEYWORDS.some(k => title.includes(k))) return false;
  return true; // personal calendar defaults to Dan's when unclear
}

function fmtEventTime(tsMs, allDay) {
  if (allDay) return '[all day]';
  return new Date(tsMs).toLocaleTimeString('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
}
// All-day (VALUE=DATE) events have no timezone at all — ical.js's
// toUnixTime() treats the bare date as UTC midnight (standard iCal
// convention, true for every all-day event regardless of source, not just
// ones this app created). Converting that to Pacific for display shifts it
// back 7-8 hours, landing on the PREVIOUS Pacific calendar day — that's
// what showed a real Aug 15 event as "Aug 14". Timed events still need real
// Pacific conversion; all-day events need the UTC date read directly.
function fmtEventDate(tsMs, allDay) {
  return new Date(tsMs).toLocaleDateString('en-US', { timeZone: allDay ? 'UTC' : TZ, weekday: 'short', month: 'short', day: 'numeric' });
}

function eventsToBlock(events) {
  if (!events.length) return '  (none)';
  const byDate = {};
  for (const e of events) (byDate[fmtEventDate(e.start_at, e.all_day)] ||= []).push(e);
  return Object.entries(byDate).map(([date, evts]) => {
    const items = evts.map(e => {
      const time = e.all_day ? '[all day]' : `${fmtEventTime(e.start_at)}–${fmtEventTime(e.end_at)}`;
      const loc = e.location ? ` @ ${e.location}` : '';
      // Which of the 8 source calendars this event lives on — without this,
      // every event just reads as generic "Dan's schedule" with no way to
      // answer "what's on my Stock Events calendar" specifically, even
      // though the data was always there per-event (calendarName).
      const cal = e.calendarName ? ` [${e.calendarName}]` : '';
      // Multi-day all-day events (a trip, a conference) were only ever shown
      // once, under their start date, indistinguishable from a single-day
      // event — "sees only one day of the trip". DTEND on an all-day event
      // is exclusive per iCal convention (see buildICS), so the real last
      // day is end_at minus one day.
      let range = '';
      if (e.all_day) {
        const lastDay = fmtEventDate(e.end_at - 86400000, true);
        if (lastDay !== date) range = ` (through ${lastDay})`;
      }
      return `    • ${e.title}${range} ${time}${loc}${cal} [id:${e.uuid}]`;
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
  getCalendars, getReadableCalendarNames, formatForPrompt, isDanEvent, authenticate,
};
