// Dashboard chat — Netlify Functions 2.0 streaming version (#23).
// Streams Anthropic SSE deltas through to the client as text/event-stream.
// Protocol: the model writes the reply as PLAIN TEXT first; if it has actions
// it appends a line "<<<ACTIONS>>>" followed by a JSON array. The client shows
// tokens live and parses actions after the marker when the stream ends.
// The client falls back to plain JSON parsing if the response isn't a stream.

function buildSystemPrompt(ctx) {
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
${weatherLine}

ACTIVE TASKS:
${taskList}

HABITS:
${habitList}

TODAY'S SCHEDULE:
${eventList}

FINANCE (${ctx.monthName}): $${ctx.spent} spent of $${ctx.budget} budget

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

RULES:
- Use exact IDs from the task/habit/project lists above when referencing them
- Parse dates relative to today (${ctx.today}): "tomorrow", "Friday", "next week", etc.
- Can return multiple actions at once
- ALWAYS ask for missing required info before creating anything — do not guess:
  - add_task: if no due date given, ask "When is this due?" before creating it
  - add_project: if no stage given, ask what stage it's at before creating it
  - add_event: if no date or time given, ask before creating it
  - Only proceed to create once the user has confirmed the key details
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
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (obj) => new Response(JSON.stringify(obj), {
  status: 200,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonResponse({ reply: 'Add ANTHROPIC_API_KEY to your Netlify environment variables to enable the AI assistant.', actions: [] });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const { message, context: ctx, history = [] } = body;
  const systemPrompt = buildSystemPrompt(ctx || { tasks: [], habits: [], events: [], projects: [] });
  const messages = [...history.slice(-20), { role: 'user', content: message }];

  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: systemPrompt,
        messages,
        stream: true,
      }),
    });
  } catch (e) {
    return jsonResponse({ reply: 'Connection error. Please try again.', actions: [] });
  }

  if (!upstream.ok || !upstream.body) {
    let msg = 'API error';
    try { const err = await upstream.json(); msg = `API error: ${err.error?.message || upstream.status}`; } catch {}
    return jsonResponse({ reply: msg, actions: [] });
  }

  // Pipe Anthropic's SSE through as simplified SSE: data:{"text":"..."} ... data:{"done":true}
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();

  const stream = new ReadableStream({
    async start(controller) {
      let buf = '';
      try {
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
              try {
                const evt = JSON.parse(payload);
                if (evt.type === 'content_block_delta' && evt.delta?.text) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: evt.delta.text })}\n\n`));
                } else if (evt.type === 'error') {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: '\n[stream error: ' + (evt.error?.message || 'unknown') + ']' })}\n\n`));
                }
              } catch {}
            }
          }
        }
        controller.enqueue(encoder.encode('data: {"done":true}\n\n'));
      } catch (e) {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: '\n[connection interrupted]' })}\n\n`)); } catch {}
      } finally {
        controller.close();
      }
    },
    cancel() { try { reader.cancel(); } catch {} },
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
