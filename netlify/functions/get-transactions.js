const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const admin = require('firebase-admin');

function getFirebase() {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin;
}

const CATEGORY_MAP = [
  ['Food',             ['Food and Drink', 'Restaurants', 'Coffee Shop', 'Fast Food', 'Groceries', 'Supermarkets']],
  ['Transport',        ['Travel', 'Taxi', 'Uber', 'Lyft', 'Gas Stations', 'Airlines', 'Public Transportation', 'Parking']],
  ['Health & Fitness', ['Gyms and Fitness Centers', 'Pharmacies', 'Medical']],
  ['Entertainment',    ['Recreation', 'Arts and Entertainment', 'Music', 'Movies']],
  ['Shopping',         ['Shops', 'Clothing', 'Department Stores', 'Electronics']],
  ['Savings',          ['Transfer', 'Savings', 'Investment']],
  ['Housing',          ['Rent', 'Mortgage', 'Utilities']],
];

const MERCHANT_MAP = [
  ['Food',             ['mcdonald', 'starbucks', 'chipotle', 'subway', 'pizza', 'burger', 'taco', 'wendy', 'kfc', 'chick-fil', 'dunkin', 'panera', 'domino']],
  ['Transport',        ['uber', 'lyft', 'shell', 'chevron', 'bp', 'exxon', 'mobil', 'sunoco', 'delta', 'american airlines', 'united', 'southwest']],
  ['Health & Fitness', ['gym', 'planet fitness', 'crossfit', 'equinox', 'peloton', 'cvs', 'walgreen', 'pharmacy']],
  ['Entertainment',    ['netflix', 'spotify', 'hulu', 'disney', 'youtube', 'apple music', 'ticketmaster', 'amc']],
  ['Shopping',         ['amazon', 'walmart', 'target', 'best buy', 'apple store', 'ikea', 'costco', 'home depot']],
];

function matchKeywords(text, map) {
  const t = text.toLowerCase();
  for (const [label, keywords] of map) {
    for (const kw of keywords) {
      if (t.includes(kw)) return label;
    }
  }
  return null;
}

function mapCategory(plaidCategories, personalFinanceCategory, merchantName) {
  // 1. Try standard category array (cats[0] and cats[1])
  if (plaidCategories && plaidCategories.length) {
    const primary = plaidCategories[0] || '';
    const sub = plaidCategories[1] || '';
    const result = matchKeywords(primary + ' ' + sub, CATEGORY_MAP);
    if (result) return result;
  }

  // 2. Try personal_finance_category (newer Plaid API field)
  if (personalFinanceCategory) {
    const pfc = (personalFinanceCategory.primary || '') + ' ' + (personalFinanceCategory.detailed || '');
    const result = matchKeywords(pfc, CATEGORY_MAP);
    if (result) return result;
  }

  // 3. Merchant name fallback
  if (merchantName) {
    const result = matchKeywords(merchantName, MERCHANT_MAP);
    if (result) return result;
  }

  return 'Other';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, body: '' };

  const { idToken, days = 30 } = JSON.parse(event.body || '{}');
  if (!idToken) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing idToken' }) };
  }

  const firebase = getFirebase();

  let uid;
  try {
    const decoded = await firebase.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch (err) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid idToken' }) };
  }

  const db = firebase.firestore();
  const tokenDoc = await db.collection('plaid_tokens').doc(uid).get();
  if (!tokenDoc.exists) {
    return { statusCode: 404, body: JSON.stringify({ error: 'No bank connected' }) };
  }

  const accessToken = tokenDoc.data().access_token;

  const config = new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  });

  const client = new PlaidApi(config);

  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    const response = await client.transactionsGet({
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
    });

    const transactions = response.data.transactions.map(t => ({
      id: 'plaid_' + t.transaction_id,
      name: t.name,
      amount: Math.abs(t.amount),
      category: mapCategory(t.category, t.personal_finance_category, t.merchant_name || t.name),
      type: t.amount > 0 ? 'out' : 'in',
      date: t.date,
      fromPlaid: true,
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
