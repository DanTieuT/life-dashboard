const https = require('https');
const admin = require('firebase-admin');

// Force-load .env — netlify dev silently injects a placeholder for some vars
try {
  const fs = require('fs'), path = require('path');
  const envPath = path.resolve(__dirname, '../../.env');
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s]+)=(.+)$/);
    if (m) process.env[m[1]] = m[2].trim(); // always override
  });
  console.log('[env] key starts:', (process.env.ANTHROPIC_API_KEY || 'MISSING').slice(0, 20));
} catch (e) { console.error('[env] fallback error:', e.message); }

// ── Firebase init (once per cold start) ──────────────────────────
function initFirebase() {
  if (admin.apps.length > 0) return;
  let sa;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
    sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString());
  } else {
    sa = require('./service-account.json');
  }
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

// ── Helpers ───────────────────────────────────────────────────────
function post(hostname, path, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', resolve);
    req.write(payload);
    req.end();
  });
}

function sendMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return post('api.telegram.org', `/bot${token}/sendMessage`, { chat_id: chatId, text });
}

function downloadTelegramFile(fileId) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return new Promise((resolve) => {
    // Step 1: get file path
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/getFile?file_id=${fileId}`,
      method: 'GET',
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', async () => {
        try {
          const { result } = JSON.parse(d);
          // Step 2: download actual bytes
          const fileReq = https.request({
            hostname: 'api.telegram.org',
            path: `/file/bot${token}/${result.file_path}`,
            method: 'GET',
          }, (fileRes) => {
            const chunks = [];
            fileRes.on('data', c => chunks.push(c));
            fileRes.on('end', () => resolve(Buffer.concat(chunks)));
          });
          fileReq.on('error', () => resolve(null));
          fileReq.end();
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function transcribeAudio(audioBuffer, mimeType) {
  return new Promise((resolve) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) { resolve(null); return; }
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('webm') ? 'webm' : 'ogg';
    const boundary = '----WB' + Date.now();
    const preamble = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([preamble, audioBuffer, epilogue]);
    const req = https.request({
      hostname: 'api.openai.com', path: '/v1/audio/transcriptions', method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).text || null); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

function callClaudeWithImage(systemPrompt, history, imageBuffer, mimeType, caption) {
  return new Promise((resolve) => {
    const b64 = imageBuffer.toString('base64');
    const userContent = [
      { type: 'image', source: { type: 'base64', media_type: mimeType, data: b64 } },
      { type: 'text', text: caption || 'What do you see in this image? If it is a work schedule or roster, extract every shift date and time and create add_event actions for each shift so they appear on my calendar. Also save_note with the full schedule. If it contains tasks or other info, take appropriate actions.' }
    ];
    // Only include text-only history (no image messages)
    const textHistory = history.slice(-10).filter(m => typeof m.content === 'string');
    const messages = [...textHistory, { role: 'user', content: userContent }];
    const payload = JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4096, system: systemPrompt, messages });
    console.log('Sending image to Claude, payload size:', payload.length);
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          console.log('Claude image response status:', res.statusCode);
          const api = JSON.parse(d);
          if (api.error) { console.error('Claude API error:', api.error); resolve({ reply: 'API error: ' + api.error.message, actions: [] }); return; }
          const text = api.content[0].text;
          console.log('Claude image reply (first 300):', text.slice(0, 300));
          const jsonStr = extractJSON(text);
          if (!jsonStr) { resolve({ reply: text.trim() || 'Done.', actions: [] }); return; }
          const parsed = JSON.parse(jsonStr);
          resolve({ reply: parsed.reply || 'Done.', actions: parsed.actions || [] });
        } catch(e) { console.error('Image parse error:', e.message, d.slice(0,200)); resolve({ reply: 'Had trouble reading that image. Try again.', actions: [] }); }
      });
    });
    req.on('error', (e) => { console.error('Image request error:', e.message); resolve({ reply: 'Could not process the image.', actions: [] }); });
    req.write(payload);
    req.end();
  });
}

function sendPhoto(chatId, pngBuffer, caption) {
  return new Promise((resolve) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const boundary = '----TGBoundary' + Date.now();
    const CRLF = '\r\n';
    const metaPart = Buffer.from(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="chat_id"${CRLF}${CRLF}${chatId}${CRLF}` +
      (caption ? `--${boundary}${CRLF}Content-Disposition: form-data; name="caption"${CRLF}${CRLF}${caption}${CRLF}` : '') +
      `--${boundary}${CRLF}Content-Disposition: form-data; name="photo"; filename="dashboard.png"${CRLF}Content-Type: image/png${CRLF}${CRLF}`
    );
    const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
    const body = Buffer.concat([metaPart, pngBuffer, tail]);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendPhoto`,
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
    }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve);
    req.write(body);
    req.end();
  });
}

// Send a voice note (opus/ogg) via Telegram sendVoice (#25)
function sendVoice(chatId, opusBuffer) {
  return new Promise((resolve, reject) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const boundary = '----TGVoice' + Date.now();
    const CRLF = '\r\n';
    const metaPart = Buffer.from(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="chat_id"${CRLF}${CRLF}${chatId}${CRLF}` +
      `--${boundary}${CRLF}Content-Disposition: form-data; name="voice"; filename="reply.ogg"${CRLF}Content-Type: audio/ogg${CRLF}${CRLF}`
    );
    const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
    const body = Buffer.concat([metaPart, opusBuffer, tail]);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendVoice`,
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
    }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const uidGen = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

// Mirrors js/core.js isRDO() — 9/80 schedule, every-other-Monday RDO.
// Falls back to the known default schedule if Firestore hasn't persisted one
// yet (the client only writes rdoSchedule when it changes from its default).
const DEFAULT_RDO_SCHEDULE = { enabled: true, anchorDate: '2026-07-06', cycleDays: 14 };
function isRDO(dateStr, sched) {
  sched = sched || DEFAULT_RDO_SCHEDULE;
  if (!sched.enabled || !sched.anchorDate) return false;
  const d = new Date(dateStr + 'T12:00:00');
  if (d.getDay() !== 1) return false;
  const anchor = new Date(sched.anchorDate + 'T12:00:00');
  const diffDays = Math.round((d - anchor) / 86400000);
  const cycle = sched.cycleDays || 14;
  return ((diffDays % cycle) + cycle) % cycle === 0;
}

// ── Weather (Open-Meteo, no API key needed) ───────────────────────
function wmoDesc(code){
  if(code===0)return'Clear sky';
  if(code<=3)return'Partly cloudy';
  if(code<=48)return'Foggy';
  if(code<=55)return'Drizzling';
  if(code<=65)return'Rainy';
  if(code<=75)return'Snowy';
  if(code<=82)return'Rain showers';
  if(code<=99)return'Thunderstorms';
  return'Cloudy';
}

function fetchWeather(lat=38.5347, lon=-121.4442){
  return new Promise((resolve)=>{
    const path=`/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&forecast_days=1&timezone=America%2FLos_Angeles`;
    const req=https.request({hostname:'api.open-meteo.com',path,method:'GET'},(res)=>{
      let d='';
      res.on('data',c=>d+=c);
      res.on('end',()=>{
        try{
          const parsed=JSON.parse(d);
          const c=parsed.current;
          const daily=parsed.daily||{};
          resolve({
            temp:Math.round(c.temperature_2m),
            feelsLike:Math.round(c.apparent_temperature),
            description:wmoDesc(c.weather_code),
            rain:c.rain>0||c.precipitation>0,
            wind:Math.round(c.wind_speed_10m),
            high:daily.temperature_2m_max?Math.round(daily.temperature_2m_max[0]):null,
            low:daily.temperature_2m_min?Math.round(daily.temperature_2m_min[0]):null,
          });
        }catch{resolve(null);}
      });
    });
    req.on('error',()=>resolve(null));
    req.end();
  });
}

// ── Obsidian memory ───────────────────────────────────────────────
const obsidian = require('./obsidian.js');

// ── TimeTree calendar ─────────────────────────────────────────────
const timetree = require('./timetree.js');

// ── Build context object (mirrors buildChatContext in index.html) ──
function buildContext(data) {
  const today = todayStr();
  const now = new Date();
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const monthName = now.toLocaleDateString('en-US', { month: 'long' });

  // ── RDO (9/80 schedule) ────────────────────────────────────────
  const tomorrowStr = new Date(new Date(today + 'T12:00:00').getTime() + 86400000).toLocaleDateString('en-CA');
  const rdoToday = isRDO(today, data.rdoSchedule);
  const rdoTomorrow = isRDO(tomorrowStr, data.rdoSchedule);

  // ── Packages (shipping tracker) ────────────────────────────────
  const packages = (data.packages || []).filter(p => !p.archived).map(p => ({
    name: p.description || p.retailer || p.trackingNumber,
    retailer: p.retailer || '', carrier: p.carrier || '', status: p.status,
    eta: p.eta ? new Date(p.eta).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) : '',
    lastLocation: p.lastLocation || '',
  }));

  const tasks = (data.projects || []).filter(t => !t.done).map(t => ({ id: t.id, name: t.name || '', due: t.due || '' }));
  const completedToday = (data.projects || []).filter(t => {
    if (!t.done) return false;
    if (t.completedDate === today) return true;
    if (t.doneAt) return new Date(t.doneAt).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) === today;
    return false;
  }).map(t => ({ id: t.id, name: t.name || '' }));
  const habits = (data.habits || []).map(h => ({ id: h.id, name: h.name, type: h.type, doneToday: !!(h.log && h.log[today]) }));
  const events = (data.events || []).filter(e => e.date === today).sort((a, b) => (a.time || '').localeCompare(b.time || '')).map(e => ({ time: e.time, name: e.name }));
  const budget = Math.round(data.budget?.monthly || data.budget?.income || 0);
  const now2 = now;
  const monthTxns = (data.transactions || []).filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === now2.getMonth() && d.getFullYear() === now2.getFullYear();
  });
  const spent = Math.round(monthTxns.filter(t => t.type === 'out').reduce((s, t) => s + (t.amount || 0), 0));
  const projects = (data.userProjects || []).filter(p => !p.archived).map(p => ({ id: p.id, name: p.name, emoji: p.emoji || '🔨', stage: p.stage, nextAction: p.nextAction || '' }));
  const accounts = (data.accounts || []).map(a => ({ name: a.name, type: a.type, balance: a.balance }));
  const goals = (data.goals || []).map(g => {
    const ids = g.linkedAccountIds || (g.linkedAccountId ? [g.linkedAccountId] : []);
    const current = ids.length
      ? ids.reduce((s, id) => s + ((data.accounts || []).find(a => a.id === id)?.balance || 0), 0)
      : (g.current || 0);
    return { name: g.name, emoji: g.emoji || '🎯', current, target: g.target, pct: g.target ? Math.round(current / g.target * 100) : 0 };
  });
  const profile = data.profile || '';
  const recentNotes = (data.notes || []).filter(n => !n.archived).slice(0, 15).map(n => ({ text: n.text, createdAt: n.createdAt, source: n.source || 'dashboard' }));

  // ── Overdue tasks (3+ days) ──────────────────────────────────────
  const todayDate = new Date(today + 'T12:00:00');
  const overdueTasks = (data.projects || []).filter(t => {
    if (t.done || !t.due) return false;
    const dueDate = new Date(t.due + 'T12:00:00');
    const daysOverdue = Math.round((todayDate - dueDate) / 86400000);
    return daysOverdue >= 3;
  }).map(t => {
    const dueDate = new Date(t.due + 'T12:00:00');
    const daysOverdue = Math.round((todayDate - dueDate) / 86400000);
    return { id: t.id, name: t.name || '', due: t.due, daysOverdue };
  });

  // ── Weekly habit counts (this week vs last week) ─────────────────
  const weekStart = new Date(todayDate);
  weekStart.setDate(todayDate.getDate() - todayDate.getDay()); // Sunday
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(weekStart.getDate() - 7);

  function dateRange(start, days) {
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i);
      return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    });
  }
  const thisWeekDays = dateRange(weekStart, 7);
  const lastWeekDays = dateRange(lastWeekStart, 7);

  const weeklyHabitCounts = (data.habits || []).filter(h => h.type === 'daily').map(h => {
    const thisWeek = thisWeekDays.filter(d => h.log && h.log[d] && h.log[d] > 0).length;
    const lastWeek = lastWeekDays.filter(d => h.log && h.log[d] && h.log[d] > 0).length;
    return { name: h.name, thisWeek, lastWeek };
  });

  // ── Weekly spend ─────────────────────────────────────────────────
  const thisWeekSpend = (data.transactions || []).filter(t =>
    t.type === 'out' && thisWeekDays.includes(t.date)
  ).reduce((s, t) => s + (t.amount || 0), 0);
  const lastWeekSpend = (data.transactions || []).filter(t =>
    t.type === 'out' && lastWeekDays.includes(t.date)
  ).reduce((s, t) => s + (t.amount || 0), 0);

  // ── Spending patterns (category 4+ times this week) ─────────────
  const thisWeekTxns = (data.transactions || []).filter(t =>
    t.type === 'out' && thisWeekDays.includes(t.date)
  );
  const catCounts = {};
  thisWeekTxns.forEach(t => {
    const cat = t.category || 'Other';
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  });
  const spendingPatterns = Object.entries(catCounts)
    .filter(([, count]) => count >= 4)
    .map(([cat, count]) => {
      const total = thisWeekTxns.filter(t => (t.category || 'Other') === cat).reduce((s, t) => s + t.amount, 0);
      return { category: cat, count, total };
    });

  // ── Spending trends (#16): current month per-category vs 3-month average ──
  // Categories deviating >20% from their prior-3-month average get flagged.
  const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`;
  const curKey = monthKey(now);
  const priorKeys = [1, 2, 3].map(i => monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  const catCur = {}, catPrior = {};
  (data.transactions || []).forEach(t => {
    if (t.type !== 'out') return;
    const d = new Date(t.date);
    if (isNaN(d)) return;
    const k = monthKey(d);
    const cat = t.category || 'Other';
    if (k === curKey) catCur[cat] = (catCur[cat] || 0) + (t.amount || 0);
    else if (priorKeys.includes(k)) catPrior[cat] = (catPrior[cat] || 0) + (t.amount || 0);
  });
  const spendingTrends = [];
  for (const cat of new Set([...Object.keys(catCur), ...Object.keys(catPrior)])) {
    const cur = Math.round(catCur[cat] || 0);
    const avg = Math.round((catPrior[cat] || 0) / 3);
    if (avg < 20 && cur < 20) continue; // ignore noise
    if (avg === 0) { if (cur >= 50) spendingTrends.push({ category: cat, current: cur, avg, pct: null }); continue; }
    const pct = Math.round((cur - avg) / avg * 100);
    if (Math.abs(pct) > 20) spendingTrends.push({ category: cat, current: cur, avg, pct });
  }

  return {
    today, dayName, monthName, tasks, completedToday, habits, events,
    budget, spent, projects, accounts, goals, profile, recentNotes,
    overdueTasks, weeklyHabitCounts, weeklySpend: { thisWeek: Math.round(thisWeekSpend), lastWeek: Math.round(lastWeekSpend) },
    spendingPatterns, spendingTrends, rdoToday, rdoTomorrow, packages,
  };
}

