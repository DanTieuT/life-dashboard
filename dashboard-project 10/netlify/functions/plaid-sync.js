// Plaid sync — scheduled hourly (see netlify.toml). Refreshes balances and
// pulls transaction changes for every linked item. The actual sync engine
// lives in plaid-sync-core.js and is shared with plaid-webhook.js, which runs
// the same logic for a single item the moment Plaid says it has new data.
// No-ops until PLAID_CLIENT_ID / PLAID_SECRET are configured or no banks are
// linked. Manual trigger: /plaid-sync?trigger=manual
const admin = require('firebase-admin');
const plaid = require('./plaid.js');
const { initFirebase, syncItems, USER_UID } = require('./plaid-sync-core.js');

exports.handler = async () => {
  if (!plaid.configured()) {
    console.log('[plaid-sync] not configured — skipping');
    return { statusCode: 200, body: 'Plaid not configured' };
  }
  try {
    initFirebase();
    const db = admin.firestore();
    const itemsSnap = await db.collection(`users/${USER_UID}/plaidItems`).get();
    if (itemsSnap.empty) return { statusCode: 200, body: 'No linked banks' };

    const { summary } = await syncItems(db, itemsSnap.docs);
    console.log('[plaid-sync]', summary);
    return { statusCode: 200, body: summary };
  } catch (e) {
    console.error('Plaid sync error:', e);
    return { statusCode: 500, body: e.message };
  }
};
