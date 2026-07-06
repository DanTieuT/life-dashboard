// Direct carrier tracking — free UPS / FedEx / USPS developer APIs instead of
// a paid aggregator. Each driver normalizes to the same shape shipping-sync
// already uses: { status, statusText, carrier, eta, lastLocation, events, deliveredAt }
// where status ∈ Delivered | OutForDelivery | InTransit | InfoReceived |
//               Exception | DeliveryFailure | AvailableForPickup | NotFound.
//
// Env (each pair optional — carriers without keys are skipped):
//   UPS_CLIENT_ID / UPS_CLIENT_SECRET       (developer.ups.com, free)
//   FEDEX_API_KEY / FEDEX_SECRET_KEY        (developer.fedex.com, free)
//   USPS_CLIENT_ID / USPS_CLIENT_SECRET     (developer.usps.com, free)

if (!process.env.UPS_CLIENT_ID && !process.env.FEDEX_API_KEY && !process.env.USPS_CLIENT_ID) {
  try {
    const fs = require('fs'), path = require('path');
    fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^#=\s]+)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
  } catch {}
}

// ── Carrier detection ─────────────────────────────────────────────
// Explicit carrier hints (from Gmail extraction or manual entry) win;
// otherwise detect from the tracking number format.
function detectCarrier(trackingNumber, hint) {
  const h = (hint || '').toLowerCase();
  if (/ups/.test(h)) return 'ups';
  if (/fedex/.test(h)) return 'fedex';
  if (/usps|postal/.test(h)) return 'usps';
  const n = (trackingNumber || '').replace(/\s/g, '').toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return 'ups';
  if (/^9[0-5][0-9]{14,24}$/.test(n)) return 'usps';   // USPS IMpb starts 92-95 (96 = FedEx Ground)
  if (/^[0-9]{12}$/.test(n) || /^[0-9]{15}$/.test(n)) return 'fedex';
  if (/^[0-9]{20,22}$/.test(n)) return 'fedex';        // FedEx Ground incl. 96-prefixed
  if (/^(EC|EA|CP|RA|LK)[0-9]{9}US$/.test(n)) return 'usps'; // international
  return null;
}

// Text-based status normalization — shared safety net across carriers so we
// stay correct even if a carrier's structured codes drift.
function statusFromText(text) {
  const t = (text || '').toLowerCase();
  if (/delivered/.test(t)) return 'Delivered';
  if (/out for delivery/.test(t)) return 'OutForDelivery';
  if (/available for pickup|ready for pick/.test(t)) return 'AvailableForPickup';
  if (/attempt|undeliverable|refused|return(ed)? to sender/.test(t)) return 'DeliveryFailure';
  if (/exception|delay|held|weather/.test(t)) return 'Exception';
  if (/label created|shipping label|pre-shipment|order processed|shipment information/.test(t)) return 'InfoReceived';
  if (/in transit|arrived|departed|picked up|accept|processed|on the way|origin|destination/.test(t)) return 'InTransit';
  return null;
}

// ── OAuth token cache (per warm lambda) ───────────────────────────
const _tokens = {}; // key -> {token, exp}
async function oauthToken(key, fetcher) {
  const cached = _tokens[key];
  if (cached && cached.exp > Date.now() + 60000) return cached.token;
  const { token, ttlSec } = await fetcher();
  _tokens[key] = { token, exp: Date.now() + (ttlSec || 3000) * 1000 };
  return token;
}

