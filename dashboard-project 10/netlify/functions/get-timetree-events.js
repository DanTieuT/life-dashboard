const timetree = require('./timetree.js');
const TZ = 'America/Los_Angeles';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const params = event.queryStringParameters || {};
    const year = parseInt(params.year) || new Date().getFullYear();
    const month = parseInt(params.month); // 0-indexed
    const m = isNaN(month) ? new Date().getMonth() : month;

    // Cover full month plus a small buffer so multi-day events that start in the
    // prior month but bleed into this one are included
    const windowStart = new Date(year, m - 1, 25).getTime();
    const windowEnd   = new Date(year, m + 1, 7).getTime();

    const raw = await timetree.getEventsForRange(windowStart, windowEnd);

    const events = raw.map(e => {
      // All-day events are stored as midnight UTC — use UTC date directly, not Pacific
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
      };
    });

    return { statusCode: 200, headers, body: JSON.stringify({ events }) };
  } catch (e) {
    console.error('get-timetree-events error:', e.message, e.body);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message, detail: e.body }) };
  }
};

function toLocalDate(tsMs) {
  return new Date(tsMs).toLocaleDateString('en-CA', { timeZone: TZ });
}
function utcDate(tsMs) {
  return new Date(tsMs).toISOString().slice(0, 10);
}
function fmtTime(tsMs) {
  return new Date(tsMs).toLocaleTimeString('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
}
