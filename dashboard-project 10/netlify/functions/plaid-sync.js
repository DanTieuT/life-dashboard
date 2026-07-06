// Plaid sync — scheduled every 6h (see netlify.toml). For each linked item:
// refreshes account balances and pulls new transactions via /transactions/sync
// (cursor-based, so each run only sees what changed). New transactions are
// mapped into appData.transactions (deduped by plaidTxnId, transfers and
// pending excluded, initial backfill capped at 30 days). No-ops until
// PLAID_CLIENT_ID / PLAID_SECRET are configured or no banks are linked.
// Manual trigger: /plaid-sync?trigger=manual
const admin = require('firebase-admin');
const plaid = require('./plaid.js');

const USER_UID = 'aqzJe5gq4IVYdKmUIW0pNJGL2ML2';
const BACKFILL_DAYS = 30;

function initFirebase() {
  if (admin.apps.length > 0) return;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_B64
    ? JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString())
    : require('./service-account.json');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

const uidGen = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

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

    const ref = db.doc(`users/${USER_UID}/data/main`);
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};
    const accounts = data.accounts || [];
    const transactions = data.transactions || [];
    const knownTxnIds = new Set(transactions.map(t => t.plaidTxnId).filter(Boolean));

    const cutoffDate = new Date(Date.now() - BACKFILL_DAYS * 86400000)
      .toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

    let balancesUpdated = 0, txnsAdded = 0, txnsRemoved = 0;

    for (const itemDoc of itemsSnap.docs) {
      const item = itemDoc.data();
      try {
        // ── Balances ──────────────────────────────────────────────
        const bal = await plaid.getBalances(item.accessToken);
        for (const a of bal.accounts) {
          const acct = accounts.find(x => x.plaidAccountId === a.account_id);
          if (!acct) continue;
          const balance = a.balances.current ?? a.balances.available ?? 0;
          // App convention: debt balances stored positive (see plaid-link.js)
          acct.balance = acct.type === 'debt' ? Math.abs(balance) : balance;
          acct.updatedAt = Date.now();
          balancesUpdated++;
        }

        // ── Transactions (cursor sync) ────────────────────────────
        let cursor = item.cursor || '';
        let hasMore = true;
        let guard = 0;
        while (hasMore && guard++ < 20) {
          const res = await plaid.transactionsSync(item.accessToken, cursor);
          for (const pt of res.added) {
            const t = plaid.mapTransaction(pt);
            if (!t || knownTxnIds.has(t.plaidTxnId)) continue;
            if (t.date < cutoffDate) continue; // cap initial backfill
            knownTxnIds.add(t.plaidTxnId);
            transactions.unshift({ id: uidGen(), ...t });
            txnsAdded++;
          }
          for (const pt of res.modified) {
            const t = plaid.mapTransaction(pt);
            const existing = transactions.find(x => x.plaidTxnId === pt.transaction_id);
            if (existing && t) Object.assign(existing, { name: t.name, amount: t.amount, type: t.type, category: t.category, date: t.date });
          }
          for (const r of res.removed) {
            const idx = transactions.findIndex(x => x.plaidTxnId === r.transaction_id);
            if (idx > -1) { transactions.splice(idx, 1); txnsRemoved++; }
          }
          cursor = res.next_cursor;
          hasMore = res.has_more;
        }
        if (cursor !== item.cursor) await itemDoc.ref.update({ cursor, lastSync: Date.now() });
      } catch (e) {
        console.error(`[plaid-sync] item ${itemDoc.id} failed:`, e.message);
      }
    }

    await ref.update({ accounts, transactions });
    const summary = `Balances: ${balancesUpdated}, +${txnsAdded} txns, -${txnsRemoved}`;
    console.log('[plaid-sync]', summary);
    return { statusCode: 200, body: summary };
  } catch (e) {
    console.error('Plaid sync error:', e);
    return { statusCode: 500, body: e.message };
  }
};