// ── System prompt (mirrors chat.js) ──────────────────────────────
function buildSystemPrompt(ctx) {
  const taskList = ctx.tasks.length ? ctx.tasks.map(t => `  [${t.id}] "${t.name}"${t.due ? ` due:${t.due}` : ''}`).join('\n') : '  (none)';
  const completedTodayList = ctx.completedToday?.length ? ctx.completedToday.map(t => `  ✓ "${t.name}"`).join('\n') : '  (none)';
  const habitList = ctx.habits.length ? ctx.habits.map(h => `  [${h.id}] "${h.name}" (${h.type})${h.doneToday ? ' ✓' : ''}`).join('\n') : '  (none)';
  const accountList = (ctx.accounts||[]).length ? ctx.accounts.map(a => `  ${a.name} (${a.type}): $${a.balance.toLocaleString()}`).join('\n') : '  (none)';
  const goalList = (ctx.goals||[]).length ? ctx.goals.map(g => `  ${g.emoji} ${g.name}: $${g.current.toLocaleString()} / $${g.target.toLocaleString()} (${g.pct}%)`).join('\n') : '  (none)';
  const eventList = ctx.events.length ? ctx.events.map(e => `  ${e.time} – ${e.name}`).join('\n') : '  (none)';
  const projectList = ctx.projects.length ? ctx.projects.map(p => `  [${p.id}] ${p.emoji} "${p.name}" [${p.stage}]${p.nextAction ? ` → ${p.nextAction}` : ''}`).join('\n') : '  (none)';

  const memoryBlock = ctx.profile ? `\nDAN'S PROFILE & MEMORY:\n${ctx.profile}\n` : '';
  const notesBlock = ctx.recentNotes && ctx.recentNotes.length
    ? `\nRECENT BRAIN DUMP NOTES (newest first):\n${ctx.recentNotes.map(n => `  [${n.source}] ${n.text}`).join('\n')}\n`
    : '';

  // Overdue escalation (3+ days)
  const overdueBlock = ctx.overdueTasks && ctx.overdueTasks.length
    ? `\nOVERDUE TASKS (3+ days — flag these urgently in morning briefings):\n${ctx.overdueTasks.map(t => `  [${t.id}] "${t.name}" — ${t.daysOverdue} days overdue (was due ${t.due})`).join('\n')}\n`
    : '';

  // Weekly habit comparison
  const weeklyHabitBlock = ctx.weeklyHabitCounts && ctx.weeklyHabitCounts.length
    ? `\nHABIT COMPARISON (this week vs last week):\n${ctx.weeklyHabitCounts.map(h => `  ${h.name}: this week ${h.thisWeek}/7, last week ${h.lastWeek}/7`).join('\n')}\n`
    : '';

  // Weekly spend comparison
  const weeklySpendBlock = ctx.weeklySpend
    ? `\nWEEKLY SPENDING: this week $${ctx.weeklySpend.thisWeek}, last week $${ctx.weeklySpend.lastWeek}${ctx.weeklySpend.thisWeek > ctx.weeklySpend.lastWeek * 1.2 ? ' ⚠️ tracking 20%+ higher than last week' : ''}\n`
    : '';

  // Spending patterns
  const spendingPatternsBlock = ctx.spendingPatterns && ctx.spendingPatterns.length
    ? `\nSPENDING PATTERNS THIS WEEK (mention proactively when relevant):\n${ctx.spendingPatterns.map(p => `  ${p.category}: ${p.count} transactions, $${Math.round(p.total)} total`).join('\n')}\n`
    : '';

  // Spending trends vs 3-month average (#16)
  const spendingTrendsBlock = ctx.spendingTrends && ctx.spendingTrends.length
    ? `\nSPENDING TRENDS (this month vs prior 3-month average — categories deviating >20%; weave these in naturally when finances come up):\n${ctx.spendingTrends.map(t => t.pct === null
        ? `  ${t.category}: $${t.current} this month vs $0 avg (new spending)`
        : `  ${t.category}: $${t.current} this month vs $${t.avg} avg (${t.pct > 0 ? '+' : ''}${t.pct}%)`).join('\n')}\n`
    : '';

  // Split timetree block into Dan's and Julia's sections
  let ttBlock = '';
  let juliaBlock = '';
  if (ctx.timetreeEvents) {
    const parts = ctx.timetreeEvents.split("\n\nJulia's schedule:");
    const danPart = parts[0]; // "Dan's schedule:\n  ..."
    const juliaPart = parts[1] ? "Julia's schedule:" + parts[1] : '';
    ttBlock = `\nDAN'S TIMETREE CALENDAR (next 14 days — Dan's events only):\n${danPart}\n`;
    if (juliaPart) juliaBlock = `\nJULIA'S CALENDAR (girlfriend Julia's events — always label these as Julia's when mentioning them):\n${juliaPart}\n`;
  }

  return `You are J.A.R.V.I.S. — Dan's personal AI assistant on Telegram. You have full visibility into his tasks, habits, schedule, finances, projects, and his TimeTree calendar. Be sharp, proactive, and genuinely helpful.
${memoryBlock}${notesBlock}${overdueBlock}${weeklyHabitBlock}${weeklySpendBlock}${spendingPatternsBlock}${spendingTrendsBlock}${ttBlock}${juliaBlock}
Today: ${ctx.today} (${ctx.dayName})${ctx.rdoToday ? ' — Dan is OFF today (RDO)' : ctx.rdoTomorrow ? ' — Dan is OFF tomorrow (RDO)' : ''}
${ctx.weather ? `Weather: ${ctx.weather.temp}°F, feels like ${ctx.weather.feelsLike}°F, ${ctx.weather.description}${ctx.weather.rain ? ', rain expected' : ''}, wind ${ctx.weather.wind}mph${ctx.weather.high != null ? `, High ${ctx.weather.high}°F / Low ${ctx.weather.low}°F` : ''}` : ''}

ACTIVE TASKS:
${taskList}

COMPLETED TODAY:
${completedTodayList}

HABITS (✓ = done today):
${habitList}

TODAY'S DASHBOARD EVENTS:
${eventList}

FINANCE (${ctx.monthName}): $${ctx.spent} spent of $${ctx.budget} budget

ACCOUNTS & NET WORTH:
${accountList}

SAVINGS GOALS:
${goalList}

PROJECTS (stages: planning/sourcing/building/blocked/done):
${projectList}
${(ctx.packages || []).length ? `\nPACKAGES IN TRANSIT:\n${ctx.packages.map(p => `  📦 ${p.name}${p.retailer ? ` (${p.retailer})` : ''} — ${p.status}${p.eta ? `, ETA ${p.eta}` : ''}${p.eta === ctx.today ? ' ⬅ ARRIVING TODAY — mention this proactively in briefings' : ''}`).join('\n')}\n` : ''}

WHAT TO FOCUS ON TODAY:
When Dan asks "what should I focus on", "what should I work on", "what's my priority", or similar, respond with a ranked list of exactly 3 things based on: (1) tasks from OVERDUE TASKS section first, (2) tasks due today, (3) habits not yet done today, (4) project next actions. Be specific and direct — no fluff.

RDO AWARENESS: Dan works a 9/80 schedule — every other Monday is a day off (RDO). Use the "Today"/"Dan is OFF" line above. When he's off today or tomorrow, it's a good moment to proactively suggest tackling a project next-action or a longer task that doesn't fit on a work day — but only mention it if it's naturally relevant to what he's asking, don't force it into every reply.

HOW AM I DOING THIS WEEK:
When Dan asks "how am I doing this week", "how's my week going", "weekly check-in", or similar, compare using the HABIT COMPARISON and WEEKLY SPENDING blocks above. Mention what's better vs last week, what's slipped, and give a direct honest assessment. Include spending comparison.

MORNING BRIEFING FORMAT:
When asked for a morning briefing or "what's my day look like", reply in this order using \\n for line breaks:
1. ☀️ Good morning, Dan! It's ${ctx.dayName}, [full month + day, e.g. June 29].
2. Weather: current conditions, High [X]°F / Low [X]°F (always include high/low from the weather data above).
3. Urgent tasks — ONLY include tasks whose due date is today (${ctx.today}), yesterday or earlier (overdue), or tomorrow. Do NOT include tasks due later in the week. Circle rules are strict — match the due date exactly:
   🔴 = due date is BEFORE today (overdue/past due)
   🟢 = due date is exactly TODAY (${ctx.today})
   🟡 = due date is exactly TOMORROW (${ctx.today} + 1 day)
   If there are no tasks in those three categories, skip this section entirely.
4. 📅 Your schedule today: list Dan's events from DAN'S TIMETREE CALENDAR with times. Always include the day name before dates (e.g. "Monday, Jun 29").
5. 💜 Julia's plans today: list Julia's events from JULIA'S CALENDAR with times, clearly labeled as hers.
6. ─────────────────────
7. 2-3 sentences of personal perspective on the day — what matters, what to watch out for, something grounding. Spoken directly to Dan like a trusted friend.

JULIA'S SCHEDULE CONTEXT:
Use Julia's calendar proactively — not just when asked directly. If Dan mentions plans, scheduling something, or asks about free time, check Julia's schedule and mention it naturally. Examples: "Julia's free that evening" or "heads up, Julia has her orthodontist that morning." If Dan asks about a free evening or weekend, factor in Julia's events. Never present Julia's events as Dan's — always attribute them to her.

NATURAL LANGUAGE DATES:
Today is ${ctx.today}. When the user says things like "tomorrow", "next Thursday", "next week", "end of the month", "in two weeks", calculate the exact YYYY-MM-DD and use it in actions. Never leave a date field as a relative phrase.

PERSONALITY:
- Address Dan by name occasionally. Warm but efficient.
- Give substantive responses. Reference his data when relevant.
- Only ask a follow-up question if you can act on the answer with one of your available actions.
- Never repeat information already given in this conversation.
- When telling Dan about his day, use DAN'S TIMETREE CALENDAR above as his primary schedule.
- Write in plain text. Do NOT use markdown bold (**word**) or italic (*word*) anywhere in replies — Telegram renders these as symbols and it looks cluttered. Use plain sentences, emojis, or line breaks instead.

Respond ONLY with valid JSON — no markdown, no extra text:
{"reply":"your response","actions":[]}

Replies can be multiple sentences. Use \\n for line breaks.

AVAILABLE ACTIONS:
{"type":"add_task","name":"...","due":"YYYY-MM-DD"}
{"type":"update_task","id":"<task id>","name":"<exact task name from list>","due":"YYYY-MM-DD","newName":"<optional new name>"}
{"type":"complete_task","id":"<task id>","name":"<exact task name from list>"}
{"type":"delete_task","id":"<task id>","name":"<exact task name from list>"}
{"type":"log_habit","id":"<habit id>","name":"<habit name>"}
{"type":"add_event","name":"...","time":"HH:MM","date":"YYYY-MM-DD"}
{"type":"add_timetree_event","title":"...","date":"YYYY-MM-DD","time":"HH:MM","end_time":"HH:MM","all_day":false,"location":"...","note":"...","recurrence":"RRULE:FREQ=WEEKLY"}
{"type":"update_timetree_event","event_id":"<id from calendar>","title":"...","date":"YYYY-MM-DD","time":"HH:MM","end_time":"HH:MM","location":"...","note":"..."}
{"type":"delete_timetree_event","event_id":"<id from calendar>","title":"<event title for confirmation>"}
{"type":"add_transaction","name":"...","amount":50,"category":"Food","transactionType":"out"}
{"type":"set_intention","text":"..."}
{"type":"add_project","emoji":"🔨","name":"...","stage":"planning","nextAction":"..."}
{"type":"update_project_stage","id":"<project id>","name":"<project name>","stage":"building"}
{"type":"update_project_next_action","id":"<project id>","name":"<project name>","nextAction":"..."}
{"type":"save_memory","text":"<concise fact to remember about Dan — appended to his profile>"}
{"type":"update_profile","text":"<full rewritten profile markdown — use to reorganize/clean up the profile>"}
{"type":"add_note","text":"<idea, thought, or brain dump to show on Dan's dashboard>"}
{"type":"save_note","filename":"<short name like 'work-schedule' or 'gym-routine'>","content":"<full markdown content to save>"}

RULES:
- Use exact IDs from the lists above
- Parse dates relative to today (${ctx.today})
- Can return multiple actions at once
- To reschedule a task or change its name, use update_task with the new due date or newName
- NOTES vs MEMORY: Two distinct systems:
  • add_note = ideas, thoughts, brain dumps Dan wants to SEE on his dashboard later. Use when Dan says "save this", "note this down", "I want to remember this idea", or brain-dumps something. These show up as cards on his dashboard.
  • save_memory = facts about Dan that make you smarter going forward. Silent background knowledge, not shown as dashboard cards.
  • update_profile = full rewrite of the profile (use occasionally to reorganize after many save_memory calls)
- AUTONOMOUS MEMORY: After every message, proactively decide if anything is worth saving — don't wait to be asked. Save things like:
  • Preferences ("I hate mornings", "I only drink black coffee", "I prefer text over calls")
  • Recurring patterns ("Dan goes to the gym on Mon/Wed/Fri", "Dan usually works from home on Fridays")
  • Important personal facts (car details, dietary needs, relationships, goals, pet names)
  • Context that would make you more useful next time ("Dan is saving up for X", "Dan's sister is visiting in August")
  • Things Dan mentions offhand that reveal habits or lifestyle ("just got back from a 10km run", "skipped the gym again")
  - DON'T save: one-off tasks, things already in the calendar, things already in memory, generic small talk
  - Keep each save_memory entry concise — one clear fact per entry
- Use save_note for structured reference info like routines, shopping lists, schedules, or multi-line notes
- When given an image of a WORK SCHEDULE or ROSTER: extract every shift and create one add_timetree_event action per shift (title="Work", date=YYYY-MM-DD, time=HH:MM, end_time=HH:MM). ALSO save_note with filename "work-schedule". The shifts MUST go into TimeTree.
- TIMETREE EVENT RULES:
  - When Dan mentions an event he wants to add, ask: "Want me to add that to TimeTree?"
  - If yes, or if he explicitly says "add to calendar" / "put it on my calendar", use add_timetree_event
  - If the event could be recurring (weekly meeting, regular appointment, shift pattern), ask: "Does this repeat? I can set it to repeat weekly, daily, or monthly."
  - Recurrence values: "RRULE:FREQ=WEEKLY" / "RRULE:FREQ=DAILY" / "RRULE:FREQ=MONTHLY" / "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR" etc.
  - Leave recurrence out (or null) for one-time events
  - time and end_time use 24h HH:MM format; omit both for all_day events
  - location and note are optional — include if Dan provides them
  - To RESCHEDULE or EDIT an event, use update_timetree_event with the event_id from the calendar list. Only include fields that are changing.
  - To DELETE an event, use delete_timetree_event with the event_id. Always confirm "Want me to delete [event]?" before deleting.
- ALWAYS ask for missing required info before creating anything — do not guess:
  - add_task: if no due date given, ask "When is this due?" before creating it
  - add_project: if no stage given, ask what stage it's at before creating it
  - add_event / add_timetree_event: if no date given, ask before creating it
  - Only proceed to create once you have the key details
- For projects, use these stages precisely:
  planning = still deciding what to do
  sourcing = actively researching, ordering, or designing
  building = hands-on work is actively happening
  blocked = waiting on parts, waiting on someone, or otherwise stalled — use this whenever something is holding the project up
  done = complete
- Never repeat information already given in this conversation
- OVERDUE ESCALATION: In morning briefings, ALWAYS call out tasks in the OVERDUE TASKS section separately with urgency. Use 🔴 for 7+ days, 🟠 for 3-6 days overdue. Don't just list them — acknowledge the delay and suggest action.
- SPENDING PATTERNS: When relevant (after logging a transaction, or when asked about finances), proactively mention any patterns from SPENDING PATTERNS THIS WEEK. "Heads up, you've had 4+ transactions at [category] this week."
- VOICE MEMO ROUTING: If a voice message (transcribed text) contains multiple distinct items — tasks, ideas, notes, project updates, events — extract and route each one using the appropriate action types. Don't just reply to the whole message — act on each item individually.`;
}

