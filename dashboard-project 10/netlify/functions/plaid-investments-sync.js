// Plaid Investments holdings sync — scheduled daily (see netlify.toml). Only
// acts on Items with investmentsEnabled:true (see plaid-link.js's
// investments_enabled action) — most linked banks won't have this and are
// skipped entirely, same as plaid-sync.js skips non-investment products.
//
// Deliberately calls /investments/holdings/get only, never
// /investments/transactions/get — that's a separate, separately-billed Plaid
// product Dan chose not to enable (holdings-only: $0.18/item/month vs
// +$0.35/item/month for transaction history he didn't ask for).
//
// Holdings are replaced wholesale each run, not diffed/merged like
// plaid-sync.js's transactions — this is current-state data (what do you own
// right now), not an append-only log, so "replace with latest" is simpler
// and more correct than trying to reconcile deltas. A failed item's holdings
// are dropped rather than left stale/wrong; they come back on the next
// successful sync.
// Manual trigger: /plaid-investments-sync?trigger=manual
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

exports.handler = async () => {
  if (!plaid.configured()) {
    console.log('[plaid-investments-sync] not configured — skipping');
    return { statusCode: 200, body: 'Plaid not configured' };
  }
  try {
    initFirebase();
    const db = admin.firestore();
    const itemsSnap = await db.collection(`users/${USER_UID}/plaidItems`).get();
    const investmentItems = itemsSnap.docs.filter(d => d.data().investmentsEnabled);
    if (!investmentItems.length) return { statusCode: 200, body: 'No Investments-enabled items' };

    const ref = db.doc(`users/${USER_UID}/data/main`);
    const holdings = [];
    let itemsSynced = 0;

    for (const itemDoc of investmentItems) {
      const item = itemDoc.data();
      try {
        const res = await plaid.getInvestmentHoldings(item.accessToken);
        const securityById = new Map((res.securities || []).map(s => [s.security_id, s]));
        const accountById = new Map((res.accounts || []).map(a => [a.account_id, a]));
        for (const h of (res.holdings || [])) {
          const sec = securityById.get(h.security_id) || {};
          const acct = accountById.get(h.account_id) || {};
          holdings.push({
            id: uidGen(),
            itemId: itemDoc.id,
            institution: item.institution || '',
            plaidAccountId: h.account_id,
            accountName: acct.name || '',
            securityId: h.security_id,
            ticker: sec.ticker_symbol || null,
            name: sec.name || 'Unknown security',
            securityType: sec.type || 'other',
            quantity: h.quantity,
            costBasis: h.cost_basis != null ? h.cost_basis : null,
            currentPrice: h.institution_price,
            currentValue: h.institution_value,
            currency: h.iso_currency_code || h.unofficial_currency_code || 'USD',
          });
        }
        itemsSynced++;
      } catch (e) {
        console.error(`[plaid-investments-sync] item ${itemDoc.id} failed:`, e.message);
      }
    }

    await ref.update({ investmentHoldings: holdings, investmentHoldingsSyncedAt: Date.now() });
    const summary = `Synced ${itemsSynced}/${investmentItems.length} items, ${holdings.length} holdings`;
    console.log('[plaid-investments-sync]', summary);
    return { statusCode: 200, body: summary };
  } catch (e) {
    console.error('Plaid investments sync error:', e);
    return { statusCode: 500, body: e.message };
  }
};
