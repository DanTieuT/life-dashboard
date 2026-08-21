// Dashboard chat — Netlify Functions 2.0 streaming version (#23), extended
// with read-only financial tool-calling (see finance-tools.mjs).
//
// Flow: client message -> this endpoint -> Claude (Messages API, streaming,
// with `tools`) -> model may request one or more financial tools -> we
// execute them against the user's own Firestore data -> results go back to
// the model as tool_result blocks -> loop until the model has no more tool
// calls -> final text is streamed to the client throughout.
//
// Two independent data sources feed the model, on purpose:
// - `ctx` (tasks/habits/events/weather/projects/budget summary) is supplied
//   by the client, unchanged from before — small, non-financial, already
//   trusted by the existing app.
// - `appData` (accounts/transactions/netWorthHistory) is fetched HERE,
//   server-side, from Firestore — the model never receives it directly, only
//   the specific sanitized result of whichever tool it calls. This keeps
//   raw transaction/account data off the wire to Anthropic except for the
//   minimal slice each tool call actually needs.
//
// Protocol for the final text (unchanged): plain text, optionally followed
// by a line "<<<ACTIONS>>>" and a JSON array of write actions the client
// applies locally. Tool calls are a *separate*, read-only mechanism — the
// model can look at financial data via tools without that ever becoming a
// client-side action.
import admin from 'firebase-admin';
import { createRequire } from 'module';
import { TOOL_SCHEMAS, executeTool } from './finance-tools.mjs';

const require = createRequire(import.meta.url);

// This app has exactly one user — every scheduled function and this endpoint
// operate on the same Firestore doc. Firebase Auth (verified below) confirms
// the request really came from Dan's signed-in browser session; there is no
// multi-tenant authorization model here because there is only one tenant.
const USER_UID = 'aqzJe5gq4IVYdKmUIW0pNJGL2ML2';
// Provider is Anthropic, not OpenAI — see AI_ASSISTANT.md for why. ANTHROPIC_MODEL
// is the one env var that controls it; there is no OPENAI_MODEL in this app.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const MAX_TOOL_ROUNDS = 6;
const UPSTREAM_TIMEOUT_MS = 30_000;
const MAX_MESSAGE_LEN = 8_000;
const MAX_HISTORY_TURNS = 20;

function initFirebase() {
  if (admin.apps.length > 0) return;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_B64
    ? JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString())
    : require('./service-account.json');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

// `verifyIdTokenFn`/`firestoreGetFn` default to the real Firebase Admin calls
// but are overridable — this is the whole seam tests use to exercise auth
// and data-loading logic without a real Firebase project or a module-mocking
// library (none is a dependency of this project). Production callers below
// never pass these; only test/chat-handler.test.mjs does.
const defaultVerifyIdToken = (token) => { initFirebase(); return admin.auth().verifyIdToken(token); };
const defaultFirestoreGet = () => { initFirebase(); return admin.firestore().doc(`users/${USER_UID}/data/main`).get(); };

export function parseBearerToken(authHeaderValue) {
  const m = /^Bearer (.+)$/.exec(authHeaderValue || '');
  return m ? m[1] : null;
}

export async function loadAppData(firestoreGetFn = defaultFirestoreGet) {
  const snap = await firestoreGetFn();
  return snap.exists ? snap.data() : {};
}

// Verifies the request actually came from Dan's signed-in Firebase session.
// Returns the decoded token on success, or null on any failure — callers
// respond 401 rather than throwing, so a bad/missing token never takes down
// the function or leaks a stack trace.
export async function verifyAuth(req, verifyIdTokenFn = defaultVerifyIdToken) {
  const token = parseBearerToken(req.headers.get('authorization'));
  if (!token) return null;
  try {
    const decoded = await verifyIdTokenFn(token);
    return decoded.uid === USER_UID ? decoded : null;
  } catch {
    return null;
  }
}

// Best-effort per-process rate limit. Serverless containers are ephemeral —
// this resets on cold start and isn't shared across instances, so it is NOT
// a real distributed rate limiter. The actual protection against abuse is
// the auth check above; this just softens accidental rapid-fire retries.
// See AI_ASSISTANT.md "Known limitations".
const _rateWindow = { count: 0, windowStart: 0 };
export function _resetRateLimitForTests() { _rateWindow.count = 0; _rateWindow.windowStart = 0; }
export function rateLimited() {
  const now = Date.now();
  if (now - _rateWindow.windowStart > 60_000) { _rateWindow.windowStart = now; _rateWindow.count = 0; }
  _rateWindow.count++;
  return _rateWindow.count > 30; // 30 requests/minute is generous for a single user
}

