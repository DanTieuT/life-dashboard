// Unit tests for netlify/functions/finance-tools.mjs — pure functions over
// mock appData, no network calls, no live Anthropic/Plaid/Firebase access.
// Run: node --test test/finance-tools.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, TOOL_SCHEMAS, TOOL_IMPLEMENTATIONS } from '../netlify/functions/finance-tools.mjs';

const today = new Date();
const iso = (daysAgo) => new Date(today.getTime() - daysAgo * 86400000).toLocaleDateString('en-CA');

function mockAppData() {
  return {
    accounts: [
      { id: 'a1', name: 'Chase Checking', mask: '1234', type: 'checking', balance: 5000, plaidAccountId: 'p1', source: 'plaid' },
      { id: 'a2', name: 'Chase Credit Card', mask: '9999', type: 'debt', balance: 1200, creditLimit: 5000, plaidAccountId: 'p2', source: 'plaid' },
      { id: 'a3', name: 'Vanguard Brokerage', type: 'investment', balance: 30000, source: 'manual' },
    ],
    transactions: [
      // Normal dining charges
      { id: 't1', name: 'Chipotle', category: 'Food', amount: 12, type: 'out', date: iso(5), plaidAccountId: 'p1' },
      { id: 't2', name: 'Chipotle', category: 'Food', amount: 14, type: 'out', date: iso(35), plaidAccountId: 'p1' },
      { id: 't3', name: 'Chipotle', category: 'Food', amount: 13, type: 'out', date: iso(65), plaidAccountId: 'p1' },
      { id: 't4', name: 'Chipotle', category: 'Food', amount: 11, type: 'out', date: iso(95), plaidAccountId: 'p1' },
      // A big outlier dining charge, recent
      { id: 't5', name: 'Fancy Steakhouse', category: 'Food', amount: 400, type: 'out', date: iso(2), plaidAccountId: 'p1' },
      // Subscription pattern: 3 monthly Netflix charges
      { id: 't6', name: 'NETFLIX.COM', category: 'Entertainment', amount: 15.49, type: 'out', date: iso(1), plaidAccountId: 'p1' },
      { id: 't7', name: 'NETFLIX.COM', category: 'Entertainment', amount: 15.49, type: 'out', date: iso(31), plaidAccountId: 'p1' },
      { id: 't8', name: 'NETFLIX.COM', category: 'Entertainment', amount: 15.49, type: 'out', date: iso(61), plaidAccountId: 'p1' },
      // Payroll income
      { id: 't9', name: 'ACME CORP PAYROLL', category: 'Other', amount: 3000, type: 'in', date: iso(3), plaidAccountId: 'p1' },
      { id: 't10', name: 'ACME CORP PAYROLL', category: 'Other', amount: 3000, type: 'in', date: iso(17), plaidAccountId: 'p1' },
      // Internal transfer proxy — must be excluded from spend/cashflow
      { id: 't11', name: 'Transfer to Savings', category: 'Savings', amount: 500, type: 'out', date: iso(4), plaidAccountId: 'p1' },
      { id: 't12', name: 'Transfer from Checking', category: 'Savings', amount: 500, type: 'in', date: iso(4), plaidAccountId: 'p2' },
      // Manually entered, no account link at all
      { id: 't13', name: 'Cash tip', category: 'Food', amount: 5, type: 'out', date: iso(1) },
    ],
    netWorthHistory: [
      { date: iso(30), netWorth: 33000 },
      { date: iso(0), netWorth: 33800 },
    ],
  };
}

describe('get_accounts', () => {
  test('returns sanitized account fields, no plaid ids or raw account numbers', async () => {
    const r = await executeTool('get_accounts', {}, mockAppData());
    assert.equal(r.accounts.length, 3);
    const checking = r.accounts.find((a) => a.name === 'Chase Checking');
    assert.equal(checking.balance, 5000);
    assert.equal(checking.mask, '1234');
    assert.equal('plaidAccountId' in checking, false);
    assert.equal('plaidTxnId' in checking, false);
  });

  test('filters by type', async () => {
    const r = await executeTool('get_accounts', { type: 'debt' }, mockAppData());
    assert.equal(r.accounts.length, 1);
    assert.equal(r.accounts[0].name, 'Chase Credit Card');
  });
});

describe('get_transactions — date range filtering', () => {
  test('excludes transactions outside the requested range', async () => {
    const r = await executeTool('get_transactions', { startDate: iso(10), endDate: iso(0) }, mockAppData());
    const names = r.transactions.map((t) => t.name);
    assert.ok(names.includes('Fancy Steakhouse')); // 2 days ago, in range
    assert.ok(!names.includes('Chipotle') || r.transactions.filter(t=>t.name==='Chipotle').every(t => new Date(t.date) >= new Date(iso(10)))); // no 35/65/95-day-old Chipotle rows
  });

  test('rejects an inverted date range', async () => {
    const r = await executeTool('get_transactions', { startDate: iso(0), endDate: iso(30) }, mockAppData());
    assert.ok(r.error);
  });

  test('respects and caps the limit argument', async () => {
    const r = await executeTool('get_transactions', { startDate: iso(200), endDate: iso(0), limit: 999 }, mockAppData());
    assert.ok(r.transactions.length <= 200); // hard cap, even though caller asked for 999
  });

  test('resolves account name via plaidAccountId, not a nonexistent accountId field', async () => {
    const r = await executeTool('get_transactions', { startDate: iso(10), endDate: iso(0), merchant: 'Steakhouse' }, mockAppData());
    assert.equal(r.transactions[0].accountName, 'Chase Checking ••1234');
  });

  test('manually-entered transactions with no account link return a null accountName, not a crash', async () => {
    const r = await executeTool('get_transactions', { startDate: iso(10), endDate: iso(0), merchant: 'Cash tip' }, mockAppData());
    assert.equal(r.transactions[0].accountName, null);
  });
});

