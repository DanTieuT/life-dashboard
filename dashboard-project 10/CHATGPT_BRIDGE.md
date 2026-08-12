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

## The two endpoints

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

   > You are Dan's personal dashboard assistant. You have two tools:
   > `getDashboardContext` (read everything — tasks, habits, calendar, budget,
   > projects, goals, notes, reminders) and `postDashboardActions` (write —
   > add/update/complete/delete tasks, log habits, add transactions, manage
   > calendar events, projects, goals, reminders, memory).
   >
   > Call `getDashboardContext` whenever you need current state to answer a
   > question or decide what action to take. When Dan asks you to change
   > something, **just do it via `postDashboardActions` — never ask for
   > confirmation first.** Report back briefly what you did after the fact,
   > not before. Use exact IDs from the context when updating/completing/
   > deleting existing items; match by name only when no ID is available.
   > Resolve relative dates ("tomorrow", "next Thursday") against the `today`
   > field in the context — never guess. Keep replies short and direct, no
   > filler.

3. **Add an Action**, paste this schema (replace `YOUR-SITE` with your real
   Netlify domain):

   ```yaml
   openapi: 3.1.0
   info:
     title: Dan's Dashboard Bridge
     version: 1.0.0
   servers:
     - url: https://YOUR-SITE.netlify.app/.netlify/functions
   paths:
     /dashboard-context:
       get:
         operationId: getDashboardContext
         summary: Read Dan's full dashboard state
         responses:
           "200":
             description: Dashboard context
             content:
               application/json:
                 schema: { type: object }
     /dashboard-actions:
       post:
         operationId: postDashboardActions
         summary: Apply one or more write actions to Dan's dashboard
         requestBody:
           required: true
           content:
             application/json:
               schema:
                 type: object
                 required: [actions]
                 properties:
                   actions:
                     type: array
                     items:
                       type: object
                       required: [type]
                       properties:
                         type: { type: string }
                       additionalProperties: true
         responses:
           "200":
             description: Result of applying the actions
             content:
               application/json:
                 schema: { type: object }
   components:
     securitySchemes:
       apiKeyAuth:
         type: apiKey
         in: header
         name: x-gpt-key
   security:
     - apiKeyAuth: []
   ```

4. **Set Authentication** on the Action to **API Key**, header name `x-gpt-key`,
   value = your `GPT_BRIDGE_KEY` from `.env`.
5. Save. Test it: "what's on my plate today?" should call
   `getDashboardContext`; "log that I hit the gym" should call
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
