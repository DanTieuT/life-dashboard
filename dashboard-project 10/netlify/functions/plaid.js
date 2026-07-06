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
  if (primary === 'TRANSFER_IN' || primary === 'TRANSFER_OUT') return null;
  return M[primary] || 'Other';
}

// Plaid transaction → dashboard transaction (or null to skip).
// Plaid convention: positive amount = money leaving the account.
function mapTransaction(pt) {
  if (pt.pending) return null;
  const category = mapTxnCategory(pt.personal_finance_category?.primary);
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

module.exports = {
  configured,
  createLinkToken: (userId) => call('/link/token/create', {
    client_name: 'Command Center',
    user: { client_user_id: userId },
    products: ['transactions'],
    country_codes: ['US'],
    language: 'en',
  }),
  exchangePublicToken: (publicToken) => call('/item/public_token/exchange', { public_token: publicToken }),
  // /accounts/get returns balances included with the Transactions product —
  // avoids needing the separate (and unnecessary here) real-time Balance product.
  getBalances: (accessToken) => call('/accounts/get', { access_token: accessToken }),
  transactionsSync: (accessToken, cursor) => call('/transactions/sync', { access_token: accessToken, cursor: cursor || undefined, count: 200 }),
  mapAccountType,
  mapTxnCategory,
  mapTransaction,
};
