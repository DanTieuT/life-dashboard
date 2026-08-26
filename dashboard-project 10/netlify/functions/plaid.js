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

// Venmo/Cash App/Zelle/PayPal cashouts land in Plaid as
// TRANSFER_IN_ACCOUNT_TRANSFER — Plaid's heuristic treats the P2P app like
// "your own linked account" moving money back, same bucket as a transfer
// between two of your own tracked bank accounts. But this app never tracks
// a Venmo/Cash App/Zelle balance, so a cashout is the first time this money
// is seen here — it's genuinely new income, not a double-count.
const P2P_CASHOUT_RE = /venmo|cash app|cashapp|zelle|paypal/i;

// Plaid transaction → dashboard transaction (or null to skip).
// Plaid convention: positive amount = money leaving the account.
function mapTransaction(pt) {
  if (pt.pending) return null;
  const pfc = pt.personal_finance_category || {};
  const name = pt.merchant_name || pt.name || '';
  const isP2pCashIn = pt.amount < 0 && pfc.detailed === 'TRANSFER_IN_ACCOUNT_TRANSFER' && P2P_CASHOUT_RE.test(name);
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
  };
}

// OAuth institutions (Schwab, Robinhood, etc.) redirect the browser away to
// authenticate, then back here — Plaid requires this exact URI pre-registered
// in the dashboard (Team Settings > API > Allowed redirect URIs), and it must
// be a bare page with no query string/hash. See plaid-oauth-redirect.html.
const REDIRECT_URI = 'https://dn2dashboard.netlify.app/plaid-oauth-redirect.html';

module.exports = {
  configured,
  createLinkToken: (userId) => call('/link/token/create', {
    client_name: 'Command Center',
    user: { client_user_id: userId },
    products: ['transactions'],
    country_codes: ['US'],
    language: 'en',
    redirect_uri: REDIRECT_URI,
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
  mapAccountType,
  cleanAccountName,
  mapTxnCategory,
  mapTransaction,
};
