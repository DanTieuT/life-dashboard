// Plaid Link endpoints for the dashboard client:
//   GET  /plaid-link?action=link_token  → { link_token } for opening Plaid Link
//   POST /plaid-link?action=exchange    → body {public_token, institution}
//     exchanges for an access_token (stored server-side in Firestore),
//     pulls the item's accounts, and upserts them into appData.accounts.
//   POST /plaid-link?action=unlink      → body {accountId}
//     removes that one account. If it was the last account on its Plaid
//     item, also revokes the item on Plaid's side and deletes the stored
//     access token, so a dead connection doesn't linger or keep billing.
// No-ops with a clear error until PLAID_CLIENT_ID / PLAID_SECRET are set.
const admin = require('firebase-admin');
const plaid = require('./plaid.js');

const USER_UID = 'aqzJe5gq4IVYdKmUIW0pNJGL2ML2';

function initFirebase() {
  if (admin.apps.length > 0) return;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_B64
    ? JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString())
    : require('./service-account.json');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

const uidGen = () => Date.now().toString(36) + Math.random().toString(36).slice(2);
const json = (code, body) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (!plaid.configured()) {
    return json(200, { error: 'Plaid not configured — set PLAID_CLIENT_ID and PLAID_SECRET' });
  }
  const action = event.queryStringParameters?.action || '';

  try {
    if (action === 'link_token') {
      const res = await plaid.createLinkToken(USER_UID);
      return json(200, { link_token: res.link_token });
    }

    if (action === 'exchange' && event.httpMethod === 'POST') {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
      if (!body.public_token) return json(400, { error: 'public_token required' });

      const ex = await plaid.exchangePublicToken(body.public_token);
      initFirebase();
      const db = admin.firestore();

      // Store the access token server-side only
      await db.doc(`users/${USER_UID}/plaidItems/${ex.item_id}`).set({
        accessToken: ex.access_token,
        institution: body.institution || '',
        cursor: '',
        createdAt: Date.now(),
      });

      // Pull accounts and upsert into appData.accounts
      const bal = await plaid.getBalances(ex.access_token);
      const ref = db.doc(`users/${USER_UID}/data/main`);
      const snap = await ref.get();
      const data = snap.exists ? snap.data() : {};
      const accounts = data.accounts || [];
      const added = [];
      for (const a of bal.accounts) {
        const existing = accounts.find(x => x.plaidAccountId === a.account_id);
        const balance = a.balances.current ?? a.balances.available ?? 0;
        // App convention: debt balances stored POSITIVE (what you owe);
        // display adds the minus and net-worth math subtracts liabilities.
        const type = plaid.mapAccountType(a.type, a.subtype);
        const stored = type === 'debt' ? Math.abs(balance) : balance;
        if (existing) {
          existing.balance = stored;
          existing.updatedAt = Date.now();
        } else {
          accounts.push({
            id: uidGen(),
            name: plaid.cleanAccountName(body.institution, a.name),
            mask: a.mask || '',
            type,
            balance: stored,
            plaidAccountId: a.account_id,
            plaidItemId: ex.item_id,
            source: 'plaid',
            updatedAt: Date.now(),
          });
          added.push(a.name);
        }
      }
      await ref.update({ accounts });
      return json(200, { ok: true, added, total: bal.accounts.length });
    }

    if (action === 'unlink' && event.httpMethod === 'POST') {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
      if (!body.accountId) return json(400, { error: 'accountId required' });

      initFirebase();
      const db = admin.firestore();
      const ref = db.doc(`users/${USER_UID}/data/main`);
      const snap = await ref.get();
      const data = snap.exists ? snap.data() : {};
      const accounts = data.accounts || [];

      const target = accounts.find(a => a.id === body.accountId);
      if (!target) return json(404, { error: 'Account not found' });

      const remaining = accounts.filter(a => a.id !== body.accountId);
      await ref.update({ accounts: remaining });

      let itemRemoved = false;
      if (target.plaidItemId) {
        const stillUsed = remaining.some(a => a.plaidItemId === target.plaidItemId);
        if (!stillUsed) {
          const itemRef = db.doc(`users/${USER_UID}/plaidItems/${target.plaidItemId}`);
          const itemSnap = await itemRef.get();
          if (itemSnap.exists) {
            try { await plaid.removeItem(itemSnap.data().accessToken); }
            catch (e) { console.error('Plaid item/remove failed (continuing to delete local record):', e.message); }
            await itemRef.delete();
            itemRemoved = true;
          }
        }
      }
      return json(200, { ok: true, itemRemoved });
    }

    return json(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('Plaid link error:', e);
    return json(500, { error: e.message });
  }
};