// Extract the first complete JSON object from a string, handling nested braces correctly
function extractJSON(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

// ── Call Claude ───────────────────────────────────────────────────
function callClaude(systemPrompt, history, message) {
  const messages = [...history.slice(-20), { role: 'user', content: message }];
  const payload = JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2048, system: systemPrompt, messages });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const api = JSON.parse(d);
          if (api.error) { resolve({ reply: 'API error: ' + api.error.message, actions: [] }); return; }
          const text = api.content[0].text;
          const jsonStr = extractJSON(text);
          if (!jsonStr) {
            // Claude replied conversationally without a JSON wrapper — use the text directly
            console.log('Claude plain-text reply (no JSON):', text.slice(0, 200));
            resolve({ reply: text.trim() || 'Something went wrong on my end. Try again.', actions: [] });
            return;
          }
          const result = JSON.parse(jsonStr);
          resolve({ reply: result.reply || 'Done.', actions: result.actions || [] });
        } catch (e) {
          console.error('Claude parse error:', e.message);
          resolve({ reply: 'Something went wrong on my end. Try again in a moment.', actions: [] });
        }
      });
    });
    req.on('error', (e) => { console.error('Claude request error:', e.message); resolve({ reply: 'Connection error. Try again.', actions: [] }); });
    req.write(payload);
    req.end();
  });
}

