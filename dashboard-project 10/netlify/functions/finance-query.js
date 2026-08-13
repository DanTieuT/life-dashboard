// finance-query.js — full finance toolkit for the ChatGPT bridge.
// POST { "tool": "get_investment_holdings", "args": {} } — runs the exact
// same finance-tools.mjs executeTool() dashboard chat's tool-calling loop
// already uses (chat.mjs), just reached via one generic endpoint instead of
// Anthropic's native tools mechanism, since Custom GPT Actions are already
// their own tool-calling layer — no need to duplicate that plumbing, just
// give it a door to the same tools.
//
// This is what "chat getting access to my full finance toolkit" (shares
// owned, cost basis, subscriptions, liabilities, net worth history,
// anomalies — not just the lightweight investmentsSummary in
// getDashboardContext) actually means — see CHATGPT_BRIDGE.md.
const admin = require('firebase-admin');

// Fallback: load .env directly when netlify dev skips long-value vars
if (!process.env.GPT_BRIDGE_KEY) {
  try {
    const fs = require('fs'), path = require('path');
    fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^#=\s]+)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
  } catch {}
}

function initFirebase() {
  if (admin.apps.length > 0) return;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_B64
    ? JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString())
    : require('./service-account.json');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

// finance-tools.mjs is ESM; this file is CommonJS (matches every other
// function here except chat.mjs itself) — dynamic import() is the bridge,
// cached so it only loads once per warm container.
let executeToolPromise;
function getExecuteTool() {
  if (!executeToolPromise) executeToolPromise = import('./finance-tools.mjs').then(m => m.executeTool);
  return executeToolPromise;
}

exports.handler = async (event) => {
  const key = event.queryStringParameters?.key || event.headers?.['x-gpt-key'];
  if (key !== process.env.GPT_BRIDGE_KEY || !process.env.GPT_BRIDGE_KEY) {
    return { statusCode: 401, body: 'Unauthorized' };
  }
  if (event.httpMethod && event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { tool, args } = body;
  if (!tool) return { statusCode: 400, body: JSON.stringify({ error: 'tool required' }) };

  try {
    initFirebase();
    const db = admin.firestore();
    const snap = await db.doc('users/aqzJe5gq4IVYdKmUIW0pNJGL2ML2/data/main').get();
    const appData = snap.exists ? snap.data() : {};
    const executeTool = await getExecuteTool();
    const result = await executeTool(tool, args || {}, appData);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (e) {
    console.error('finance-query error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