// ── UPS ───────────────────────────────────────────────────────────
const ups = {
  configured: () => !!(process.env.UPS_CLIENT_ID && process.env.UPS_CLIENT_SECRET),
  async track(num) {
    const token = await oauthToken('ups', async () => {
      const res = await fetch('https://onlinetools.ups.com/security/v1/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(`${process.env.UPS_CLIENT_ID}:${process.env.UPS_CLIENT_SECRET}`).toString('base64'),
        },
        body: 'grant_type=client_credentials',
      });
      const j = await res.json();
      if (!j.access_token) throw new Error('UPS auth failed: ' + JSON.stringify(j).slice(0, 200));
      return { token: j.access_token, ttlSec: Number(j.expires_in) || 3000 };
    });
    const res = await fetch(`https://onlinetools.ups.com/api/track/v1/details/${encodeURIComponent(num)}?locale=en_US`, {
      headers: { Authorization: `Bearer ${token}`, transId: String(Date.now()), transactionSrc: 'commandcenter' },
    });
    if (!res.ok) throw new Error(`UPS track HTTP ${res.status}`);
    const j = await res.json();
    const pkg = j.trackResponse?.shipment?.[0]?.package?.[0];
    if (!pkg) return null;
    const acts = pkg.activity || [];
    const fmtLoc = a => [a.location?.address?.city, a.location?.address?.stateProvince].filter(Boolean).join(', ');
    const fmtTime = a => { // date "20260705", time "143000"
      const d = a.date || '', t = a.time || '120000';
      return Date.parse(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}`);
    };
    const events = acts.slice(0, 15).map(a => ({ time: fmtTime(a), desc: a.status?.description || '', location: fmtLoc(a) }));
    const latest = acts[0];
    const typeMap = { D: 'Delivered', I: 'InTransit', P: 'InTransit', M: 'InfoReceived', X: 'Exception', O: 'OutForDelivery' };
    const status = statusFromText(latest?.status?.description) || typeMap[latest?.status?.type] || 'InTransit';
    const dd = (pkg.deliveryDate || []).find(x => x.type === 'DEL' || x.type === 'SDD' || x.type === 'RDD');
    const eta = dd?.date ? Date.parse(`${dd.date.slice(0,4)}-${dd.date.slice(4,6)}-${dd.date.slice(6,8)}T12:00:00`) : null;
    return {
      status, statusText: latest?.status?.description || '', carrier: 'UPS',
      eta, lastLocation: latest ? fmtLoc(latest) : '', events,
      deliveredAt: status === 'Delivered' && latest ? fmtTime(latest) : null,
    };
  },
};

// ── FedEx ─────────────────────────────────────────────────────────
const fedex = {
  configured: () => !!(process.env.FEDEX_API_KEY && process.env.FEDEX_SECRET_KEY),
  async track(num) {
    const token = await oauthToken('fedex', async () => {
      const res = await fetch('https://apis.fedex.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.FEDEX_API_KEY, client_secret: process.env.FEDEX_SECRET_KEY }),
      });
      const j = await res.json();
      if (!j.access_token) throw new Error('FedEx auth failed: ' + JSON.stringify(j).slice(0, 200));
      return { token: j.access_token, ttlSec: Number(j.expires_in) || 3000 };
    });
    const res = await fetch('https://apis.fedex.com/track/v1/trackingnumbers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ includeDetailedScans: true, trackingInfo: [{ trackingNumberInfo: { trackingNumber: num } }] }),
    });
    if (!res.ok) throw new Error(`FedEx track HTTP ${res.status}`);
    const j = await res.json();
    const tr = j.output?.completeTrackResults?.[0]?.trackResults?.[0];
    if (!tr || tr.error) return null;
    const scans = tr.scanEvents || [];
    const fmtLoc = s => [s.scanLocation?.city, s.scanLocation?.stateOrProvinceCode].filter(Boolean).join(', ');
    const events = scans.slice(0, 15).map(s => ({ time: s.date ? Date.parse(s.date) : null, desc: s.eventDescription || '', location: fmtLoc(s) }));
    const codeMap = { DL: 'Delivered', OD: 'OutForDelivery', IT: 'InTransit', PU: 'InTransit', AR: 'InTransit', DP: 'InTransit', IN: 'InfoReceived', OC: 'InfoReceived', DE: 'Exception', CA: 'Exception', HL: 'AvailableForPickup', RS: 'DeliveryFailure' };
    const derived = tr.latestStatusDetail?.derivedCode || tr.latestStatusDetail?.code;
    const status = codeMap[derived] || statusFromText(tr.latestStatusDetail?.description || scans[0]?.eventDescription) || 'InTransit';
    const win = tr.estimatedDeliveryTimeWindow?.window?.ends || tr.standardTransitTimeWindow?.window?.ends;
    const eta = win ? Date.parse(win) : null;
    return {
      status, statusText: tr.latestStatusDetail?.description || scans[0]?.eventDescription || '', carrier: 'FedEx',
      eta, lastLocation: scans[0] ? fmtLoc(scans[0]) : '', events,
      deliveredAt: status === 'Delivered' && scans[0]?.date ? Date.parse(scans[0].date) : null,
    };
  },
};

// ── USPS ──────────────────────────────────────────────────────────
const usps = {
  configured: () => !!(process.env.USPS_CLIENT_ID && process.env.USPS_CLIENT_SECRET),
  async track(num) {
    const token = await oauthToken('usps', async () => {
      const res = await fetch('https://apis.usps.com/oauth2/v3/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials', client_id: process.env.USPS_CLIENT_ID, client_secret: process.env.USPS_CLIENT_SECRET }),
      });
      const j = await res.json();
      if (!j.access_token) throw new Error('USPS auth failed: ' + JSON.stringify(j).slice(0, 200));
      return { token: j.access_token, ttlSec: Number(j.expires_in) || 3000 };
    });
    const res = await fetch(`https://apis.usps.com/tracking/v3/tracking/${encodeURIComponent(num)}?expand=DETAIL`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`USPS track HTTP ${res.status}`);
    const j = await res.json();
    const evts = j.trackingEvents || [];
    const fmtLoc = e => [e.eventCity, e.eventState].filter(Boolean).join(', ');
    const events = evts.slice(0, 15).map(e => ({ time: e.eventTimestamp ? Date.parse(e.eventTimestamp) : null, desc: e.eventType || e.event || '', location: fmtLoc(e) }));
    const latest = evts[0];
    const status = statusFromText(j.statusCategory) || statusFromText(j.status) || statusFromText(latest?.eventType) || 'InTransit';
    const eta = j.expectedDeliveryTimeStamp ? Date.parse(j.expectedDeliveryTimeStamp) : (j.expectedDeliveryDate ? Date.parse(j.expectedDeliveryDate + 'T12:00:00') : null);
    return {
      status, statusText: latest?.eventType || j.status || '', carrier: 'USPS',
      eta, lastLocation: latest ? fmtLoc(latest) : '', events,
      deliveredAt: status === 'Delivered' && latest?.eventTimestamp ? Date.parse(latest.eventTimestamp) : null,
    };
  },
};

const DRIVERS = { ups, fedex, usps };

// Track a package via the right carrier. Returns normalized info, or null if
// the carrier is unknown/unconfigured (caller may fall back to 17TRACK).
async function track(trackingNumber, carrierHint) {
  const carrier = detectCarrier(trackingNumber, carrierHint);
  if (!carrier) return null;
  const driver = DRIVERS[carrier];
  if (!driver.configured()) return null;
  return driver.track(trackingNumber);
}

function anyConfigured() {
  return Object.values(DRIVERS).some(d => d.configured());
}

module.exports = { detectCarrier, statusFromText, track, anyConfigured, DRIVERS };
