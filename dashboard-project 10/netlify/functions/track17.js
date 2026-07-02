// 17TRACK v2.2 API helper — register tracking numbers and fetch status.
// Requires TRACK17_API_KEY env var (free tier: ~100 registrations/month).
// Docs: https://api.17track.net/en/doc?version=v2.2

const API_BASE = 'https://api.17track.net/track/v2.2';

function apiKey() {
  return process.env.TRACK17_API_KEY || '';
}

async function apiCall(path, body) {
  const res = await fetch(`${API_BASE}/${path}`, {
    method: 'POST',
    headers: { '17token': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`17TRACK ${path} HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`17TRACK ${path} code ${json.code}`);
  return json.data || {};
}

// Register numbers for tracking. Returns Set of numbers now registered
// (treats "already registered" rejections as success).
async function register(numbers) {
  if (!numbers.length) return new Set();
  const data = await apiCall('register', numbers.map(n => ({ number: n })));
  const ok = new Set((data.accepted || []).map(a => a.number));
  for (const r of data.rejected || []) {
    // -18019901: already registered — that's fine, it's tracked
    if (r.error && r.error.code === -18019901) ok.add(r.number);
  }
  return ok;
}

// Fetch tracking info for numbers. Returns Map number -> normalized info:
// { status, statusText, carrier, eta, lastLocation, events:[{time,desc,location}], deliveredAt }
async function getTrackInfo(numbers) {
  const out = new Map();
  if (!numbers.length) return out;
  const data = await apiCall('gettrackinfo', numbers.map(n => ({ number: n })));
  for (const item of data.accepted || []) {
    const ti = item.track_info || {};
    const latest = ti.latest_status || {};
    const provider = ti.tracking?.providers?.[0];
    const rawEvents = provider?.events || [];
    const events = rawEvents.slice(0, 15).map(e => ({
      time: e.time_iso ? Date.parse(e.time_iso) : null,
      desc: e.description || '',
      location: e.location || '',
    }));
    const latestEvent = ti.latest_event || {};
    const etaRange = ti.time_metrics?.estimated_delivery_date;
    const eta = etaRange?.from ? Date.parse(etaRange.from) : null;
    let deliveredAt = null;
    if (latest.status === 'Delivered') {
      deliveredAt = latestEvent.time_iso ? Date.parse(latestEvent.time_iso) : Date.now();
    }
    out.set(item.number, {
      status: latest.status || 'NotFound',
      statusText: latestEvent.description || latest.status || '',
      carrier: provider?.provider?.name || '',
      eta,
      lastLocation: latestEvent.location || '',
      events,
      deliveredAt,
    });
  }
  return out;
}

module.exports = { register, getTrackInfo, apiKey };
