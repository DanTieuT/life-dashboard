// Plaid API helper — plain REST, no SDK. Requires env vars:
//   PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV (sandbox | production; default sandbox)
// Access tokens are stored server-side in Firestore (users/{uid}/plaidItems/*),
// never in appData where the client could read them.

if (!process.env.PLAID_CLIENT_ID) {
  try {
    const fs = require('fs'), path = require('path');
    fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^#=\s]+)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
  } catch {}
}

function configured() {
  return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

function baseUrl() {
  const env = (process.env.PLAID_ENV || 'sandbox').toLowerCase();
  return `https://${env === 'production' ? 'production' : 'sandbox'}.plaid.com`;
}

async function call(path, body = {}) {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      ...body,
    }),
  });
  const json = await res.json();
  if (!res.ok || json.error_code) {
    throw new Error(`Plaid ${path}: ${json.error_code || res.status} ${json.error_message || ''}`);
  }
  return json;
}

function titleCase(s) {
  return (s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
// "CHASE COLLEGE" + inst "Chase" → "Chase College" (no double Chase);
// "CREDIT CARD" + "Chase" → "Chase Credit Card".
function cleanAccountName(institution, rawName) {
  const nm = titleCase(rawName).replace(/\b(\w+)\s+\1\b/gi, '$1'); // collapse dup words
  const inst = titleCase(institution || '');
  if (!inst) return nm;
  if (nm.toLowerCase().startsWith(inst.toLowerCase())) return nm;
  return `${inst} ${nm}`;
}

// Plaid account type/subtype → dashboard account type
function mapAccountType(type, subtype) {
  if (type === 'depository') return subtype === 'savings' ? 'savings' : 'checking';
  if (type === 'investment' || type === 'brokerage') return 'investment';
  if (type === 'credit' || type === 'loan') return 'debt';
  return 'checking';
}

// Plaid personal_finance_category.primary → dashboard budget category.
// Returns null for categories we deliberately skip (transfers between accounts).
function mapTxnCategory(primary) {
  const M = {
    INCOME: 'Other',
    FOOD_AND_DRINK: 'Food',
    TRANSPORTATION: 'Transport',
    TRAVEL: 'Transport',
    RENT_AND_UTILITIES: 'Housing',
    HOME_IMPROVEMENT: 'Housing',
    MEDICAL: 'Health & Fitness',
    PERSONAL_CARE: 'Health & Fitness',
    ENTERTAINMENT: 'Entertainment',
    GENERAL_MERCHANDISE: 'Shopping',
    GENERAL_SERVICES: 'Other',
    LOAN_PAYMENTS: 'Other',
    BANK_FEES: 'Other',
    GOVERNMENT_AND_NON_PROFIT: 'Other',
  };
  // Excluded primaries — internal money movement, not real income/spending:
  //  TRANSFER_IN/OUT  = account transfers, Venmo/Zelle, ATM, investment moves
  //  LOAN_DISBURSEMENTS = the credit given to a card when you pay it ("Payment
  //                       Thank You"); the checking side is caught by the
  //                       LOAN_PAYMENTS_CREDIT_CARD_PAYMENT detail in mapTransaction
  if (primary === 'TRANSFER_IN' || primary === 'TRANSFER_OUT' || primary === 'LOAN_DISBURSEMENTS') return null;
  return M[primary] || 'Other';
}

// Detailed categories that are internal money movement, not real income or
// spending — a credit-card payment (checking → your own card) shows up as an
// inflow on the card and an outflow on checking; counting either would distort
// income/spending. Also skip explicit account-to-account transfers.
const INTERNAL_DETAILED = new Set([
  'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
  'TRANSFER_OUT_ACCOUNT_TRANSFER',
  'TRANSFER_IN_ACCOUNT_TRANSFER',
]);

// Venmo/Cash App/Zelle/PayPal cashouts land in Plaid tagged as some flavor
// of transfer — most often TRANSFER_IN_ACCOUNT_TRANSFER (Plaid's heuristic
// treats the P2P app like "your own linked account" moving money back,
// same bucket as a transfer between two of Dan's own tracked bank
// accounts), but not reliably always that exact tag. Matched by name
// instead of any specific Plaid category so it wins regardless of which
// transfer-shaped tag Plaid picks — this app never tracks a Venmo/Cash
// App/Zelle/PayPal balance, so a cashout landing in checking is genuinely
// new income, not a double-count, no matter how Plaid categorized it.
const P2P_CASHOUT_RE = /venmo|cash app|cashapp|zelle|paypal/i;

// Accounts that only ever receive Dan's own money moving in from an account
// he already tracks (never a primary income-receiving account). Plaid can't
// always tell a cross-institution transfer (e.g. Chase → Wealthfront) is
// internal the way it can within one bank, so it sometimes tags the
// receiving leg as a genuine TRANSFER_IN_DEPOSIT — this is the backstop.
// Matched by name for accounts (like Wealthfront) that aren't typed as
// investment but still function as one; every `investment`-type account
// (Schwab, Robinhood, any future one) is covered by type below instead,
// since money landing there is Dan choosing to invest, never new income,
// regardless of which institution it came from.
const TRANSFER_DESTINATION_RE = /wealthfront/i;

// Plaid transaction → dashboard transaction (or null to skip).
// Plaid convention: positive amount = money leaving the account.
// `acct` is the local (already-linked) account this transaction posted to —
// see plaid-sync.js, which looks it up by pt.account_id before calling this.
function mapTransaction(pt, acct) {
  // Pending transactions are kept (tagged `pending`) so they show up right
  // away. Plaid gives the posted version a *new* transaction_id and lists the
  // old pending id in res.removed, so plaid-sync.js reconciles the two via
  // `pendingPlaidTxnId` (pt.pending_transaction_id) to avoid showing both.
  const pfc = pt.personal_finance_category || {};
  const name = pt.merchant_name || pt.name || '';
  // Money arriving in a pure transfer-destination account is never new
  // income, regardless of how Plaid categorized it — it's Dan's own money
  // that already counted as income (or already excluded) on the sending
  // side. Checked before everything else below.
  const isTransferDestination = acct && (acct.type === 'investment' || TRANSFER_DESTINATION_RE.test(acct.name || ''));
  if (pt.amount < 0 && isTransferDestination) return null;
  const isP2pCashIn = pt.amount < 0 && P2P_CASHOUT_RE.test(name);
  if (!isP2pCashIn && INTERNAL_DETAILED.has(pfc.detailed)) return null; // credit-card payments / internal transfers
  // TRANSFER_OUT_SAVINGS is Plaid's specific tag for a transfer landing in a
  // savings account — unlike generic account transfers (excluded above) or
  // investment/retirement transfers (caught by the goal auto-match in
  // plaid-sync.js instead), this is money you're intentionally setting aside
  // as part of your budget, so it counts as real spend under 'Savings'.
  //
  // TRANSFER_IN_DEPOSIT is the mirror case on the income side — an actual
  // cash/check/external deposit landing in the account, as opposed to
  // TRANSFER_IN_SAVINGS / TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS /
  // TRANSFER_IN_ACCOUNT_TRANSFER, which are just your own money moving back
  // from another account you already own and would double-count as "new"
  // income if included. Only DEPOSIT is genuinely new money in — except a
  // P2P cashout (isP2pCashIn above), which is also genuinely new.
  const category = isP2pCashIn ? 'Other'
    : pfc.detailed === 'TRANSFER_OUT_SAVINGS' ? 'Savings'
    : pfc.detailed === 'TRANSFER_IN_DEPOSIT' ? 'Other'
    : mapTxnCategory(pfc.primary);
  if (!category) return null; // transfers between accounts — skip
  return {
    plaidTxnId: pt.transaction_id,
    plaidAccountId: pt.account_id,
    name: pt.merchant_name || pt.name || 'Transaction',
    amount: Math.abs(pt.amount),
    type: pt.amount > 0 ? 'out' : 'in',
    category,
    date: pt.date, // already YYYY-MM-DD
    source: 'plaid',
    pending: !!pt.pending,
    pendingPlaidTxnId: pt.pending_transaction_id || null,
  };
}

// OAuth institutions (Schwab, Robinhood, etc.) redirect the browser away to
// authenticate, then back here — Plaid requires this exact URI pre-registered
// in the dashboard (Team Settings > API > Allowed redirect URIs), and it must
// be a bare page with no query string/hash. See plaid-oauth-redirect.html.
const REDIRECT_URI = 'https://dn2dashboard.netlify.app/plaid-oauth-redirect.html';

// Where Plaid POSTs webhooks (SYNC_UPDATES_AVAILABLE etc.). New Items pick
// this up from the link token; existing Items get it via /item/webhook/update
// (see plaid-link.js?action=set_webhooks). Handler: plaid-webhook.js.
const WEBHOOK_URL = 'https://dn2dashboard.netlify.app/.netlify/functions/plaid-webhook';

const crypto = require('crypto');
const b64urlToBuf = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// Verify a Plaid webhook — https://plaid.com/docs/api/webhooks/webhook-verification/
// True iff the Plaid-Verification JWT is validly ES256-signed by Plaid's
// current key, issued within the last 5 min (replay guard), and commits to
// exactly the request body we received. `call` is defined above.
const _webhookKeyCache = new Map(); // kid -> JWK
async function verifyWebhook(jwtHeaderValue, rawBody) {
  try {
    const [h, p, sig] = String(jwtHeaderValue || '').split('.');
    if (!h || !p || !sig) return false;
    const header = JSON.parse(b64urlToBuf(h).toString());
    if (header.alg !== 'ES256' || !header.kid) return false;

    let jwk = _webhookKeyCache.get(header.kid);
    if (!jwk) {
      const { key } = await call('/webhook_verification_key/get', { key_id: header.kid });
      if (!key || key.expired_at) return false;
      jwk = { kty: key.kty, crv: key.crv, x: key.x, y: key.y };
      _webhookKeyCache.set(header.kid, jwk);
    }

    const pubKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const sigOk = crypto.verify(
      'sha256', Buffer.from(`${h}.${p}`),
      { key: pubKey, dsaEncoding: 'ieee-p1363' }, b64urlToBuf(sig),
    );
    if (!sigOk) return false;

    const claims = JSON.parse(b64urlToBuf(p).toString());
    if (!claims.iat || Date.now() / 1000 - claims.iat > 300) return false;
    const bodyHash = crypto.createHash('sha256').update(rawBody || '', 'utf8').digest('hex');
    return typeof claims.request_body_sha256 === 'string'
      && claims.request_body_sha256.length === bodyHash.length
      && crypto.timingSafeEqual(Buffer.from(bodyHash), Buffer.from(claims.request_body_sha256));
  } catch (e) {
    console.error('[plaid] webhook verification error:', e.message);
    return false;
  }
}

module.exports = {
  configured,
  createLinkToken: (userId) => call('/link/token/create', {
    client_name: 'Command Center',
    user: { client_user_id: userId },
    products: ['transactions'],
    country_codes: ['US'],
    language: 'en',
    redirect_uri: REDIRECT_URI,
    webhook: WEBHOOK_URL,
  }),
  // Adds a product to an ALREADY-linked Item (e.g. Investments, after the
  // original Link only requested Transactions) — Plaid's "update mode":
  // pass the existing access_token + additional_consented_products, and
  // omit `products` entirely (Plaid rejects both being set together for a
  // non-credit product like Investments). The user still has to complete
  // Link again for that Item so the brokerage can grant the extra consent —
  // the access_token itself doesn't change.
  createUpdateLinkToken: (userId, accessToken, additionalProducts) => call('/link/token/create', {
    client_name: 'Command Center',
    user: { client_user_id: userId },
    access_token: accessToken,
    additional_consented_products: additionalProducts,
    country_codes: ['US'],
    language: 'en',
    redirect_uri: REDIRECT_URI,
  }),
  // Holdings only (not the separate, billed Investments Transactions data —
  // deliberately not called anywhere in this app).
  getInvestmentHoldings: (accessToken) => call('/investments/holdings/get', { access_token: accessToken }),
  exchangePublicToken: (publicToken) => call('/item/public_token/exchange', { public_token: publicToken }),
  // Fully revokes the bank connection on Plaid's side. Call this once no
  // local accounts reference the item anymore — otherwise the connection
  // (and Plaid's per-item billing) lingers even after removing accounts locally.
  removeItem: (accessToken) => call('/item/remove', { access_token: accessToken }),
  // /accounts/get returns balances included with the Transactions product —
  // avoids needing the separate (and billed-per-call) real-time Balance product.
  // Plaid keeps this cache fresh on its own (~daily) for Transactions-enabled
  // Items, so a stale number here is more likely the current/available
  // fallback below picking the wrong field than a caching-frequency problem.
  getBalances: (accessToken) => call('/accounts/get', { access_token: accessToken }),
  transactionsSync: (accessToken, cursor) => call('/transactions/sync', { access_token: accessToken, cursor: cursor || undefined, count: 200 }),
  // Point an already-linked Item at our webhook URL (new Items get it from
  // the link token instead).
  updateItemWebhook: (accessToken, webhook = WEBHOOK_URL) => call('/item/webhook/update', { access_token: accessToken, webhook }),
  verifyWebhook,
  WEBHOOK_URL,
  mapAccountType,
  cleanAccountName,
  mapTxnCategory,
  mapTransaction,
};
