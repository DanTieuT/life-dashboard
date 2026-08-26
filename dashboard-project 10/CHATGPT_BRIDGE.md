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
- `get_transactions {startDate?, endDate?, category?, merchant?, accountIds?, limit?}` — `accountIds` takes account `id` values from `get_accounts`, not a name; `merchant` is a case-insensitive substring match on the transaction name and is usually the fastest way to isolate one institution's activity without worrying about the default 50 / max 200 result cap.
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
log_contribution {goalId, name, amount, date}
```

`log_contribution` is for money moved into something tracked as a goal that
Plaid can't see — Roth IRA / brokerage transfers, an envelope-style savings
goal, anything where the goal card is marked "contribution-tracked" in
`dashboard-context`'s response (`trackContributions: true`) rather than
linked to a live account balance. It appends `{amount, date}` to that goal's
`contributions` array; the goal's `current` is then the sum of contributions
in the current calendar year (resets to 0 every Jan 1 automatically — no
action needed). Never use `add_transaction` for this — a transfer into a
retirement/brokerage account isn't spending, and it's exactly the category
Plaid drops at ingestion (see the "Known gap" investigated 2026-08-25 in
memory — the reason this action exists at all). Match the goal by `goalId`
from `dashboard-context`'s `goals` list, or by `name` if no id is given.

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
   > log_contribution {goalId, name, amount, date}
   > ```
   > If `applied` is empty or has a "Warning:" entry, the action failed —
   > say so, don't report success.
   >
   > add_event vs add_calendar_event: **always use add_calendar_event** for
   > anything Dan wants "on the calendar" — it's the one that actually writes
   > to his Apple Calendar and it's what triggers the WHICH CALENDAR question
   > below. add_event is a legacy dashboard-only stub with no calendar field
   > — it never touches Apple Calendar and never asks which calendar, so
   > using it silently skips that question. Don't use it.
   >
   > CONTRIBUTIONS: when Dan says he contributed/deposited/put money toward a
   > goal ("log $793 to my Roth"), use log_contribution against the matching
   > goal from getDashboardContext's goals list — never add_transaction.
   > Only works for goals marked contribution-tracked (trackContributions:
   > true); those track logged amounts, not a linked account balance, and
   > reset to $0 every Jan 1 on their own. If nothing matches, say so and
   > suggest Dan create the goal on the dashboard first.
   >
   > WHICH CALENDAR (ask, don't guess): `calendar` must be exactly one of
   > Shared D+J, Dan's Calendar, Dan's Work Calendar, Julia's Calendar, Home,
   > Work, Personal Private, Stock Events. Only skip the question if Dan
   > named one of those eight explicitly (or said something that maps to
   > exactly one, like "work calendar" or "Julia's calendar") — generic
   > phrasing like "my calendar," "the calendar," or "add an event" is NOT a
   > named calendar, even though "Dan's Calendar" is also one of the eight;
   > treat those as unspecified and ask. Ask using this exact list, all
   > eight lines every time, verbatim — do not shorten it or drop any
   > option even if one seems unlikely (e.g. Stock Events):
   > "Which calendar?
   > A) Shared D+J
   > B) Dan's Calendar
   > C) Dan's Work Calendar
   > D) Julia's Calendar
   > E) Home
   > F) Work
   > G) Personal Private
   > H) Stock Events"
   > Skip (Dan doesn't answer) → defaults to Shared D+J.
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
   >
   > PODCAST MODE: when Dan asks for "a podcast" / "my podcast" / "the daily
   > podcast" (however phrased), always use this exact structure — same
   > shape every time, ~1,000-1,400 words (7-10 min read aloud). Before
   > writing, call `getDashboardContext` and `postFinanceQuery` with
   > `get_watchlist_quotes` — pull real numbers, never invent one. Use web
   > search for news on watchlist movers and for the headlines segment.
   >
   > 1. Cold open (10-15 sec) — casual greeting, today's date, one-line
   >    teaser of what's coming.
   > 2. The Day Ahead — today's calendar events and open/due tasks from
   >    `getDashboardContext`; skip cleanly if nothing's on it, don't pad.
   > 3. Money Check — budget pace this month via `postFinanceQuery`
   >    (`get_spending_summary` or `get_cash_flow_summary`); one or two
   >    honest sentences, not a full ledger read.
   > 4. Watchlist — `get_watchlist_quotes` for every ticker, plus a web
   >    search for why any mover moved; skip a ticker's news if nothing
   >    notable turned up rather than manufacturing a reason.
   > 5. Headlines — 2-3 stories via web search Dan would actually care
   >    about (tech, cars, whatever fits his profile) — not generic wire copy.
   > 6. Sign-off — one line, wrap it up, no re-summary.
   >
   > Write it as spoken word for TTS: full sentences, natural verbal
   > transitions between segments ("next up", "meanwhile"), first person
   > address to Dan ("you"). No markdown, no bullet points, no headers, no
   > "as an AI" hedging in the actual script text. If a whole segment has
   > nothing to report (e.g. empty watchlist, no events today), say so in
   > one line and move on — never invent content to fill it.

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
