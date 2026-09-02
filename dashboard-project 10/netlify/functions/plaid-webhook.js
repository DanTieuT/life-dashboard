// Plaid webhook receiver. Plaid POSTs here whenever an Item has news; the one
// we care about is TRANSACTIONS / SYNC_UPDATES_AVAILABLE, which means fresh
// transaction data is ready to pull. We run the same sync engine as the
// hourly job (plaid-sync-core.js) but scoped to the single Item that fired,
// so a purchase shows up within seconds of Plaid having it instead of on the
// next hourly tick.
//
// Every request is verified against Plaid's signing key (plaid.verifyWebhook)
// before we act — the body is otherwise untrusted. Unrecognised webhook types
// get a plain 200 so Plaid doesn't retry them.
//
// New Items get our webhook URL from the link token. Existing Items need a
// one-time push: GET /plaid-link?action=set_webhooks (authed).
const admin = require('firebase-admin');
const plaid = require('./plaid.js');
const { initFirebase, syncItems, USER_UID } = require('./plaid-sync-core.js');

const TXN_UPDATE_CODES = new Set([
  'SYNC_UPDATES_AVAILABLE',
  'INITIAL_UPDATE', 'HISTORICAL_UPDATE', 'DEFAULT_UPDATE', // legacy pre-sync codes
]);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  if (!plaid.configured()) return { statusCode: 200, body: 'Plaid not configured' };

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  const verification = event.headers?.['plaid-verification'] || event.headers?.['Plaid-Verification'];
  if (!(await plaid.verifyWebhook(verification, rawBody))) {
    console.warn('[plaid-webhook] rejected: bad or missing verification');
    return { statusCode: 401, body: 'invalid webhook signature' };
  }

  let body;
  try { body = JSON.parse(rawBody); } catch { return { statusCode: 400, body: 'bad json' }; }
  const { webhook_type: type, webhook_code: code, item_id: itemId } = body;

  if (type !== 'TRANSACTIONS' || !TXN_UPDATE_CODES.has(code)) {
    console.log(`[plaid-webhook] ignoring ${type}/${code}`);
    return { statusCode: 200, body: 'ignored' };
  }

  try {
    initFirebase();
    const db = admin.firestore();
    const itemSnap = await db.doc(`users/${USER_UID}/plaidItems/${itemId}`).get();
    if (!itemSnap.exists) {
      console.warn(`[plaid-webhook] ${code} for unknown item ${itemId}`);
      return { statusCode: 200, body: 'unknown item' };
    }
    const { summary } = await syncItems(db, [itemSnap]);
    console.log(`[plaid-webhook] ${code} ${itemId} → ${summary}`);
    return { statusCode: 200, body: summary };
  } catch (e) {
    console.error('[plaid-webhook] sync failed:', e);
    // 500 → Plaid retries with backoff, which is what we want on a transient failure.
    return { statusCode: 500, body: e.message };
  }
};
