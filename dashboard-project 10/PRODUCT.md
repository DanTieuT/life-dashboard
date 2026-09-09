# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

<!-- Mobile-primary: used mostly as an installed PWA on iPhone. Mobile web is still `web`. -->

## Users

Single user — Dan, the owner. There is one authorized account; every function
verifies the caller's Firebase uid against that one user and refuses anyone
else. No multi-user, sharing, or team surface exists or is planned.

Situation: used **throughout the day, on the phone, in short bursts** — check
off a task, log a habit, glance at a balance, add something, see what's next.
Many brief one-handed sessions rather than one long desk session. A laptop is
used occasionally for heavier review (finance reconciliation, project
planning) but the phone is the design target.

## Product Purpose

A personal life dashboard that pulls a scattered life into one place: money,
tasks, projects, calendar, habits, and package tracking, so none of it has to
live in six separate apps. Success is that Dan opens one app to know where he
stands and what's next, and rarely needs another.

## Positioning

**Integration is the bet.** Neighboring tools each own one slice — a finance
app, a to-do app, a calendar, a habit tracker. This product's value is that
the slices sit together and share context: the same schedule feeds the
dashboard, the briefing, and the RDO nudge; the same budget number feeds the
finance tab, the dashboard money hero, and JARVIS. A generic tool cannot copy
that without becoming the same all-in-one.

Secondary: **JARVIS**, a Claude-powered assistant reachable from the dashboard
chat panel, Telegram, and a ChatGPT bridge, all running the same shared action
logic so an action taken in one place is available everywhere.

## Operating Context

- Runs as an installed PWA (standalone display) on iPhone; also opens in a
  desktop browser.
- Bank data via Plaid (balances, transactions, investment holdings), synced by
  scheduled Netlify functions plus webhooks.
- Calendar via CalDAV / iCal feeds, synced every 5 minutes; includes a
  partner's ("Julia") events as a toggleable overlay.
- Push notifications via `web-push`: a 7am briefing, a 6pm RDO nudge (only
  fires when tomorrow is a day off on the government RDO schedule), a Sunday
  weekly review, reminder delivery, and shipping updates.
- JARVIS assistant: dashboard chat panel (SSE-streamed from a Netlify
  function), a Telegram bot, and a ChatGPT Custom GPT bridge — shared action
  logic in `dashboard-lib.js`.
- Government RDO (regular day off) work schedule is a first-class input:
  features branch on whether a given day is an RDO.

## Capabilities and Constraints

Current features (all must survive the redesign — this is a visual redesign,
not a product change):

- **Dashboard tab:** money hero (net worth graph + budget), today's schedule,
  top 3 focus tasks, projects widget, habit tracker, recent JARVIS
  conversations.
- **Tasks tab:** search, filter (all / active / done), add, complete,
  swipe-to-edit / swipe-to-delete, long-press reorder, today vs. upcoming
  sections.
- **Finance tab:** net worth chart with range selection and allocation
  breakdown, monthly budget with per-category tracking and pace, next-payday
  bar, runway, credit-card balances and due dates, sinking funds, transaction
  list with categorization, linked accounts, card-rewards, CSV export,
  transaction anomaly detection surfaced through JARVIS.
- **Projects tab:** project cards with status, priority, progress, milestones,
  and linked tasks; filters; archive.
- **Calendar tab:** full-width month and week views, event creation, the Julia
  overlay.
- Light and dark themes; a bottom tab bar on mobile, a top nav on desktop.

Technical constraints (evidenced by the codebase, to be preserved):

- **No framework, no build step.** Plain ES modules (`<script type="module">`),
  one `styles.css`, one `index.html`. Netlify build command is a no-op
  (`true`); it deploys as static files. No React/Vue/Svelte, no bundler.
- Backend is Netlify Functions (Node) + Firebase (Firestore) for the single
  user's data; `firebase-admin`, `web-push`, `ical.js`, `rrule`, `tsdav` are
  the only runtime deps.
- Auth is Google sign-in → Firebase ID token → uid allow-list of one.
- Convention, stated in the repo: **"don't rebuild what works"** — extend the
  existing chat/assistant and existing patterns rather than adding parallel
  systems.
- JARVIS action logic is shared across three surfaces; a dashboard change that
  alters an action must keep Telegram and the ChatGPT bridge working.

## Brand Commitments

- Name in use: "Dashboard" (PWA manifest `name` / `short_name`); the assistant
  is "JARVIS"; the auth screen currently reads "command center — Your personal
  life dashboard".
- Voice (assistant, established in code): direct, concise, no fluff, talks like
  a knowledgeable friend; never affirmatively claims a charge is fraud, only
  flags it.
- Icon: a green gem/diamond mark (`icon.svg`, `icon-192/512.png`,
  `apple-touch-icon.png`).
- No other binding identity constraints were set. The visual world is open and
  is decided in new-work, not here. (A warm editorial direction has been
  explored in mockups but is not yet committed.)

## Evidence on Hand

- Full working codebase: `index.html`, `styles.css`, `js/*.js`,
  `netlify/functions/*`.
- Product/feature docs in-repo: `AI_ASSISTANT.md`, `CHATGPT_BRIDGE.md`.
- Redesign mockups (not shipped): `design-canvas/` — five editorial-direction
  iPhone screens plus `tokens.css`.
- A live profile/goals feed for Dan is fetched at runtime from a Netlify
  function (`get-profile`), referenced by the root `CLAUDE.md`.
- No customers, testimonials, revenue, pricing, or public launch — this is a
  personal tool. Future work must not fabricate any.

## Product Principles

1. **One place, not six.** Every feature added must connect to the others; a
   siloed feature that could be its own app doesn't belong here.
2. **Built for the phone, in passing.** The default interaction is one-handed,
   a few seconds long. Depth is allowed but must not tax the quick path.
3. **The schedule and the RDO are inputs, not just views.** Features should
   react to what today actually is.
4. **Don't rebuild what works.** Extend existing patterns and the existing
   assistant rather than adding parallel systems.
5. **Single-user forever.** No sharing, permissions, or collaboration weight —
   simplicity is a feature of being one person's tool.

## Accessibility & Inclusion

No formal standard was set. Practical needs from the usage context: legible
one-handed on a phone outdoors, honors the OS reduced-motion and (target)
reduced-transparency / contrast settings, and both light and dark themes stay
first-class.