export function buildSystemPrompt(ctx) {
  const taskList = ctx.tasks.length
    ? ctx.tasks.map(t => `  [${t.id}] "${t.name}"${t.due ? ` due:${t.due}` : ''}`).join('\n')
    : '  (none)';
  const habitList = ctx.habits.length
    ? ctx.habits.map(h => `  [${h.id}] "${h.name}" (${h.type})`).join('\n')
    : '  (none)';
  const eventList = ctx.events.length
    ? ctx.events.map(e => `  ${e.time} – ${e.name}`).join('\n')
    : '  (none)';
  const projectList = (ctx.projects || []).length
    ? ctx.projects.map(p => `  [${p.id}] ${p.emoji} "${p.name}" [${p.stage}]${p.nextAction ? ` → ${p.nextAction}` : ''}`).join('\n')
    : '  (none)';

  const weatherLine = ctx.weather
    ? `WEATHER: ${ctx.weather.temp}°F, feels like ${ctx.weather.feelsLike}°F, ${ctx.weather.description}. Wind: ${ctx.weather.wind} mph.${ctx.weather.rain ? ' Rain expected — recommend jacket/umbrella.' : ''}`
    : 'WEATHER: unavailable';

  return `You are J.A.R.V.I.S. — Dan's personal AI assistant. You have full visibility into his tasks, habits, schedule, finances, projects, and current weather. You are sharp, proactive, and genuinely helpful. You anticipate needs, surface relevant data without being asked, and always look for ways to move things forward.

Today: ${ctx.today} (${ctx.dayName})
Current time: ${ctx.nowTime || ''} Pacific
${weatherLine}
${(ctx.reminders || []).length ? `\nUPCOMING REMINDERS:\n${ctx.reminders.map(r => `  [${r.id}] "${r.text}" — ${r.when}${r.recurrence ? ` (repeats ${r.recurrence})` : ''}`).join('\n')}\n` : ''}
ACTIVE TASKS:
${taskList}

HABITS:
${habitList}

TODAY'S SCHEDULE:
${eventList}

FINANCE (${ctx.monthName}, quick glance only — use the financial tools below for anything specific): $${ctx.spent} spent of $${ctx.budget} budget

PROJECTS (stages: planning/sourcing/building/blocked/done):
${projectList}

PERSONALITY:
- Address Dan by name occasionally. Be warm but efficient — confident, not sycophantic.
- Give substantive responses. Don't truncate useful information. If something is worth saying, say it fully.
- Proactively reference his data when relevant. If he asks how his day looks, give him a real briefing — schedule, pending tasks, habit status. If he mentions spending, cite his budget numbers.
- Only ask a follow-up question if you can directly act on the answer using one of your available actions.
- Suggest what he should focus on next based on context — overdue tasks, today's schedule gaps, habits not yet logged.
- When he completes something, acknowledge it and prompt what's next.
- If his question is vague, make a reasonable assumption and state it, then ask if he wants something different.
- Use light personality — a dry observation, a brief note of encouragement — but keep it quick. He's busy.

RESPONSE FORMAT (IMPORTANT — this response is streamed live to Dan):
Write your reply as PLAIN TEXT — no JSON wrapper, no markdown code fences.
If (and only if) you have actions to perform, after your reply add a line containing exactly:
<<<ACTIONS>>>
followed by a JSON array of action objects on the next line. Example:
Adding that now, Dan.
<<<ACTIONS>>>
[{"type":"add_task","name":"Order brake pads","due":"2026-07-04"}]
If there are no actions, do NOT include the marker.

AVAILABLE ACTIONS (use exact IDs from the lists above):
{"type":"add_task","name":"...","due":"YYYY-MM-DD"}
{"type":"complete_task","id":"<id from task list>"}
{"type":"delete_task","id":"<id from task list>"}
{"type":"log_habit","id":"<id from habit list>"}
{"type":"add_event","name":"...","time":"HH:MM","date":"YYYY-MM-DD"}
{"type":"add_transaction","name":"...","amount":50,"category":"Food","transactionType":"out"}
{"type":"add_transaction","name":"...","amount":1000,"category":"Other","transactionType":"in"}
{"type":"set_intention","text":"..."}
{"type":"add_project","emoji":"🔨","name":"...","stage":"planning","nextAction":"..."}
{"type":"update_project_stage","id":"<id from project list>","stage":"building"}
{"type":"update_project_next_action","id":"<id from project list>","nextAction":"..."}
{"type":"add_reminder","text":"<what to remind Dan about>","date":"YYYY-MM-DD","time":"HH:MM","recurrence":""}
{"type":"cancel_reminder","id":"<id from UPCOMING REMINDERS>"}

FINANCIAL TOOLS (read-only — these never write anything, and are separate from the actions above):
You have get_accounts, get_transactions, get_spending_summary, get_cash_flow_summary, get_recurring_transactions, get_liabilities, get_investment_holdings, get_investment_transactions, get_watchlist_quotes, get_net_worth_history, and detect_transaction_anomalies. Use them instead of guessing whenever Dan asks anything concrete about money — the FINANCE line above is a rough monthly total, not enough to answer a real question. get_watchlist_quotes is for tickers Dan is tracking but doesn't own (separate from get_investment_holdings) — use it for "how's my watchlist doing" / "how's [ticker] moving today" when the ticker is on the watchlist.

FINANCIAL ANALYSIS RULES — follow these strictly whenever you use a financial tool or discuss money:
- Never invent a balance, transaction, category, APR, return, or date that a tool didn't actually return. If a tool says a field is unavailable (null, empty array, or an explicit "note"), say so plainly instead of estimating or guessing.
- Always state the date range a total covers (tools return one — quote it).
- Internal transfers are already excluded from spending/cash-flow tool results — don't re-add them, and don't describe a transfer as spending or income.
- Not every deposit is income. Distinguish payroll-looking deposits from refunds, reimbursements, transfers, and ambiguous ones — get_cash_flow_summary's breakdown is a heuristic, say so if precision matters.
- Credit-card payments are excluded from spending data upstream (the underlying purchases were already counted) — never describe a card payment as new spending.
- Treat pending transactions separately if any tool result includes one; this app currently only stores settled transactions, so this rarely comes up.
- Explain totals in plain language — what's included, what's excluded, and why — not just a number.
- For investment or liability questions, this dashboard only tracks account-level balances, not holdings/APR/due-dates/statement detail. Say that clearly rather than filling the gap with a plausible-sounding guess.
- Never say a flagged transaction "is fraud" or "is fraudulent." detect_transaction_anomalies finds statistical outliers vs. Dan's own history — call them "potentially unusual" and explain the specific reason (e.g. "3.2x your typical Dining charge").
- If a classification would materially change the answer and you can't resolve it from the tool data (e.g. "was this refund reversing a purchase you're also counting as spending?"), ask Dan directly rather than guessing either way.
- Lead with a concise number/summary, then supporting detail if useful. Format currency as $X,XXX and percentages with one decimal place.
- SPARSE DATA: if a specific period (e.g. "last month") comes back with zero or very few transactions, don't just report "no data" — call get_spending_summary or get_transactions again with a wider window (try the last 3 months, then 6 if still thin) before concluding there's nothing to show. Plaid history here only goes back as far as an account has been linked plus a 30-day initial backfill, so genuinely short history is possible — if a 6-month check still comes up empty, say that plainly instead of trying indefinitely. Whichever range you end up using, state it clearly so Dan knows what he's actually looking at.

RULES:
- REMINDERS: when Dan says "remind me to X at/in Y", use add_reminder. Resolve relative times from Current time above ("in 20 minutes", "tonight"≈20:00, "tomorrow morning"≈09:00). recurrence: "" for one-time, or "daily"/"weekdays"/"weekly"/"monthly". If no time given, ask. Reminders fire as Telegram + push notifications — distinct from add_task (a to-do) and add_event (calendar).
- Use exact IDs from the task/habit/project lists above when referencing them
- Parse dates relative to today (${ctx.today}): "tomorrow", "Friday", "next week", etc.
- Can return multiple actions at once
- ALWAYS ask for missing required info before creating anything — do not guess:
  - add_task: if no due date given, ask "When is this due?" (open-ended — dates aren't a small set)
  - add_project: if no stage given, ask which stage — use the lettered list below (planning/sourcing/building/blocked/done are a fixed small set)
  - add_event: if no date or time given, ask before creating it (open-ended)
  - Only proceed to create once the user has confirmed the key details
- CLARIFYING QUESTIONS — multiple choice vs open-ended: whenever you're genuinely unsure, stop and ask instead of guessing — but HOW you ask depends on the shape of the answer:
  - If the valid answers form a small bounded set — which existing task/project/account/event Dan means, which category, which stage, which frequency, priority level, yes/no-with-a-couple-variants, or anything else where you could enumerate every reasonable answer in a few words each — ask as a lettered list, one line per option:
    Which one did you mean?
    A) Renew car registration (due Jul 10)
    B) Renew gym membership (due Jul 14)
    Keep each option short — just enough to tell them apart.
  - If the answer space is genuinely wide open — a due date, an amount, a name/title, a free-text description, "why" or "how" questions — ask a plain open-ended question instead. Don't force a date or a name into A/B/C options.
  - When Dan's next reply is short (a bare letter like "b"/"B", a number, or just the option's key phrase), treat it as answering the lettered question you just asked — match it to the list and immediately proceed with that action. Don't ask him to restate the whole request. If the reply doesn't clearly match any option, ask once more, briefly.
- For projects, use these stages precisely:
  planning = still deciding what to do
  sourcing = actively researching, ordering, or designing
  building = hands-on work is actively happening
  blocked = waiting on parts, waiting on someone, or otherwise stalled
  done = complete
- Never repeat information already given in this conversation. Build on prior context.`;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

// Runs one Claude streaming turn. Forwards text deltas to `onText` live.
// Returns { stopReason, assistantBlocks } where assistantBlocks is the full
// content array (text + tool_use) to append to the conversation.
export async function runOneRound(messages, systemPrompt, apiKey, onText) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        messages,
        tools: TOOL_SCHEMAS,
        stream: true,
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!upstream.ok || !upstream.body) {
    let msg = `API error (${upstream.status})`;
    try { const err = await upstream.json(); msg = `API error: ${err.error?.message || upstream.status}`; } catch {}
    throw new Error(msg);
  }

  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  const blocks = []; // index-aligned with Anthropic's content_block indices
  let stopReason = null;
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) > -1) {
      const rawEvent = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of rawEvent.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let evt;
        try { evt = JSON.parse(payload); } catch { continue; }
        if (evt.type === 'content_block_start') {
          blocks[evt.index] = evt.content_block.type === 'tool_use'
            ? { type: 'tool_use', id: evt.content_block.id, name: evt.content_block.name, jsonBuf: '' }
            : { type: 'text', text: '' };
        } else if (evt.type === 'content_block_delta') {
          const b = blocks[evt.index];
          if (!b) continue;
          if (evt.delta.type === 'text_delta') {
            b.text += evt.delta.text;
            onText(evt.delta.text);
          } else if (evt.delta.type === 'input_json_delta') {
            b.jsonBuf += evt.delta.partial_json;
          }
        } else if (evt.type === 'message_delta' && evt.delta?.stop_reason) {
          stopReason = evt.delta.stop_reason;
        } else if (evt.type === 'error') {
          onText(`\n[stream error: ${evt.error?.message || 'unknown'}]`);
        }
      }
    }
  }

  const assistantBlocks = blocks.filter(Boolean).map((b) => (
    b.type === 'tool_use'
      ? { type: 'tool_use', id: b.id, name: b.name, input: safeParseJSON(b.jsonBuf) }
      : { type: 'text', text: b.text }
  ));
  return { stopReason, assistantBlocks };
}

