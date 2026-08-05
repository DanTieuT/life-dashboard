# AI assistant (JARVIS) — financial tools

This dashboard already had an AI assistant (the 💬 button — "JARVIS") before
this work started: a Claude-powered chat panel with full context on tasks,
habits, schedule, and projects, streamed live via Server-Sent Events from
[`netlify/functions/chat.mjs`](netlify/functions/chat.mjs). This document
covers what was *added* to it: a set of read-only financial analysis tools,
real tool-calling (not the old text-marker hack), and request-level auth.

No second assistant, no OpenAI key, no new chat UI — everything below extends
the existing one, per the app's own "don't rebuild what works" convention.

## Environment variables

See [`.env.example`](.env.example) for the full list this app uses. The ones
relevant to this feature:

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Without it, `chat.mjs` returns a friendly "not configured" message instead of erroring. |
| `ANTHROPIC_MODEL` | No | Defaults to `claude-sonnet-4-6`. Change the model without touching code. |
| `FIREBASE_SERVICE_ACCOUNT_B64` | Production only | Falls back to a local `netlify/functions/service-account.json` for dev. Needed for both auth verification and reading financial data. |

There is no `OPENAI_API_KEY` requirement for this feature — an unused key of
that name may exist in an older local `.env` from before this app settled on
Anthropic; it's harmless and unread by any of this code.

## How the request flow works

```
Browser (dashboard.js sendChat)
  → attaches the signed-in user's Firebase ID token as `Authorization: Bearer <token>`
  → POST /.netlify/functions/chat  { message, context, history }
       │
       ▼
chat.mjs
  1. verifyAuth(req) — verifies the ID token via Firebase Admin, checks the
     decoded uid matches this app's single authorized user. No valid token
     → 401, and nothing past this point runs (no Firestore read, no Anthropic
     call).
  2. Builds a system prompt from the client-supplied `context` (tasks,
     habits, events, weather, budget summary — unchanged from before).
  3. Calls Claude's Messages API with `tools: TOOL_SCHEMAS`, streaming.
  4. If the model asks for a tool: fetches the user's Firestore doc ONCE
     (lazily, only if a tool is actually invoked), executes the tool against
     that data via finance-tools.mjs, sends the result back as a tool_result
     block, and loops (up to 6 rounds) until the model has a final answer.
  5. Every text delta from every round streams to the browser live — the
     client never knows rounds happened, it just sees continuous text.
  6. The final text may still end with the pre-existing `<<<ACTIONS>>>`
     marker + JSON for write actions (add_task, log_habit, etc.) — that
     mechanism is untouched and is entirely separate from the read-only
     financial tools.
```

The model **never** receives raw account/transaction data directly — only
the specific, sanitized JSON each tool call returns (see "What each tool
returns" below).

## Available financial tools

All implemented in [`netlify/functions/finance-tools.mjs`](netlify/functions/finance-tools.mjs)
as pure functions over an already-loaded `appData` object — no network
calls, no writes, nothing arbitrary (no SQL, no file access, no code
execution). Schemas live in the same file as `TOOL_SCHEMAS`.

| Tool | Returns | Notes |
|---|---|---|
| `get_accounts` | Account list + balances | Filterable by type/institution. |
| `get_transactions` | Individual transactions in a date range | Capped at 200 rows; defaults to 50. |
| `get_spending_summary` | Aggregated outflows, grouped by category/merchant/account/week/month | The right tool for "how much did I spend on X". |
| `get_cash_flow_summary` | Inflow/outflow/net for a range | Excludes internal transfers from both sides. |
| `get_recurring_transactions` | Detected subscriptions/bills | Ports the existing pattern-detection from `js/finance.js`'s `detectSubscriptions()`. |
| `get_liabilities` | Credit/debt account balances + credit limit | APR/due date/minimum payment are always `null` — **not tracked**, not zero. |
| `get_investment_holdings` | Investment/crypto account balances only | **No holdings/quantities/cost-basis data exists** — the tool says so explicitly. |
| `get_investment_transactions` | Always empty | Plaid's Investments product isn't linked — explicitly not fabricated. |
| `get_net_worth_history` | Historical net worth + change over the window | Reads `appData.netWorthHistory`. |
| `detect_transaction_anomalies` | Statistical outliers vs. the user's own category history (z-score) | Labeled "potentially unusual," never "fraud." |

### How transfer exclusion and no-double-counting actually work

This was mostly already solved, not newly built: `netlify/functions/plaid.js`'s
`mapTransaction()` drops credit-card payments and account-to-account
transfers **at ingestion** (via Plaid's `personal_finance_category.detailed`
— see `INTERNAL_DETAILED`), so they never become a stored transaction at
all. The one gap is manually-entered transactions, which have no such
classification — the tools use `category === 'Savings'` as a best-effort
proxy for "this looks like an internal transfer" (it's the same category
Plaid's own Transfer/Investment categories map to). This is documented as a
heuristic in the tool code and in the system prompt — the assistant is
instructed to say so if precision matters.

## Security and privacy

- **Auth**: every request must carry a valid Firebase ID token for this
  app's one authorized user (checked via `admin.auth().verifyIdToken` +
  a UID match). No token → 401, before any data is touched.
- **Single-user model**: this app has exactly one user by design — every
  other Netlify Function already operates on one hardcoded Firestore doc
  with no per-request authorization. The auth check above confirms the
  *browser request* is really from Dan's signed-in session; it is not a
  multi-tenant isolation system because there is nothing to isolate from.
- **Minimal data to the model**: the model only ever sees a specific tool's
  sanitized JSON result — never a raw dump of `appData`. Fields are chosen
  narrowly (no Plaid access tokens — those never enter `appData` in the
  first place; no full account numbers — only the existing masked `mask`
  field; no internal Plaid IDs in tool output).
- **No sensitive logging**: `chat.mjs` logs tool *names* invoked per round,
  never arguments or results (both can contain real financial figures).
- **Read-only, closed tool set**: the model can only call the exact 10 named
  tools above with schema-validated arguments — no SQL, no arbitrary URLs,
  no file access, no code execution. `executeTool()` rejects unknown tool
  names with a structured error instead of throwing.
- **Rate limiting**: a best-effort in-memory per-process counter (30
  req/min). This is **not** a real distributed rate limiter — Netlify
  Function containers are ephemeral and this resets on cold start. The real
  protection against abuse is the auth check, not this counter.

## Testing

```bash
npm run test:unit   # node's built-in test runner, no network calls, no live API keys needed
npm test            # test:unit, then the existing Puppeteer smoke test
```

- [`test/finance-tools.test.mjs`](test/finance-tools.test.mjs) — 27 tests:
  argument validation, transfer exclusion, no double-counting, date-range
  filtering, aggregation math, empty-data behavior, malformed/unknown tool
  calls, and a check that no tool result ever contains an access-token-shaped
  field.
- [`test/chat-handler.test.mjs`](test/chat-handler.test.mjs) — 21 tests:
  the system prompt's guardrail text, auth header parsing, user isolation
  (a token that verifies for the *wrong* uid is rejected), rate limiting,
  streaming SSE parsing (text and tool_use, including a malformed
  `input_json_delta` buffer), upstream-API-failure handling, and the real
  exported handler's CORS/method/missing-key/unauthorized paths.

**Known gap**: the real exported handler's *authenticated* path (valid
token → tool loop → streamed answer) isn't covered end-to-end in these
tests. `firebase-admin`'s exports are non-writable, so monkey-patching them
in a test doesn't work, and there's no mocking library in this project to
intercept the ESM import cleanly. Instead, `verifyAuth`, `loadAppData`, and
`runOneRound` each take an optional injectable function (defaulting to the
real Firebase/Anthropic call) specifically so their logic is fully testable
without one — that covers the same code paths, just not through the literal
default-exported function signature Netlify calls.

