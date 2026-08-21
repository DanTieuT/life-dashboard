// watchlist-quotes.js — GET, returns live quotes for appData.stockWatchlist.
// Dashboard-only endpoint: FINNHUB_API_KEY can't be exposed to browser JS,
// and finance-query.js's GPT_BRIDGE_KEY isn't the right auth model for the
// browser either (that's a static shared secret meant only for the ChatGPT
// bridge) — so this gets its own Firebase-ID-token-authed endpoint, same
// pattern plaid-link.js uses, and reuses the exact same tool implementation
// finance-query.js/chat.mjs call (executeTool('get_watchlist_quotes', ...)
// in finance-tools.mjs) via dynamic import — no Finnhub-calling logic
// duplicated here, just a thin authenticated wrapper.
//
// Adding/removing tickers doesn't need a backend endpoint at all — the
// dashboard writes appData.stockWatchlist directly via the existing
// saveData() client-side flow, same as goals/notes/etc.
const admin = require('firebase-admin');

if (!process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
  try {
    const fs = require('fs'), path = require('path');
    fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^#=\s]+)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
  } catch {}
}

const USER_UID = 'aqzJe5gq4IVYdKmUIW0pNJGL2ML2';

function initFirebase() {
  if (admin.apps.length > 0) return;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_B64
    ? JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString())
    : require('./service-account.json');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

function parseBearerToken(authHeaderValue) {
  const m = /^Bearer (.+)$/.exec(authHeaderValue || '');
  return m ? m[1] : null;
}

async function verifyAuth(event) {
  const token = parseBearerToken(event.headers?.authorization || event.headers?.Authorization);
  if (!token) return null;
  try {
    initFirebase();
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded.uid === USER_UID ? decoded : null;
  } catch {
    return null;
  }
}

let executeToolPromise;
function getExecuteTool() {
  if (!executeToolPromise) {
    // If the import ever rejects (transient cold-start hiccup), don't cache
    // the rejection forever — a warm container would otherwise 500 on every
    // request from then on, since a settled-rejected promise is still
    // truthy and skips the `if (!executeToolPromise)` re-fetch.
    executeToolPromise = import('./finance-tools.mjs').then(m => m.executeTool)
      .catch(e => { executeToolPromise = null; throw e; });
  }
  return executeToolPromise;
}

exports.handler = async (event) => {
  if (!(await verifyAuth(event))) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  if (event.httpMethod && event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    initFirebase();
    const db = admin.firestore();
    // Field-masked read — get_watchlist_quotes only needs stockWatchlist,
    // not the rest of appData (transactions, budgets, goals, ...), so don't
    // pay for reading/transferring the whole document on every refresh.
    const [snap] = await db.getAll(db.doc(`users/${USER_UID}/data/main`), { fieldMask: ['stockWatchlist'] });
    const appData = snap.exists ? snap.data() : {};
    const executeTool = await getExecuteTool();
    const result = await executeTool('get_watchlist_quotes', {}, appData);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (e) {
    console.error('watchlist-quotes error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
