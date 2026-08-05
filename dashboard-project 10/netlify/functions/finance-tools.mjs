// Read-only financial analysis tools for the JARVIS chat assistant (chat.mjs).
// Every function here is a pure function over an already-loaded `appData`
// object — no network calls, no writes, no DB access of its own. chat.mjs
// fetches appData once per request and passes it to whichever tools the
// model asks for.
//
// Design notes (see AI_ASSISTANT.md for the full writeup):
// - Plaid-sourced transactions already exclude credit-card payments and
//   account-to-account transfers at ingestion (see plaid.js's
//   INTERNAL_DETAILED set) — that's the app's real guardrail against
//   double-counting. The one gap is manually-entered transactions, where we
//   use category === 'Savings' as a best-effort transfer proxy (it's the
//   category Plaid's own Transfer/Investment categories map to too).
// - No investment-holdings or liability-detail (APR/due date/min payment)
//   data model exists in this app. Those tools say so explicitly rather
//   than inventing numbers.
// - Field selection is deliberately narrow: no plaidTxnId/plaidAccountId,
//   no full account numbers (only the existing `mask`), no access tokens
//   (those never enter appData in the first place — see plaid-link.js).

const TRANSFER_PROXY_CATEGORY = 'Savings';
const MAX_TXN_LIMIT = 200;
const DEFAULT_TXN_LIMIT = 50;
const MAX_DATE_RANGE_DAYS = 3660; // ~10 years — generous but not unbounded

function clampLimit(n) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_TXN_LIMIT;
  return Math.min(v, MAX_TXN_LIMIT);
}