## Known limitations

- **Single-user app.** Everything above assumes exactly one Firestore user
  doc, matching the rest of this codebase. This is not designed to scale to
  multiple users without real per-request tenant scoping.
- **No investment holdings data.** Only Plaid's Transactions product is
  linked (see `plaid.js`'s `createLinkToken`) — no positions, quantities, or
  cost basis exist anywhere in `appData`. The two investment tools say so
  rather than inventing numbers.
- **No liability detail.** APR, due dates, minimum payments, and statement
  balances aren't tracked — `get_liabilities` always returns `null` for
  these, deliberately, to avoid implying they're known.
- **Transfer detection is a heuristic for manual entries.** Plaid-sourced
  transactions already exclude real transfers/card-payments at ingestion;
  manually-entered ones rely on the `category === 'Savings'` proxy, which
  can misclassify an edge case.
- **Rate limiting is in-memory, per-container.** Not a real distributed
  limiter — see "Security and privacy" above.
- **Conversation history is session-only**, same as before this change —
  `_chatHistory` lives in the browser tab's memory (`js/dashboard.js`), not
  persisted to Firestore. Refreshing the page starts a new conversation.
  Persisting it would be a reasonable follow-up but wasn't part of this
  change (existing behavior, not a regression).

## Adding another tool

1. Add a pure function to `TOOL_IMPLEMENTATIONS` in `finance-tools.mjs` —
   takes `(appData, args)`, returns a plain JSON-serializable object. Return
   `{ error: '...' }` for validation failures instead of throwing.
2. Add a matching entry to `TOOL_SCHEMAS` (Anthropic's tool-schema shape —
   `name`, `description`, `input_schema`). The `name` must match exactly.
3. Add tests in `finance-tools.test.mjs` — at minimum: happy path, empty
   data, and a bad-argument case.
4. If the tool needs the model to know it exists in specific situations,
   mention it in `chat.mjs`'s system prompt (the "FINANCIAL TOOLS" line).

No changes to `chat.mjs`'s tool-calling loop are needed — it already
dispatches by name to whatever's in `TOOL_IMPLEMENTATIONS`.

## Changing the model

Set `ANTHROPIC_MODEL` in your Netlify environment (or local `.env`) to any
valid Claude model ID. No code change needed.

## Disabling the AI feature

Unset `ANTHROPIC_API_KEY`. `chat.mjs` checks for it first and returns a
plain-JSON "not configured" message instead of attempting any Anthropic
call — the 💬 button and panel still render, they just won't get a real
reply. To hide the button entirely, remove the `#chatFab`/`#chatPanel`
elements from `index.html` (search for "AI Chat FAB").