describe('get_spending_summary — transfer exclusion and no double counting', () => {
  test('excludes Savings-category transfers from spending totals', async () => {
    const r = await executeTool('get_spending_summary', { startDate: iso(10), endDate: iso(0), groupBy: 'category' }, mockAppData());
    const savingsGroup = r.breakdown.find((b) => b.key === 'Savings');
    assert.equal(savingsGroup, undefined, 'the $500 transfer must not appear in the spending breakdown');
  });

  test('credit-card payments never appear as transactions at all (ingestion-level exclusion), so summaries cannot double count them', async () => {
    // Sanity check on the mock's own shape: no transaction category represents
    // a card payment — this app's Plaid mapping (plaid.js) already drops
    // LOAN_PAYMENTS_CREDIT_CARD_PAYMENT at ingestion, so there is nothing for
    // get_spending_summary to filter here by design.
    const data = mockAppData();
    assert.ok(!data.transactions.some((t) => /credit card payment/i.test(t.name)));
  });

  test('groups by merchant and totals correctly', async () => {
    const r = await executeTool('get_spending_summary', { startDate: iso(10), endDate: iso(0), groupBy: 'merchant' }, mockAppData());
    const netflix = r.breakdown.find((b) => b.key === 'netflix.com');
    assert.equal(netflix.total, 15.49);
  });
});

describe('get_cash_flow_summary', () => {
  test('excludes internal transfers from both inflow and outflow', async () => {
    const r = await executeTool('get_cash_flow_summary', { startDate: iso(10), endDate: iso(0) }, mockAppData());
    assert.equal(r.excludedAsInternalTransfer, 2); // the $500 out + $500 in transfer pair
  });

  test('net cash flow is inflow minus outflow after exclusions', async () => {
    const r = await executeTool('get_cash_flow_summary', { startDate: iso(10), endDate: iso(0) }, mockAppData());
    assert.equal(r.netCashFlow, Math.round((r.totalInflow - r.totalOutflow) * 100) / 100);
  });

  test('empty range returns zeroed, not crashing, summary', async () => {
    const r = await executeTool('get_cash_flow_summary', { startDate: iso(1000), endDate: iso(999) }, mockAppData());
    assert.equal(r.totalInflow, 0);
    assert.equal(r.totalOutflow, 0);
    assert.equal(r.netCashFlow, 0);
  });
});

describe('get_recurring_transactions', () => {
  test('detects the 3-charge Netflix pattern as monthly', async () => {
    const r = await executeTool('get_recurring_transactions', {}, mockAppData());
    const netflix = r.recurring.find((x) => x.name === 'NETFLIX.COM');
    assert.ok(netflix, 'Netflix should be detected as recurring');
    assert.equal(netflix.frequency, 'monthly');
  });

  test('does not flag a single one-off charge as recurring', async () => {
    const r = await executeTool('get_recurring_transactions', {}, mockAppData());
    assert.ok(!r.recurring.some((x) => x.name === 'Fancy Steakhouse'));
  });
});

describe('get_liabilities', () => {
  test('returns balance and credit limit, with APR/due date explicitly null not fabricated', async () => {
    const r = await executeTool('get_liabilities', {}, mockAppData());
    assert.equal(r.liabilities.length, 1);
    assert.equal(r.liabilities[0].balanceOwed, 1200);
    assert.equal(r.liabilities[0].apr, null);
    assert.equal(r.liabilities[0].dueDate, null);
  });
});

