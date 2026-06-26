const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const admin = require('firebase-admin');

function getFirebase() {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin;
}

function mapCategory(plaidCategories) {
  if (!plaidCategories || !plaidCategories.length) return 'Other';
  const joined = plaidCategories.join(' ').toLowerCase();
  if (/food|restaurant|groceries|dining|coffee/.test(joined)) return 'Food';
  if (/travel|transport|taxi|uber|lyft|gas station|parking|airlines/.test(joined)) return 'Transport';
  if (/medical|health|fitness|gym|sport|dental|pharmacy/.test(joined)) return 'Health & Fitness';
  if (/entertainment|recreation|arts|music|movies|video games/.test(joined)) return 'Entertainment';
  if (/shops|shopping|retail|clothing|department/.test(joined)) return 'Shopping';
  if (/transfer|savings|investment|deposit/.test(joined)) return 'Savings';
  if (/rent|mortgage|utilities|housing/.test(joined)) return 'Housing';
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
      category: mapCategory(t.category),
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