function safeParseJSON(s) {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonResponse({ reply: 'Add ANTHROPIC_API_KEY to your Netlify environment variables to enable the AI assistant.', actions: [] });
  }

  const auth = await verifyAuth(req);
  if (!auth) return jsonResponse({ reply: 'Sign in again to use the assistant.', actions: [] }, 401);
  if (rateLimited()) return jsonResponse({ reply: 'Slow down a bit — try again in a moment.', actions: [] }, 429);

  let body;
  try { body = await req.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const { message, context: ctx, history = [] } = body;
  if (typeof message !== 'string' || !message.trim()) return jsonResponse({ reply: 'Empty message.', actions: [] }, 400);
  if (message.length > MAX_MESSAGE_LEN) return jsonResponse({ reply: 'Message too long.', actions: [] }, 400);
  if (!Array.isArray(history)) return jsonResponse({ reply: 'Invalid history.', actions: [] }, 400);

  const systemPrompt = buildSystemPrompt(ctx || { tasks: [], habits: [], events: [], projects: [] });
  const messages = [...history.slice(-MAX_HISTORY_TURNS), { role: 'user', content: message }];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch {} };
      let appData = null; // lazily fetched on the first tool call — see loadAppData()
      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const { stopReason, assistantBlocks } = await runOneRound(
            messages,
            systemPrompt,
            apiKey,
            (text) => send({ text }),
          );
          messages.push({ role: 'assistant', content: assistantBlocks });
          const toolUses = assistantBlocks.filter((b) => b.type === 'tool_use');
          if (stopReason !== 'tool_use' || !toolUses.length) break;

          if (!appData) {
            try { appData = await loadAppData(); }
            catch (e) { appData = {}; console.error('[chat] failed to load appData for tool call:', e.message); }
          }
          // No console.log of tool arguments/results anywhere — those can
          // contain real transaction/account data. Tool *names* are safe to
          // log for basic observability.
          console.log('[chat] tool round', round, 'tools:', toolUses.map((t) => t.name).join(','));
          const toolResults = await Promise.all(toolUses.map(async (tu) => ({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(await executeTool(tu.name, tu.input, appData)),
          })));
          messages.push({ role: 'user', content: toolResults });

          if (round === MAX_TOOL_ROUNDS - 1) {
            send({ text: '\n[reached the tool-call limit for this turn — try narrowing the question]' });
          }
        }
        send({ done: true });
      } catch (e) {
        send({ text: `\n[${e.message || 'connection interrupted'}]` });
        send({ done: true });
      } finally {
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
};
