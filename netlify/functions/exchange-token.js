const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const admin = require('firebase-admin');

function getFirebase() {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, body: '' };

  const { publicToken, idToken } = JSON.parse(event.body || '{}');
  if (!publicToken || !idToken) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing publicToken or idToken' }) };
  }

  const firebase = getFirebase();

  let uid;
  try {
    const decoded = await firebase.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch (err) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid idToken' }) };
  }

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

  try {
    const response = await client.itemPublicTokenExchange({ public_token: publicToken });
    const accessToken = response.data.access_token;

    const db = firebase.firestore();
    await db.collection('plaid_tokens').doc(uid).set({
      access_token: accessToken,
      updated: new Date().toISOString(),
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
