# ChatGPT bridge — read/write access to the dashboard from a Custom GPT

This is a second front door onto the same dashboard data Telegram JARVIS
already reads and writes — a Custom GPT in the ChatGPT app that can see your
tasks/habits/calendar/budget/projects/goals and change them, without a
confirm-before-acting step.

No new AI brain here: `dashboard-context.js` and `dashboard-actions.js` are
thin HTTP wrappers around [`dashboard-lib.js`](netlify/functions/dashboard-lib.js) —
the exact same `buildContext()` and `applyActions()` functions Telegram's
[`telegram.js`](netlify/functions/telegram.js) already runs on every message.
Extracting them into a shared module means this bridge and Telegram can never
drift apart in what they know how to do.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `GPT_BRIDGE_KEY` | Yes | Already generated and set in `.env`. **Separate from `PROFILE_KEY`** — that one's read-only (`get-profile.js`), this one can rewrite your whole dashboard doc, so it's rotatable independently if it ever leaks. |

`FIREBASE_SERVICE_ACCOUNT_B64` (or the local `service-account.json` fallback)
is required the same way every other function needs it — already configured.

## The three endpoints

### `GET /.netlify/functions/dashboard-context`
Auth: `x-gpt-key: <GPT_BRIDGE_KEY>` header, or `?key=<GPT_BRIDGE_KEY>`.
Returns the full dashboard context as JSON — open tasks, habits (with
today's status), today's events + calendar (yours and Julia's), budget/spend,
projects, accounts, goals, profile notes, overdue tasks, weekly habit/spend
trends, RDO today/tomorrow, packages in transit, upcoming reminders.

### `POST /.netlify/functions/dashboard-actions`
Auth: same as above. Body:
```json
{ "actions": [ { "type": "add_task", "name": "...", "due": "YYYY-MM-DD" } ] }
```
Applies each action, saves to Firestore, runs any Apple Calendar side effects,
returns `{ "ok": true, "applied": ["Added task: ..."], "spendingAlert": null }`.

### `POST /.netlify/functions/finance-query`
Auth: same as above. Body:
```json
{ "tool": "get_investment_holdings", "args": {} }
```
Runs the exact same read-only financial tools dashboard chat's tool-calling
loop already uses (`finance-tools.mjs`'s `executeTool()`, via `chat.mjs`) —
this is the actual "full finance toolkit" access, not the lightweight
`investmentsSummary` field in `dashboard-context`'s response (that one's
deliberately just top-5-by-value, no shares/cost-basis — see
`dashboard-lib.js`'s comment on why). Available tools:

- `get_accounts {type?, institution?, includeClosed?}`
- `get_transactions {startDate?, endDate?, category?, account?, limit?}`
- `get_spending_summary {startDate?, endDate?, groupBy?}` — category/merchant/account/week/month totals
- `get_cash_flow_summary {startDate?, endDate?}`
- `get_recurring_transactions {}` — detected subscriptions/bills
- `get_liabilities {}` — credit/debt balances (APR/due dates always null, not tracked)
- `get_investment_holdings {}` — real positions (ticker, quantity, value, cost basis, gain/loss) for Schwab/Robinhood; balance-only for other investment accounts
- `get_investment_transactions {}` — always empty, not tracked (Investments Transactions product not linked, on purpose — cost)
- `get_watchlist_quotes {}` — live price/day-change for every ticker on the dashboard watchlist (tickers Dan's tracking, not owned positions — separate from `get_investment_holdings`). Real-time via Finnhub, not cached.
- `get_net_worth_history {days?}`
- `detect_transaction_anomalies {}` — statistical outliers, never asserts fraud

**Action types** (identical to what Telegram JARVIS already uses internally —
see `buildSystemPrompt`'s "AVAILABLE ACTIONS" block in `telegram.js` for the
canonical list):

```
add_task {name, due}
update_task {id, name, due, newName}
complete_task {id, name}
delete_task {id, name}
log_habit {id, name}
add_event {name, time, date}
add_calendar_event {title, date, time, end_time, all_day, location, note, recurrence, calendar}
update_calendar_event {event_id, title, date, time, end_time, location, note}
delete_calendar_event {event_id, title}
add_transaction {name, amount, category, transactionType}
set_intention {text}
add_project {emoji, name, stage, nextAction}
update_project_stage {id, name, stage}
update_project_next_action {id, name, nextAction}
save_memory {text}
update_profile {text}
add_note {text}
add_reminder {text, date, time, recurrence}
cancel_reminder {id, text}
```

## Setting up the Custom GPT (do this in the ChatGPT app)

1. **Create a Custom GPT** (ChatGPT → Explore GPTs → Create).
2. **Paste these Instructions:**

   > You are Dan's personal dashboard assistant. Three tools:
   > `getDashboardContext` (read state — tasks, habits, calendar, budget,
   > projects, goals, notes, reminders, a lightweight investments summary),
   > `postDashboardActions` (write), `postFinanceQuery` (deep financial
   > detail — 11 tool names listed in that Action's own schema).
   >
   > Call `getDashboardContext` for current state. Call `postFinanceQuery`
   > for anything beyond basic numbers — share counts, cost basis,
   > subscriptions, anomalies, net worth trend. getDashboardContext's
   > investment summary is top-5-by-value only, no shares/cost-basis — never
   > guess that detail, call `get_investment_holdings` via postFinanceQuery
   > instead.
   >
   > When Dan asks you to change something, **just do it via
   > `postDashboardActions` — never ask for confirmation first** (except the
   > two calendar cases below). Report what you did after the fact, not
   > before. Use exact IDs from context when updating/completing/deleting;
   > match by name only if no ID exists. Resolve relative dates against the
   > `today` field — never guess. Short, direct replies, no filler.
   >
   > Every action needs one of these exact `type` values/fields — don't
   > invent others:
   > ```
   > add_task {name, due}
   > update_task {id, name, due, newName}
   > complete_task {id, name}
   > delete_task {id, name}
   > log_habit {id, name}
   > add_event {name, time, date}
   > add_calendar_event {title, date, time, end_time, all_day, location, note, recurrence, calendar}
   > update_calendar_event {event_id, title, date, time, end_time, location, note}
   > delete_calendar_event {event_id, title, occurrence_date, delete_series}
   > add_transaction {name, amount, category, transactionType}
   > set_intention {text}
   > add_project {emoji, name, stage, nextAction}
   > update_project_stage {id, name, stage}
   > update_project_next_action {id, name, nextAction}
   > save_memory {text}
   > update_profile {text}
   > add_note {text}
   > add_reminder {text, date, time, recurrence}
   > cancel_reminder {id, text}
   > ```
   > If `applied` is empty or has a "Warning:" entry, the action failed —
   > say so, don't report success.
   >
   > WHICH CALENDAR (ask, don't guess): `calendar` must be exactly one of
   > Shared D+J, Dan's Calendar, Dan's Work Calendar, Julia's Calendar, Home,
   > Work, Personal Private, Stock Events. Use it if Dan said/implied one;
   > otherwise ask a lettered list (A-H, same order) before creating. Skip →
   > defaults to Shared D+J.
   >
   > DELETING a calendar event: confirm "Want me to delete [event]?" first —
   > destructive. Every other action type executes immediately.
   >
   > RECURRING EVENTS: repeats share one `[id:...]` across every date shown
   > — the id alone can't tell "this Saturday" from "every Saturday". One
   > date: `event_id` + `occurrence_date`. Whole series: `delete_series:true`
   > (only if Dan says "all"/"every one"/"stop repeating"). Ambiguous → ask.
   > Rescheduling one occurrence isn't supported — `update_calendar_event`
   > errors on date/time changes to a recurring event; say so honestly,
   > workaround is delete that occurrence + add a new one-off event.
   > Title/location/note edits on a recurring event still work fine (whole
   > series).

3. **Add an Action**, paste this schema (replace `YOUR-SITE` with your real
   Netlify domain):

   JSON parses far more reliably than YAML when pasted through ChatGPT's
   schema box (whitespace-sensitive indentation tends to get mangled on
   copy-paste). ChatGPT's current validator also specifically requires
   `openapi: 3.1.x` — 3.0.x gets rejected outright. `x-openai-isConsequential:
   false` on the POST operation is required too, or ChatGPT auto-flags every
   write as needing a manual "Allow" click per call — exactly the
   babying this was built to avoid:

   ```json
   {
     "openapi": "3.1.1",
     "info": { "title": "Dan's Dashboard Bridge", "version": "1.0.0" },
     "servers": [{ "url": "https://dn2dashboard.netlify.app/.netlify/functions" }],
     "paths": {
       "/dashboard-context": {
         "get": {
           "operationId": "getDashboardContext",
           "summary": "Read Dan's full dashboard state",
           "responses": {
             "200": {
               "description": "Dashboard context",
               "content": { "application/json": { "schema": { "type": "object", "properties": {}, "additionalProperties": true } } }
             }
           }
         }
       },
       "/dashboard-actions": {
         "post": {
           "operationId": "postDashboardActions",
           "summary": "Apply one or more write actions to Dan's dashboard",
           "x-openai-isConsequential": false,
           "requestBody": {
             "required": true,
             "content": {
               "application/json": {
                 "schema": {
                   "type": "object",
                   "required": ["actions"],
                   "properties": {
                     "actions": {
                       "type": "array",
                       "items": {
                         "type": "object",
                         "required": ["type"],
                         "properties": { "type": { "type": "string" } },
                         "additionalProperties": true
                       }
                     }
                   }
                 }
               }
             }
           },
           "responses": {
             "200": {
               "description": "Result of applying the actions",
               "content": { "application/json": { "schema": { "type": "object", "properties": {}, "additionalProperties": true } } }
             }
           }
         }
       },
       "/finance-query": {
         "post": {
           "operationId": "postFinanceQuery",
           "summary": "Run a read-only financial tool (transactions, spending, holdings, liabilities, net worth, anomalies)",
           "x-openai-isConsequential": false,
           "requestBody": {
             "required": true,
             "content": {
               "application/json": {
                 "schema": {
                   "type": "object",
                   "required": ["tool"],
                   "properties": {
                     "tool": {
                       "type": "string",
                       "enum": ["get_accounts", "get_transactions", "get_spending_summary", "get_cash_flow_summary", "get_recurring_transactions", "get_liabilities", "get_investment_holdings", "get_investment_transactions", "get_watchlist_quotes", "get_net_worth_history", "detect_transaction_anomalies"],
                       "description": "get_accounts: balances by type. get_transactions: individual charges in a date range. get_spending_summary: totals by category/merchant/account/week/month. get_cash_flow_summary: income vs spending. get_recurring_transactions: detected subscriptions. get_liabilities: credit/debt balances. get_investment_holdings: real positions — ticker, shares, cost basis, gain/loss. get_investment_transactions: always empty, not tracked. get_watchlist_quotes: live price/day-change for tickers on Dan's watchlist (tracked, not owned — separate from get_investment_holdings). get_net_worth_history: net worth over time. detect_transaction_anomalies: statistically unusual charges."
                     },
                     "args": { "type": "object", "additionalProperties": true, "description": "Tool-specific filters, e.g. {startDate, endDate} for date-ranged tools. Omit for tools that take none." }
                   }
                 }
               }
             }
           },
           "responses": {
             "200": {
               "description": "The tool's result",
               "content": { "application/json": { "schema": { "type": "object", "properties": {}, "additionalProperties": true } } }
             }
           }
         }
       }
     }
   }
   ```

4. **Set Authentication** on the Action: click the gear icon next to
   Authentication → **Authentication Type: API Key** → **Auth Type: Custom**
   (not Bearer — Bearer sends a different header ChatGPT's own `Authorization`
   scheme, our endpoints check a literal `x-gpt-key` header) → **Custom Header
   Name: `x-gpt-key`** → **API Key**: your `GPT_BRIDGE_KEY` from `.env`.
5. Save (do this after every meaningful step — an unsaved Custom GPT can lose
   in-progress changes on navigation). Test it: "what's on my plate today?"
   should call `getDashboardContext`; "log that I hit the gym" should call
   `postDashboardActions` silently and just confirm afterward.

## Security note

`GPT_BRIDGE_KEY` can rewrite your entire dashboard document — same trust
level as the Telegram bot has. It only ever needs to live in the Custom GPT's
Action auth config (stored by OpenAI, sent as a header on each call) — never
paste it anywhere else. If it ever leaks, rotate it by changing `GPT_BRIDGE_KEY`
in `.env`/Netlify env vars and re-entering the new value in the GPT's Action
auth config.

## Known gap (not fixed here)

`save_note`'s action handler reports success but doesn't actually persist
anywhere — `obsidian.js` is `require`d in `telegram.js` but never called.
This was already true before this change; the bridge just inherits it. Worth
a separate fix.