// Parses "YYYY-MM-DD" at noon local time (matches the convention already
// used in js/finance.js's suggestBudget — avoids UTC-midnight parsing
// silently shifting a date back one day in any timezone behind UTC).
function parseLocalDate(ds) {
  if (!ds) return null;
  const d = new Date(ds + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

function todayStr() {
  return new Date().toLocaleDateString('en-CA');
}

// Clamps/validates a {startDate,endDate} pair. Returns {start,end,label,error}.
// `end` defaults to today; `start` defaults to 90 days before `end`.
function resolveDateRange(startDate, endDate) {
  const end = parseLocalDate(endDate) || new Date();
  const start = parseLocalDate(startDate) || new Date(end.getTime() - 90 * 86400000);
  if (start > end) return { error: 'startDate must be before endDate' };
  const days = (end - start) / 86400000;
  if (days > MAX_DATE_RANGE_DAYS) return { error: `Date range too large (max ${MAX_DATE_RANGE_DAYS} days)` };
  const fmt = (d) => d.toLocaleDateString('en-CA');
  return { start, end, label: `${fmt(start)} to ${fmt(end)}` };
}

function inRange(txn, start, end) {
  const d = parseLocalDate(txn.date);
  return d && d >= start && d <= end;
}

function acctLabel(acct) {
  if (!acct) return null;
  return acct.mask ? `${acct.name} ••${acct.mask}` : acct.name;
}

// Transactions only ever carry `plaidAccountId` (Plaid-sourced) — manually
// entered transactions have no account link at all. There is no generic
// `accountId` field on a transaction anywhere in this app's data model.
function acctByPlaidId(appData) {
  const byPlaidId = {};
  (appData.accounts || []).forEach((a) => { if (a.plaidAccountId) byPlaidId[a.plaidAccountId] = a; });
  return byPlaidId;
}
function txnAccount(t, byPlaidId) {
  return t.plaidAccountId ? byPlaidId[t.plaidAccountId] : null;
}
// Converts caller-supplied account.id values (from get_accounts) into the
// set of plaidAccountId values transactions actually carry, for filtering.
function plaidIdsForAccountIds(appData, accountIds) {
  const want = new Set(accountIds);
  const ids = new Set();
  (appData.accounts || []).forEach((a) => { if (want.has(a.id) && a.plaidAccountId) ids.add(a.plaidAccountId); });
  return ids;
}

// ── Subscription/recurring detection ────────────────────────────────────
// Ported verbatim from js/finance.js's detectSubscriptions() (client-side,
// browser-only) so the assistant sees exactly what the Finance tab shows —
// same merchant-normalization, same frequency tolerances, same amount-drift
// cutoff. Kept here as a plain function over a passed-in appData instead of
// the global `appData` the browser version reads.
function normMerchant(name) {
  return (name || '').toLowerCase()
    .replace(/[*#][a-z0-9]+$/i, '')
    .replace(/\s+\d{3,}$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
const SUB_FREQS = [
  { label: 'weekly', days: 7, tolerance: 2, monthly: (x) => x * 4.33 },
  { label: 'monthly', days: 30, tolerance: 5, monthly: (x) => x },
  { label: 'yearly', days: 365, tolerance: 20, monthly: (x) => x / 12 },
];
function detectRecurring(appData, flowType) {
  const type = flowType === 'in' ? 'in' : 'out'; // only outflow subscriptions are pattern-detected today
  const txns = (appData.transactions || []).filter((t) => t.type === type);
  const groups = {};
  txns.forEach((t) => {
    const key = normMerchant(t.name);
    if (!key) return;
    (groups[key] = groups[key] || []).push(t);
  });
  const byPlaidId = acctByPlaidId(appData);
  const results = [];
  Object.values(groups).forEach((group) => {
    if (group.length < 2) return;
    group.sort((a, b) => new Date(a.date) - new Date(b.date));
    const gaps = [];
    for (let i = 1; i < group.length; i++) gaps.push((new Date(group[i].date) - new Date(group[i - 1].date)) / 86400000);
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const freq = SUB_FREQS.find((f) => Math.abs(avgGap - f.days) <= f.tolerance);
    if (!freq) return;
    const amounts = group.map((t) => t.amount);
    const avgAmt = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const maxDrift = Math.max(...amounts.map((a) => Math.abs(a - avgAmt))) / avgAmt;
    if (maxDrift > 0.15) return;
    const last = group[group.length - 1];
    const acct = txnAccount(last, byPlaidId);
    results.push({
      name: last.name,
      category: last.category,
      amount: Math.round(last.amount * 100) / 100,
      frequency: freq.label,
      monthlyEquivalent: Math.round(freq.monthly(last.amount) * 100) / 100,
      lastDate: last.date,
      nextExpectedDate: new Date(new Date(last.date + 'T12:00:00').getTime() + freq.days * 86400000).toLocaleDateString('en-CA'),
      accountName: acctLabel(acct),
      occurrencesSeen: group.length,
    });
  });
  // Fold in manually-flagged recurring items the pattern detector hasn't
  // caught yet (e.g. only one charge logged so far).
  const seen = new Set(results.map((r) => normMerchant(r.name)));
  txns.filter((t) => t.recurring).forEach((t) => {
    const key = normMerchant(t.name);
    if (seen.has(key)) return;
    seen.add(key);
    const acct = txnAccount(t, byPlaidId);
    const freq = SUB_FREQS.find((f) => f.label === (t.recurrence || 'monthly')) || SUB_FREQS[1];
    results.push({
      name: t.name,
      category: t.category,
      amount: Math.round(t.amount * 100) / 100,
      frequency: freq.label,
      monthlyEquivalent: Math.round(freq.monthly(t.amount) * 100) / 100,
      lastDate: t.date,
      nextExpectedDate: null,
      accountName: acctLabel(acct),
      occurrencesSeen: 1,
    });
  });
  return results.sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);
}

// ── Tools ──────────────────────────────────────────────────────────────

function get_accounts(appData, args = {}) {
  const { type, institution, includeClosed = false } = args;
  let accounts = appData.accounts || [];
  if (!includeClosed) accounts = accounts.filter((a) => !a.closed);
  if (type) accounts = accounts.filter((a) => a.type === type);
  if (institution) {
    const q = institution.toLowerCase();
    accounts = accounts.filter((a) => (a.name || '').toLowerCase().includes(q));
  }
  return {
    accounts: accounts.map((a) => ({
      accountId: a.id,
      name: a.name,
      mask: a.mask || null,
      type: a.type,
      balance: Math.round((a.balance || 0) * 100) / 100,
      creditLimit: a.type === 'debt' ? (a.creditLimit || null) : undefined,
      source: a.source === 'plaid' ? 'plaid' : 'manual',
      lastUpdated: a.updatedAt ? new Date(a.updatedAt).toISOString() : null,
    })),
    totalAssets: Math.round(accounts.filter((a) => a.type !== 'debt').reduce((s, a) => s + (a.balance || 0), 0) * 100) / 100,
    totalLiabilities: Math.round(accounts.filter((a) => a.type === 'debt').reduce((s, a) => s + (a.balance || 0), 0) * 100) / 100,
  };
}

function get_transactions(appData, args = {}) {
  const range = resolveDateRange(args.startDate, args.endDate);
  if (range.error) return { error: range.error };
  const limit = clampLimit(args.limit);
  const byPlaidId = acctByPlaidId(appData);
  let txns = (appData.transactions || []).filter((t) => inRange(t, range.start, range.end));
  if (Array.isArray(args.accountIds) && args.accountIds.length) {
    const wantPlaidIds = plaidIdsForAccountIds(appData, args.accountIds);
    txns = txns.filter((t) => wantPlaidIds.has(t.plaidAccountId));
  }
  if (args.merchant) {
    const q = args.merchant.toLowerCase();
    txns = txns.filter((t) => (t.name || '').toLowerCase().includes(q));
  }
  if (args.category) txns = txns.filter((t) => t.category === args.category);
  if (typeof args.minAmount === 'number') txns = txns.filter((t) => t.amount >= args.minAmount);
  if (typeof args.maxAmount === 'number') txns = txns.filter((t) => t.amount <= args.maxAmount);
  if (args.pending === false) txns = txns.filter((t) => !t.pending);
  txns.sort((a, b) => new Date(b.date) - new Date(a.date));
  const total = txns.length;
  txns = txns.slice(0, limit);
  return {
    dateRange: range.label,
    totalMatched: total,
    returned: txns.length,
    truncated: total > txns.length,
    transactions: txns.map((t) => ({
      date: t.date,
      name: t.name,
      category: t.category,
      amount: Math.round(t.amount * 100) / 100,
      type: t.type,
      accountName: acctLabel(txnAccount(t, byPlaidId)) || null,
      pending: !!t.pending,
    })),
  };
}

function get_spending_summary(appData, args = {}) {
  const range = resolveDateRange(args.startDate, args.endDate);
  if (range.error) return { error: range.error };
  const groupBy = ['category', 'merchant', 'account', 'week', 'month'].includes(args.groupBy) ? args.groupBy : 'category';
  const excluded = new Set([TRANSFER_PROXY_CATEGORY, ...(args.excludeCategories || [])]);
  const byPlaidId = acctByPlaidId(appData);
  let txns = (appData.transactions || []).filter((t) => t.type === 'out' && inRange(t, range.start, range.end) && !excluded.has(t.category));
  if (Array.isArray(args.accountIds) && args.accountIds.length) {
    const wantPlaidIds = plaidIdsForAccountIds(appData, args.accountIds);
    txns = txns.filter((t) => wantPlaidIds.has(t.plaidAccountId));
  }
  const keyFor = (t) => {
    if (groupBy === 'merchant') return normMerchant(t.name) || t.name || 'Unknown';
    if (groupBy === 'account') return acctLabel(txnAccount(t, byPlaidId)) || 'Unknown account';
    if (groupBy === 'week' || groupBy === 'month') {
      const d = parseLocalDate(t.date);
      return groupBy === 'month' ? d.toLocaleDateString('en-CA').slice(0, 7) : isoWeekKey(d);
    }
    return t.category || 'Other';
  };
  const groups = {};
  txns.forEach((t) => {
    const k = keyFor(t);
    groups[k] = (groups[k] || 0) + t.amount;
  });
  const breakdown = Object.entries(groups)
    .map(([key, total]) => ({ key, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);
  const totalSpent = Math.round(txns.reduce((s, t) => s + t.amount, 0) * 100) / 100;
  return {
    dateRange: range.label,
    groupedBy: groupBy,
    totalSpent,
    transactionCount: txns.length,
    breakdown,
    excludedCategories: [...excluded],
  };
}
function isoWeekKey(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); // Monday of that week
  return dt.toLocaleDateString('en-CA');
}

function get_cash_flow_summary(appData, args = {}) {
  const range = resolveDateRange(args.startDate, args.endDate);
  if (range.error) return { error: range.error };
  const inRangeTxns = (appData.transactions || []).filter((t) => inRange(t, range.start, range.end));
  const isTransferProxy = (t) => t.category === TRANSFER_PROXY_CATEGORY;
  const inflows = inRangeTxns.filter((t) => t.type === 'in' && !isTransferProxy(t));
  const outflows = inRangeTxns.filter((t) => t.type === 'out' && !isTransferProxy(t));
  const totalIn = Math.round(inflows.reduce((s, t) => s + t.amount, 0) * 100) / 100;
  const totalOut = Math.round(outflows.reduce((s, t) => s + t.amount, 0) * 100) / 100;
  // Best-effort income classification — this app doesn't tag deposits with a
  // Plaid income/transfer sub-type, so this is a heuristic, not certainty.
  const payrollLike = inflows.filter((t) => /payroll|salary|direct dep/i.test(t.name));
  const otherInflows = inflows.filter((t) => !payrollLike.includes(t));
  return {
    dateRange: range.label,
    totalInflow: totalIn,
    totalOutflow: totalOut,
    netCashFlow: Math.round((totalIn - totalOut) * 100) / 100,
    inflowBreakdown: {
      payrollLike: Math.round(payrollLike.reduce((s, t) => s + t.amount, 0) * 100) / 100,
      otherDeposits: Math.round(otherInflows.reduce((s, t) => s + t.amount, 0) * 100) / 100,
      note: 'payrollLike is a name-based heuristic (matches "payroll"/"salary"/"direct dep"), not a verified income classification — say so if precision matters for the answer.',
    },
    excludedAsInternalTransfer: inRangeTxns.filter(isTransferProxy).length,
    transferExclusionNote: `Transactions categorized "${TRANSFER_PROXY_CATEGORY}" are excluded from both inflow and outflow as likely internal transfers. Plaid-sourced credit-card payments and account-to-account transfers are already excluded upstream and never appear as transactions at all.`,
  };
}

function get_recurring_transactions(appData, args = {}) {
  const flowType = args.flowType === 'in' ? 'in' : 'out';
  let results = detectRecurring(appData, flowType);
  if (args.category) results = results.filter((r) => r.category === args.category);
  if (args.activeOnly) {
    const today = parseLocalDate(todayStr());
    results = results.filter((r) => !r.nextExpectedDate || parseLocalDate(r.nextExpectedDate) >= new Date(today.getTime() - 45 * 86400000));
  }
  if (args.startDate || args.endDate) {
    const range = resolveDateRange(args.startDate, args.endDate);
    if (range.error) return { error: range.error };
    results = results.filter((r) => inRange({ date: r.lastDate }, range.start, range.end));
  }
  return {
    flowType,
    count: results.length,
    totalMonthlyEquivalent: Math.round(results.reduce((s, r) => s + r.monthlyEquivalent, 0) * 100) / 100,
    recurring: results,
    detectionNote: 'Detected from at least 2 charges from the same merchant at a consistent amount (±15%) and interval (weekly/monthly/yearly) — not from bank-provided subscription metadata. Recurring income detection is not implemented; flowType "in" will return an empty list.',
  };
}

function get_liabilities(appData) {
  const debts = (appData.accounts || []).filter((a) => a.type === 'debt');
  return {
    liabilities: debts.map((a) => ({
      accountId: a.id,
      name: a.name,
      mask: a.mask || null,
      balanceOwed: Math.round((a.balance || 0) * 100) / 100,
      creditLimit: a.creditLimit || null,
      utilizationPct: a.creditLimit ? Math.round((a.balance / a.creditLimit) * 1000) / 10 : null,
      apr: null,
      dueDate: null,
      minimumPayment: null,
      statementBalance: null,
    })),
    totalOwed: Math.round(debts.reduce((s, a) => s + (a.balance || 0), 0) * 100) / 100,
    note: 'APR, due date, minimum payment, and statement details are not tracked by this dashboard — those fields are always null, not zero. Do not imply they are known.',
  };
}

function get_investment_holdings(appData) {
  const invAccounts = (appData.accounts || []).filter((a) => a.type === 'investment' || a.type === 'crypto');
  return {
    accounts: invAccounts.map((a) => ({
      accountId: a.id,
      name: a.name,
      type: a.type,
      balance: Math.round((a.balance || 0) * 100) / 100,
    })),
    totalValue: Math.round(invAccounts.reduce((s, a) => s + (a.balance || 0), 0) * 100) / 100,
    note: 'This dashboard only tracks total account balance for investment/crypto accounts, not individual holdings, quantities, cost basis, or allocation — the Plaid Investments product is not linked. Do not invent a holdings breakdown; tell the user this level of detail isn\'t available yet.',
  };
}

function get_investment_transactions() {
  return {
    transactions: [],
    note: 'Investment transaction history (buys/sells/dividends/interest/fees) is not tracked by this dashboard — the Plaid Investments product is not linked. Do not invent activity; tell the user this isn\'t available yet.',
  };
}

function get_net_worth_history(appData, args = {}) {
  const days = Math.min(parseInt(args.days, 10) || 90, 3660);
  const hist = (appData.netWorthHistory || []).slice(-days);
  if (!hist.length) return { history: [], note: 'No net worth history recorded yet.' };
  const first = hist[0].netWorth;
  const last = hist[hist.length - 1].netWorth;
  return {
    dateRange: `${hist[0].date} to ${hist[hist.length - 1].date}`,
    current: Math.round(last * 100) / 100,
    change: Math.round((last - first) * 100) / 100,
    changePct: first !== 0 ? Math.round(((last - first) / Math.abs(first)) * 1000) / 10 : null,
    history: hist.map((h) => ({ date: h.date, netWorth: Math.round(h.netWorth * 100) / 100 })),
  };
}

// Deterministic anomaly flagging: for each category, compares transactions in
// the lookback window against that category's own historical mean+stddev
// (computed from everything OUTSIDE the window, so a cluster of big charges
// this week doesn't inflate its own baseline). Flags anything more than 2
// standard deviations above the mean. This is explicitly a statistical
// outlier, not a fraud determination — the tool result and system prompt
// both say so.
function detect_transaction_anomalies(appData, args = {}) {
  const days = Math.min(parseInt(args.days, 10) || 30, 365);
  const minZ = typeof args.minZScore === 'number' ? args.minZScore : 2;
  const cutoff = new Date(Date.now() - days * 86400000);
  const all = (appData.transactions || []).filter((t) => t.type === 'out' && t.category !== TRANSFER_PROXY_CATEGORY);
  const byPlaidId = acctByPlaidId(appData);
  const recent = all.filter((t) => parseLocalDate(t.date) >= cutoff);
  const baseline = all.filter((t) => parseLocalDate(t.date) < cutoff);
  const statsByCat = {};
  baseline.forEach((t) => {
    const s = statsByCat[t.category] || (statsByCat[t.category] = { amounts: [] });
    s.amounts.push(t.amount);
  });
  Object.values(statsByCat).forEach((s) => {
    const n = s.amounts.length;
    s.mean = s.amounts.reduce((a, b) => a + b, 0) / n;
    s.stddev = n > 1 ? Math.sqrt(s.amounts.reduce((a, b) => a + (b - s.mean) ** 2, 0) / (n - 1)) : 0;
    s.n = n;
  });
  const flagged = [];
  recent.forEach((t) => {
    const s = statsByCat[t.category];
    if (!s || s.n < 3 || s.stddev === 0) return; // not enough history for this category to judge
    const z = (t.amount - s.mean) / s.stddev;
    if (z >= minZ) {
      flagged.push({
        date: t.date,
        name: t.name,
        category: t.category,
        amount: Math.round(t.amount * 100) / 100,
        accountName: acctLabel(txnAccount(t, byPlaidId)) || null,
        typicalAmountForCategory: Math.round(s.mean * 100) / 100,
        deviationScore: Math.round(z * 10) / 10,
        reason: `${Math.round(z * 10) / 10}x standard deviations above your typical "${t.category}" charge (~$${Math.round(s.mean)})`,
      });
    }
  });
  flagged.sort((a, b) => b.deviationScore - a.deviationScore);
  return {
    windowDays: days,
    flaggedCount: flagged.length,
    flagged,
    note: 'These are statistical outliers vs. your own category history — "potentially unusual," not confirmed fraud. Categories with fewer than 3 prior transactions are skipped for lack of a baseline.',
  };
}

export const TOOL_IMPLEMENTATIONS = {
  get_accounts,
  get_transactions,
  get_spending_summary,
  get_cash_flow_summary,
  get_recurring_transactions,
  get_liabilities,
  get_investment_holdings,
  get_investment_transactions,
  get_net_worth_history,
  detect_transaction_anomalies,
};

// Claude tool-use schemas (Anthropic Messages API `tools` param shape).
export const TOOL_SCHEMAS = [
  {
    name: 'get_accounts',
    description: 'List the user\'s financial accounts (checking, savings, credit/debt, investment, crypto, property) with current balances. Use for "what accounts do I have" / "what\'s my balance" questions.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['checking', 'savings', 'investment', 'crypto', 'property', 'debt'], description: 'Filter to one account type.' },
        institution: { type: 'string', description: 'Filter by a substring of the account/institution name.' },
        includeClosed: { type: 'boolean', description: 'Include closed accounts. Default false.' },
      },
    },
  },
  {
    name: 'get_transactions',
    description: 'List individual transactions in a date range, optionally filtered. Defaults to the last 90 days if no dates given. Use for "show me my recent charges" / merchant lookups — for totals or category breakdowns prefer get_spending_summary instead.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
        endDate: { type: 'string', description: 'YYYY-MM-DD, inclusive. Defaults to today.' },
        accountIds: { type: 'array', items: { type: 'string' }, description: 'Limit to these account IDs (from get_accounts).' },
        merchant: { type: 'string', description: 'Substring match on transaction name.' },
        category: { type: 'string' },
        minAmount: { type: 'number' },
        maxAmount: { type: 'number' },
        pending: { type: 'boolean', description: 'Set false to exclude pending transactions.' },
        limit: { type: 'integer', description: `Max rows to return, default ${DEFAULT_TXN_LIMIT}, hard cap ${MAX_TXN_LIMIT}.` },
      },
    },
  },
  {
    name: 'get_spending_summary',
    description: 'Aggregated spending (outflows only) grouped by category, merchant, account, week, or month, over a date range. This is the right tool for "how much did I spend on X" and month-over-month comparisons (call it twice, once per month, and compare). If a narrow window (e.g. one specific month) comes back with transactionCount 0 or very low, call again with a wider range (3-6 months) before telling the user there\'s no data — history may just start later than expected.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'YYYY-MM-DD, inclusive. Defaults to 90 days before endDate.' },
        endDate: { type: 'string', description: 'YYYY-MM-DD, inclusive. Defaults to today.' },
        groupBy: { type: 'string', enum: ['category', 'merchant', 'account', 'week', 'month'], description: 'Default "category".' },
        accountIds: { type: 'array', items: { type: 'string' } },
        excludeCategories: { type: 'array', items: { type: 'string' }, description: '"Savings" (transfer proxy) is always excluded regardless of this list.' },
      },
      required: ['startDate', 'endDate'],
    },
  },
  {
    name: 'get_cash_flow_summary',
    description: 'Reconciled inflows, outflows, and net cash flow for a date range, with internal transfers excluded from both sides. Use for "what was my cash flow" / income-vs-spending questions.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
        endDate: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
      },
      required: ['startDate', 'endDate'],
    },
  },
  {
    name: 'get_recurring_transactions',
    description: 'Detected recurring bills/subscriptions (pattern-detected from transaction history, not bank metadata). Use for "what subscriptions do I have" / "what bills are coming up".',
    input_schema: {
      type: 'object',
      properties: {
        flowType: { type: 'string', enum: ['in', 'out'], description: 'Default "out". Recurring income detection is not implemented.' },
        activeOnly: { type: 'boolean', description: 'Only include items with an expected next charge in the near future.' },
        category: { type: 'string' },
      },
    },
  },
  {
    name: 'get_liabilities',
    description: 'Credit card / debt account balances and credit limits. APR, due dates, and minimum payments are NOT tracked by this app and will always be null — say so rather than guessing.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_investment_holdings',
    description: 'Investment/crypto account balances. This app does NOT track individual holdings, quantities, or cost basis — only total account balance. Will explicitly say so; do not treat the absence as zero holdings.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_investment_transactions',
    description: 'Investment activity (buys/sells/dividends). NOT tracked by this app — always returns empty with an explanation. Call this only if the user explicitly asks, so you can tell them accurately rather than guessing.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_net_worth_history',
    description: 'Historical net worth (assets minus liabilities) over time, plus the change over the period. Use for "what\'s my net worth" / trend questions.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'integer', description: 'Lookback window in days, default 90.' } },
    },
  },
  {
    name: 'detect_transaction_anomalies',
    description: 'Statistically unusual transactions vs. the user\'s own category history (z-score based). Labels results "potentially unusual" — never claims fraud. Use for "any weird charges lately" questions.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'Lookback window in days, default 30.' },
        minZScore: { type: 'number', description: 'Standard-deviation threshold, default 2.' },
      },
    },
  },
];

// Executes one tool call by name against appData, with defensive argument
// handling — never throws into the caller; a bad/unknown tool name or a
// thrown error inside a tool becomes a structured error result the model
// can see and recover from, instead of taking down the whole chat turn.
export async function executeTool(name, args, appData) {
  const impl = TOOL_IMPLEMENTATIONS[name];
  if (!impl) return { error: `Unknown tool "${name}"` };
  try {
    return impl(appData, args && typeof args === 'object' ? args : {});
  } catch (e) {
    return { error: `Tool "${name}" failed: ${e.message}` };
  }
}