// Find item by id first, then fall back to name substring match
function findById(arr, id, name) {
  let item = (arr || []).find(x => x.id === id);
  if (!item && name) {
    const lc = name.toLowerCase();
    item = (arr || []).find(x => (x.name || x.text || '').toLowerCase().includes(lc));
  }
  return item || null;
}

// ── Apply actions to data object (mirrors executeActions in browser) ──
function applyActions(data, actions) {
  const today = todayStr();
  const labels = [];
  let spendingAlert = null;
  for (const action of (actions || [])) {
    switch (action.type) {
      case 'add_task':
        data.projects = data.projects || [];
        data.projects.push({ id: uidGen(), name: action.name, due: action.due || '', done: false, created: today });
        labels.push(`Added task: ${action.name}`);
        break;
      case 'update_task': {
        const t = findById(data.projects, action.id, action.name);
        if (t) {
          if (action.due) t.due = action.due;
          if (action.newName) t.name = action.newName;
          labels.push(`Updated: ${t.name}${action.due ? ` → due ${action.due}` : ''}`);
        } else { console.warn('update_task: no match for id=%s name=%s', action.id, action.name); labels.push(`Warning: could not find task to update`); }
        break;
      }
      case 'complete_task': {
        const t = findById(data.projects, action.id, action.name);
        if (t) { t.done = true; t.completedDate = today; labels.push(`Completed: ${t.name}`); }
        else { console.warn('complete_task: no match for id=%s name=%s', action.id, action.name); }
        break;
      }
      case 'delete_task': {
        const before = (data.projects || []).length;
        data.projects = (data.projects || []).filter(t => t.id !== action.id);
        if (data.projects.length === before && action.name) {
          const lc = action.name.toLowerCase();
          data.projects = data.projects.filter(t => !t.name || !t.name.toLowerCase().includes(lc));
        }
        const removed = before - (data.projects || []).length;
        if (removed > 0) labels.push(`Task removed`);
        else { console.warn('delete_task: no match for id=%s name=%s', action.id, action.name); labels.push(`Warning: could not find task to delete`); }
        break;
      }
      case 'log_habit': {
        const h = findById(data.habits, action.id, action.name);
        if (h) { h.log = h.log || {}; h.log[today] = true; labels.push(`Logged: ${h.name}`); }
        else { console.warn('log_habit: no match for id=%s name=%s', action.id, action.name); }
        break;
      }
      case 'add_event':
        data.events = data.events || [];
        data.events.push({ id: uidGen(), name: action.name, time: action.time, date: action.date || today });
        labels.push(`Event: ${action.name}`);
        break;
      case 'add_transaction': {
        data.transactions = data.transactions || [];
        data.transactions.push({ id: uidGen(), name: action.name, amount: action.amount, category: action.category, type: action.transactionType || 'out', date: today });
        labels.push(`$${action.amount} – ${action.name}`);
        // Spending alert: check if we crossed a budget threshold
        const budget = Math.round(data.budget?.monthly || data.budget?.income || 0);
        if (budget > 0) {
          const now2 = new Date();
          const monthSpent = Math.round((data.transactions || []).filter(t => {
            const d = new Date(t.date); return d.getMonth() === now2.getMonth() && d.getFullYear() === now2.getFullYear() && t.type === 'out';
          }).reduce((s, t) => s + (t.amount || 0), 0));
          const pct = Math.round(monthSpent / budget * 100);
          const prevPct = Math.round((monthSpent - (action.amount || 0)) / budget * 100);
          if (pct >= 100 && prevPct < 100) spendingAlert = `🔴 Budget alert: you've hit 100% of your monthly budget ($${monthSpent} of $${budget}).`;
          else if (pct >= 90 && prevPct < 90) spendingAlert = `🟠 Budget alert: you're at 90% of your monthly budget ($${monthSpent} of $${budget}).`;
          else if (pct >= 80 && prevPct < 80) spendingAlert = `🟡 Heads up: you've used 80% of your monthly budget ($${monthSpent} of $${budget}).`;
        }
        break;
      }
      case 'set_intention':
        data.intention = action.text;
        labels.push('Intention set');
        break;
      case 'add_project':
        data.userProjects = data.userProjects || [];
        data.userProjects.push({ id: uidGen(), emoji: action.emoji || '🔨', name: action.name, stage: action.stage || 'planning', nextAction: action.nextAction || '', created: today });
        labels.push(`Project: ${action.name}`);
        break;
      case 'update_project_stage': {
        const p = findById(data.userProjects, action.id, action.name);
        if (p) { p.stage = action.stage; labels.push(`${p.name} → ${action.stage}`); }
        else { console.warn('update_project_stage: no match for id=%s name=%s', action.id, action.name); }
        break;
      }
      case 'update_project_next_action': {
        const p = findById(data.userProjects, action.id, action.name);
        if (p) { p.nextAction = action.nextAction; labels.push(`Updated: ${p.name}`); }
        else { console.warn('update_project_next_action: no match for id=%s name=%s', action.id, action.name); }
        break;
      }
      case 'add_timetree_event':
        labels.push(`TimeTree: ${action.title} on ${action.date}`);
        break;
      case 'update_timetree_event':
        labels.push(`Updated event: ${action.title || action.event_id}`);
        break;
      case 'delete_timetree_event':
        labels.push(`Deleted event: ${action.title || action.event_id}`);
        break;
      case 'save_memory':
        data.profile = data.profile || '';
        data.profile = data.profile.trimEnd() + '\n- ' + (action.text || '').trim();
        labels.push(`Memory saved`);
        break;
      case 'update_profile':
        if (action.text) { data.profile = action.text; labels.push('Profile updated'); }
        break;
      case 'add_note':
        data.notes = data.notes || [];
        data.notes.unshift({ id: uidGen(), text: action.text || '', createdAt: Date.now(), source: 'jarvis' });
        labels.push(`Note added`);
        break;
      case 'save_note':
        labels.push(`Note saved: ${action.filename}`);
        break;
    }
  }
  return { labels, spendingAlert };
}

