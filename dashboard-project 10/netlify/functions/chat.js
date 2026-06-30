const https = require('https');

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
- Only ask a follow-up question if you can directly act on the answer using one of your available actions. "Want me to add that to your task list?" is valid — you can add it. "Have you done your habits yet?" is not — you can't do anything with a yes or no unless they explicitly ask you to log one. If you can't act on the answer, don't ask the question.
- Suggest what he should focus on next based on context — overdue tasks, today's schedule gaps, habits not yet logged.
- When he completes something, acknowledge it and prompt what's next.
- If his question is vague, make a reasonable assumption and state it, then ask if he wants something different.
- Use light personality — a dry observation, a brief note of encouragement — but keep it quick. He's busy.

RESPONSE FORMAT:
Respond ONLY with a valid JSON object — no markdown, no extra text, just raw JSON:
{
  "reply": "your response here",
  "actions": []
}

Replies can be as long as needed. Use \\n for line breaks when listing multiple items.

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
- If nothing actionable, return empty actions array
- ALWAYS ask for missing required info before creating anything — do not guess:
  - add_task: if no due date given, ask "When is this due?" before creating it
  - add_project: if no stage given, ask what stage it's at before creating it
  - add_event: if no date or time given, ask before creating it
  - Only proceed to create once the user has confirmed the key details
- For projects, use these stages precisely:
  planning = still deciding what to do
  sourcing = actively researching, ordering, or designing
  building = hands-on work is actively happening
  blocked = waiting on parts, waiting on someone, or otherwise stalled — use this whenever something is holding the project up
  done = complete
- Never repeat information already given in this conversation. Build on prior context — don't re-summarize the task list or schedule if you just covered it. Reference earlier answers briefly if needed ("as I mentioned…") and move forward.`;
}

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ reply: 'Add ANTHROPIC_API_KEY to your Netlify environment variables to enable the AI assistant.', actions: [] })
    };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { message, context, history = [] } = body;
  const systemPrompt = buildSystemPrompt(context);

  // Keep last 20 messages (10 exchanges) to avoid token bloat
  const trimmed = history.slice(-20);
  const messages = [...trimmed, { role: 'user', content: message }];

  const requestBody = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: systemPrompt,
    messages
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(requestBody)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const apiResponse = JSON.parse(data);
          if (apiResponse.error) {
            resolve({
              statusCode: 200, headers: corsHeaders,
              body: JSON.stringify({ reply: `API error: ${apiResponse.error.message}`, actions: [] })
            });
            return;
          }
          const text = apiResponse.content[0].text;
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error('No JSON in response');
          const result = JSON.parse(jsonMatch[0]);
          resolve({
            statusCode: 200, headers: corsHeaders,
            body: JSON.stringify({ reply: result.reply || 'Done!', actions: result.actions || [] })
          });
        } catch (e) {
          resolve({
            statusCode: 200, headers: corsHeaders,
            body: JSON.stringify({ reply: "I had trouble with that one. Try rephrasing?", actions: [] })
          });
        }
      });
    });

    req.on('error', () => resolve({
      statusCode: 200, headers: corsHeaders,
      body: JSON.stringify({ reply: 'Connection error. Please try again.', actions: [] })
    }));

    req.write(requestBody);
    req.end();
  });
};
