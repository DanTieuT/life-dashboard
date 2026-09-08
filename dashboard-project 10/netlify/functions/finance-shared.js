// Shared pure helpers for the money model — no dependencies, no I/O.
// Imported by dashboard-lib.js (CJS), morning-briefing.js (CJS) and
// finance-tools.mjs (ESM). The browser has its own copy of this exact logic
// in js/core.js (can't share it — different runtime); keep the two in sync.
//
// See AI_ASSISTANT.md / the "Dashboard spending model" notes for the why:
// Savings transfers and refunds/reimbursements are not discretionary spend,
// and money-in is classified income / refund / reimbursement.

const P2P_INFLOW_RE = /venmo|cash ?app|zelle|paypal/i;
const SPEND_CATEGORIES = new Set(['Food', 'Transport', 'Shopping', 'Entertainment', 'Health & Fitness', 'Housing']);

// A type:'in' transaction is 'income' (real new money), 'refund' (a merchant
// return — nets against that category), or 'reimbursement' (someone paying
// you back — nets against a chosen category, default Food). An explicit
// t.inflowKind wins; otherwise unclassified P2P defaults to 'reimbursement'
// (reviewed on the dashboard), a spend-category deposit is a 'refund', and
// everything else is 'income'.
function inflowKind(t) {
  if (!t || t.type !== 'in') return null;
  if (t.inflowKind) return t.inflowKind;
  if (P2P_INFLOW_RE.test(t.name || '')) return 'reimbursement';
  if (SPEND_CATEGORIES.has(t.category)) return 'refund';
  return 'income';
}
const isSpendOffset = (t) => { const k = inflowKind(t); return k === 'refund' || k === 'reimbursement'; };
// The category a spend-offset nets against.
const offsetCategory = (t) => (inflowKind(t) === 'reimbursement' ? (t.reimburseCategory || 'Food') : (t.category || 'Other'));
// A transfer into your own savings/investment accounts — set aside, not spent.
const isSavingsTransfer = (t) => !!t && t.type === 'out' && t.category === 'Savings';

// Net discretionary spend for an already-filtered set of txns: outflows
// (minus Savings transfers) minus refunds/reimbursements.
function netSpend(txns) {
  const out = (txns || []).filter(t => t.type === 'out' && !isSavingsTransfer(t)).reduce((s, t) => s + (t.amount || 0), 0);
  const offsets = (txns || []).filter(isSpendOffset).reduce((s, t) => s + (t.amount || 0), 0);
  return out - offsets;
}

// Everything set aside for savings in a month: category:'Savings' transfers
// PLUS contribution-tracked goal contributions dated that month (Roth etc.),
// which fund via an ACH that never becomes a transaction.
function monthlySavings(data, month, year) {
  const inM = (ds) => { const d = new Date(ds); return d.getMonth() === month && d.getFullYear() === year; };
  const xfers = (data.transactions || []).filter(t => isSavingsTransfer(t) && inM(t.date)).reduce((s, t) => s + (t.amount || 0), 0);
  const contribs = (data.goals || []).flatMap(g => g.contributions || []).filter(c => inM(c.date)).reduce((s, c) => s + (c.amount || 0), 0);
  return xfers + contribs;
}

module.exports = {
  P2P_INFLOW_RE, SPEND_CATEGORIES,
  inflowKind, isSpendOffset, offsetCategory, isSavingsTransfer,
  netSpend, monthlySavings,
};