// ── Main handler ──────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 200, body: 'OK' };

  let update;
  try { update = JSON.parse(event.body); } catch { return { statusCode: 200, body: 'OK' }; }

  const message = update.message;
  const isVoice = !!(message?.voice || message?.audio);
  if (!message || (!message.text && !message.photo && !message.document && !isVoice)) return { statusCode: 200, body: 'OK' };

  const chatId = String(message.chat.id);
  const isPhoto = !!(message.photo || (message.document && message.document.mime_type && message.document.mime_type.startsWith('image/')));

  // Transcribe voice messages before anything else
  let voiceTranscript = null;
  if (isVoice) {
    const fileId = message.voice?.file_id || message.audio?.file_id;
    const mimeType = message.voice?.mime_type || message.audio?.mime_type || 'audio/ogg';
    await sendMessage(chatId, '🎙️ Transcribing your voice message...');
    try {
      const audioBuffer = await downloadTelegramFile(fileId);
      if (audioBuffer) {
        voiceTranscript = await transcribeAudio(audioBuffer, mimeType);
      }
    } catch (e) { console.error('Voice transcription error:', e.message); }
    if (!voiceTranscript) {
      await sendMessage(chatId, "Sorry, I couldn't transcribe that. Try again or type your message.");
      return { statusCode: 200, body: 'OK' };
    }
  }

  const text = voiceTranscript || (message.text || message.caption || '').trim();
  const allowedChatId = process.env.TELEGRAM_CHAT_ID;

  // If TELEGRAM_CHAT_ID not yet configured, echo it back so user can add it
  if (!allowedChatId) {
    await sendMessage(chatId, `Your Telegram chat ID is: ${chatId}\n\nAdd TELEGRAM_CHAT_ID=${chatId} to your Netlify environment variables, then redeploy.`);
    return { statusCode: 200, body: 'OK' };
  }

  if (chatId !== allowedChatId) return { statusCode: 200, body: 'OK' };

  // Load Firebase data
  initFirebase();
  const db = admin.firestore();

  const userUid = 'aqzJe5gq4IVYdKmUIW0pNJGL2ML2';

  const userRef = db.doc(`users/${userUid}/data/main`);
  let appData = {};
  try {
    const snap = await userRef.get();
    if (snap.exists) appData = snap.data();
  } catch (e) {
    await sendMessage(chatId, 'Could not load your dashboard data.');
    return { statusCode: 200, body: 'OK' };
  }

  // Load conversation history from Firestore
  const historyRef = db.doc(`users/${userUid}/data/telegramHistory`);
  let history = [];
  try {
    const hSnap = await historyRef.get();
    if (hSnap.exists) history = hSnap.data().messages || [];
  } catch {}

  // Clear history command
  if (/^\/clear|^clear (history|chat|context)/i.test(text)) {
    try { await historyRef.set({ messages: [] }); } catch {}
    await sendMessage(chatId, '🧹 Conversation history cleared. Fresh start!');
    return { statusCode: 200, body: 'OK' };
  }

  // Dashboard image shortcut — before Claude
  const dashTrigger = /\b(show|send|give|get|my)\b.*\bdashboard\b|\bdashboard\s*(image|pic|photo|snapshot|card|view)\b|\bsnap(shot)?\b/i;
  if (dashTrigger.test(text)) {
    try {
      await sendMessage(chatId, '📊 Generating your dashboard...');
      const { buildDashboardPng } = require('./dashboard-image.js');
      const png = buildDashboardPng(appData);
      const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      await sendPhoto(chatId, png, `Command Center · ${today}`);
    } catch (e) {
      console.error('Dashboard image error:', e);
      await sendMessage(chatId, 'Sorry, had trouble generating the image. Try again in a moment.');
    }
    return { statusCode: 200, body: 'OK' };
  }

  // Call Claude
  const [weather, ttEvents] = await Promise.all([
    fetchWeather(),
    timetree.getUpcomingEvents(14).catch((e) => { console.error('[tt] getUpcomingEvents error:', e.message); return []; }),
  ]);
  console.log('[tt] events count:', ttEvents.length, '| today sample:', ttEvents.slice(0,3).map(e=>e.title+'/'+e.author).join(', '));
  const ctx = buildContext(appData);
  ctx.weather = weather;
  ctx.timetreeEvents = timetree.formatForPrompt(ttEvents);
  console.log('[tt] prompt block:\n', ctx.timetreeEvents.slice(0, 400));
  const systemPrompt = buildSystemPrompt(ctx);

  let reply, actions;
  if (isPhoto) {
    await sendMessage(chatId, '📷 Reading your image...');
    try {
      const fileId = message.photo
        ? message.photo[message.photo.length - 1].file_id
        : message.document.file_id;
      const mimeType = message.document ? message.document.mime_type : 'image/jpeg';
      const imageBuffer = await downloadTelegramFile(fileId);
      if (!imageBuffer) throw new Error('Download failed');
      ({ reply, actions } = await callClaudeWithImage(systemPrompt, history, imageBuffer, mimeType, text));
    } catch (e) {
      console.error('Image processing error:', e);
      reply = 'Sorry, had trouble reading that image. Try again.';
      actions = [];
    }
  } else {
    ({ reply, actions } = await callClaude(systemPrompt, history, text));
  }

  // Apply actions and save data
  let spendingAlert = null;
  if (actions && actions.length > 0) {
    ({ spendingAlert } = applyActions(appData, actions));
    try { await userRef.set(appData); } catch (e) { console.error('Save error', e); }
    // Handle async actions (TimeTree)
    for (const action of actions) {
      if (action.type === 'add_timetree_event' && action.title && action.date) {
        try {
          await timetree.createEvent({
            title: action.title,
            date: action.date,
            time: action.time || null,
            endDate: action.end_date || null,
            endTime: action.end_time || null,
            allDay: action.all_day || false,
            location: action.location || null,
            note: action.note || null,
            recurrence: action.recurrence || null,
          });
          console.log('TimeTree event created:', action.title);
        } catch (e) {
          console.error('TimeTree createEvent error:', e.message);
        }
      }
      if (action.type === 'update_timetree_event' && action.event_id) {
        try {
          await timetree.updateEvent(action.event_id, {
            title: action.title,
            date: action.date,
            time: action.time,
            endDate: action.end_date,
            endTime: action.end_time,
            allDay: action.all_day,
            location: action.location,
            note: action.note,
          });
          console.log('TimeTree event updated:', action.event_id);
        } catch (e) {
          console.error('TimeTree updateEvent error:', e.message, e.body);
        }
      }
      if (action.type === 'delete_timetree_event' && action.event_id) {
        try {
          await timetree.deleteEvent(action.event_id);
          console.log('TimeTree event deleted:', action.event_id);
        } catch (e) {
          console.error('TimeTree deleteEvent error:', e.message, e.body);
        }
      }
    }
  }

  // Save updated conversation history
  const userHistoryContent = isVoice ? `[voice message: "${text}"]` : isPhoto ? `[sent an image${text ? ': ' + text : ''}]` : text;
  history.push({ role: 'user', content: userHistoryContent });
  history.push({ role: 'assistant', content: reply });
  if (history.length > 40) history = history.slice(-40);
  try { await historyRef.set({ messages: history }); } catch {}

  // Send reply to Telegram
  if (reply && reply.trim()) await sendMessage(chatId, reply);
  if (spendingAlert) await sendMessage(chatId, spendingAlert);

  // Voice replies (#25): if the incoming message was a voice note, also send the
  // reply as speech. Text already went out above (accessibility + skimming), so
  // a TTS failure costs nothing.
  if (isVoice && reply && reply.trim()) {
    try {
      const { synthesizeSpeech } = require('./tts.js');
      const clean = reply
        .replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
        .replace(/`(.+?)`/g, '$1')
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '') // strip emoji for speech
        .trim();
      if (clean) {
        const opus = await synthesizeSpeech(clean, { voice: 'alloy', speed: 1.1, format: 'opus' });
        await sendVoice(chatId, opus);
      }
    } catch (e) {
      console.error('Voice reply TTS error (text already sent):', e.message);
    }
  }

  return { statusCode: 200, body: 'OK' };
};
