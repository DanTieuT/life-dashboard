const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, body: '' };

  const { userId } = JSON.parse(event.body || '{}');

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
    const response = await client.linkTokenCreate({
      user: { client_user_id: userId || 'user-' + Date.now() },
      client_name: 'My Life Dashboard',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link_token: response.data.link_token }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