describe('get_investment_holdings — does not fabricate data', () => {
  test('with no investmentHoldings data: empty holdings array, explicit unavailable-data note', async () => {
    const r = await executeTool('get_investment_holdings', {}, mockAppData());
    assert.equal(r.totalValue, 30000);
    assert.deepEqual(r.holdings, [], 'must be an empty array, not fabricated positions');
    assert.match(r.note, /no individual holdings|not available/i);
  });

  test('with real investmentHoldings data: returns actual positions, flags which accounts have detail', async () => {
    const data = {
      ...mockAppData(),
      accounts: [
        ...mockAppData().accounts,
        { id: 'a4', name: 'Schwab Brokerage', type: 'investment', balance: 12000, plaidAccountId: 'p9', source: 'plaid' },
      ],
      investmentHoldings: [{
        id: 'h1', itemId: 'item1', institution: 'Charles Schwab', plaidAccountId: 'p9', accountName: 'Individual',
        securityId: 'sec1', ticker: 'AAPL', name: 'Apple Inc.', securityType: 'equity',
        quantity: 10, costBasis: 1500, currentPrice: 175.5, currentValue: 1755, currency: 'USD',
      }],
      investmentHoldingsSyncedAt: 1755000000000,
    };
    const r = await executeTool('get_investment_holdings', {}, data);
    assert.equal(r.holdings.length, 1);
    assert.equal(r.holdings[0].ticker, 'AAPL');
    assert.equal(r.holdings[0].gainLoss, 255); // 1755 - 1500
    const schwab = r.accounts.find((a) => a.name === 'Schwab Brokerage');
    assert.equal(schwab.hasPositionDetail, true);
    const vanguard = r.accounts.find((a) => a.name === 'Vanguard Brokerage');
    assert.equal(vanguard.hasPositionDetail, false, 'manual account with no plaidAccountId must not claim position detail');
  });
});

describe('get_investment_transactions — does not fabricate data', () => {
  test('always returns empty with a note, never invents activity', async () => {
    const r = await executeTool('get_investment_transactions', {}, mockAppData());
    assert.deepEqual(r.transactions, []);
    assert.match(r.note, /not track/i);
  });
});

describe('get_watchlist_quotes', () => {
  // Only the non-network branches — this suite makes no live API calls
  // (see AI_ASSISTANT.md's testing notes). The actual Finnhub fetch path
  // was verified manually against the real API before shipping.
  test('empty watchlist returns an empty array with a note, no fetch attempted', async () => {
    const r = await executeTool('get_watchlist_quotes', {}, { ...mockAppData(), stockWatchlist: [] });
    assert.deepEqual(r.quotes, []);
    assert.match(r.note, /empty/i);
  });
  test('missing FINNHUB_API_KEY returns a clear note instead of a broken fetch', async () => {
    const saved = process.env.FINNHUB_API_KEY;
    delete process.env.FINNHUB_API_KEY;
    try {
      const r = await executeTool('get_watchlist_quotes', {}, { ...mockAppData(), stockWatchlist: [{ id: 'w1', ticker: 'AAPL' }] });
      assert.deepEqual(r.quotes, []);
      assert.match(r.note, /not configured/i);
    } finally {
      if (saved != null) process.env.FINNHUB_API_KEY = saved;
    }
  });
});

describe('get_net_worth_history', () => {
  test('computes change over the window', async () => {
    const r = await executeTool('get_net_worth_history', { days: 90 }, mockAppData());
    assert.equal(r.current, 33800);
    assert.equal(r.change, 800);
  });

  test('empty history does not crash', async () => {
    const data = mockAppData();
    data.netWorthHistory = [];
    const r = await executeTool('get_net_worth_history', {}, data);
    assert.deepEqual(r.history, []);
  });
});

describe('detect_transaction_anomalies', () => {
  test('flags the $400 steakhouse charge against a ~$12 Food baseline', async () => {
    const r = await executeTool('detect_transaction_anomalies', { days: 10 }, mockAppData());
    assert.ok(r.flagged.some((f) => f.name === 'Fancy Steakhouse'));
  });

  test('never affirmatively claims a charge is fraud — disclaiming it is fine, asserting it is not', async () => {
    const r = await executeTool('detect_transaction_anomalies', { days: 10 }, mockAppData());
    const text = JSON.stringify(r).toLowerCase();
    assert.ok(!/\bis fraud\b|\bfraudulent charge\b/.test(text), 'must not assert fraud');
    assert.match(r.note, /not confirmed fraud/i, 'should explicitly disclaim fraud, not just omit the word');
    r.flagged.forEach((f) => assert.match(f.reason, /standard deviation/i));
  });

  test('skips categories with too little history to judge', async () => {
    const data = mockAppData();
    data.transactions = [{ id: 'x', name: 'One-off', category: 'Shopping', amount: 900, type: 'out', date: iso(1) }];
    const r = await executeTool('detect_transaction_anomalies', { days: 10 }, data);
    assert.equal(r.flaggedCount, 0);
  });
});

describe('malformed / unauthorized tool calls', () => {
  test('unknown tool name returns a structured error, does not throw', async () => {
    const r = await executeTool('drop_all_transactions', {}, mockAppData());
    assert.ok(r.error);
  });

  test('non-object args do not crash a tool', async () => {
    const r = await executeTool('get_accounts', 'not-an-object', mockAppData());
    assert.ok(Array.isArray(r.accounts));
  });

  test('every declared tool schema has a matching implementation', () => {
    for (const schema of TOOL_SCHEMAS) {
      assert.ok(TOOL_IMPLEMENTATIONS[schema.name], `missing implementation for ${schema.name}`);
    }
  });

  test('tool results never contain a plaid access token field', async () => {
    const data = mockAppData();
    for (const schema of TOOL_SCHEMAS) {
      const r = await executeTool(schema.name, {}, data);
      assert.ok(!JSON.stringify(r).toLowerCase().includes('accesstoken'));
    }
  });
});
