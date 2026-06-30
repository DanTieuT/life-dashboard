const https = require('https');
const admin = require('firebase-admin');

// Fallback: load .env directly when netlify dev skips long-value vars
if (!process.env.ANTHROPIC_API_KEY) {
  try {
    const fs = require('fs'), path = require('path');
    fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^#=\s]+)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
  } catch {}
}
const timetree = require('./timetree.js');

function initFirebase() {
  if (admin.apps.length > 0) return;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_B64
    ? JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString())
    : require('./service-account.json');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

function sendTelegram(text) {
  return new Promise((resolve) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const body = JSON.stringify({ chat_id: chatId, text });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve);
    req.write(body);
    req.end();
  });
}

function fetchWeather() {
  return new Promise((resolve) => {
    const path = '/v1/forecast?latitude=38.5347&longitude=-121.4442&current=temperature_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&forecast_days=1';
    const req = https.request({ hostname: 'api.open-meteo.com', path, method: 'GET' }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const c = JSON.parse(d).current;
          const codes = { 0:'Clear sky', 1:'Mainly clear', 2:'Partly cloudy', 3:'Overcast', 45:'Foggy', 48:'Foggy', 51:'Drizzling', 53:'Drizzling', 55:'Drizzling', 61:'Rainy', 63:'Rainy', 65:'Heavy rain', 71:'Snowy', 73:'Snowy', 75:'Heavy snow', 80:'Rain showers', 81:'Rain showers', 82:'Heavy showers', 95:'Thunderstorm' };
          const desc = codes[c.weather_code] || 'Cloudy';
          const rain = c.rain > 0 || c.precipitation > 0;
          resolve({ temp: Math.round(c.temperature_2m), feelsLike: Math.round(c.apparent_temperature), desc, rain, wind: Math.round(c.wind_speed_10m) });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function callClaude(prompt) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }]
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
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
        try { resolve(JSON.parse(d).content[0].text.trim()); }
        catch { resolve(''); }
      });
    });
    req.on('error', () => resolve(''));
    req.write(payload);
    req.end();
  });
}

function todayPacific() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function fmt(n) { return '$' + Math.round(n).toLocaleString(); }

// "2026-07-04" → "Saturday (Jul 4)", "Next Monday (Jul 6)", "Jul 20"
function humanDate(dateStr, today) {
  const d = new Date(dateStr + 'T12:00:00');
  const t = new Date(today + 'T12:00:00');
  const diff = Math.round((d - t) / 86400000);
  const md = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); // "Jul 4"

  if (diff === 0) return `Today (${md})`;
  if (diff === 1) return `Tomorrow (${md})`;
  if (diff === -1) return `Yesterday (${md})`;

  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });

  if (diff > 1 && diff <= 6)   return `${weekday} (${md})`;
  if (diff >= 7 && diff <= 13) return `Next ${weekday} (${md})`;
  if (diff < -1 && diff >= -6) return `Last ${weekday} (${md})`;
  if (diff < -6 && diff >= -13) return `${weekday}, last week (${md})`;

  return md; // far past/future: just "Aug 15"
}

exports.handler = async (event) => {
  const secret = process.env.CRON_SECRET;
  const provided = (event && event.queryStringParameters && event.queryStringParameters.secret) || '';
  if (secret && provided !== secret) {
    return { statusCode: 403, body: 'Forbidden' };
  }
  try {
    initFirebase();
    const db = admin.firestore();
    const snap = await db.doc('users/aqzJe5gq4IVYdKmUIW0pNJGL2ML2/data/main').get();
    const data = snap.exists ? snap.data() : {};
    const today = todayPacific();
    const dayName = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long' });
    const monthDay = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric' });
    const [weather, ttAllEvents] = await Promise.all([
      fetchWeather(),
      timetree.getUpcomingEvents(7).catch(() => []),
    ]);

    const overdue  = (data.projects || []).filter(t => !t.done && t.due && t.due < today).sort((a, b) => a.due < b.due ? -1 : 1);
    const dueToday = (data.projects || []).filter(t => !t.done && t.due === today);
    const upcoming = (data.projects || []).filter(t => !t.done && t.due && t.due > today).sort((a, b) => a.due < b.due ? -1 : 1).slice(0, 3);
    const todayEvents = (data.events || []).filter(e => e.date === today).sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    // Filter TimeTree to today's date in Pacific time, then split by owner
    const ttToday = ttAllEvents.filter(e => {
      const d = new Date(e.start_at).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
      return d === today;
    });
    const ttDan   = ttToday.filter(timetree.isDanEvent);
    const ttJulia = ttToday.filter(e => !timetree.isDanEvent(e));
    const dailyHabits = (data.habits || []).filter(h => h.type === 'daily' || !h.type);
    const budget = Math.round(data.budget?.monthly || data.budget?.income || 0);
    const now = new Date();
    const spent = Math.round((data.transactions || []).filter(t => {
      const d = new Date(t.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && t.type === 'out';
    }).reduce((s, t) => s + (t.amount || 0), 0));
    const budgetPct = budget > 0 ? Math.round(spent / budget * 100) : null;

    const lines = [];
    lines.push(`☀️ Good morning, Dan! Happy ${dayName}, ${monthDay}.`);
    lines.push('');

    if (weather) {
      const weatherEmoji = weather.rain ? '🌧️' : weather.temp > 80 ? '🌞' : weather.temp < 50 ? '🥶' : '🌤️';
      lines.push(`${weatherEmoji} ${weather.temp}°F, ${weather.desc}. Feels like ${weather.feelsLike}°F.${weather.rain ? ' Umbrella weather today.' : ''}`);
      lines.push('');
    }

    if (overdue.length) {
      lines.push(`🔴 Overdue — ${overdue.length} task${overdue.length > 1 ? 's' : ''} not done:`);
      overdue.forEach(t => lines.push(`  • ${t.name} (was due ${humanDate(t.due, today)})`));
      lines.push('');
    } else {
      lines.push(`✅ No overdue tasks.`);
      lines.push('');
    }

    if (dueToday.length) {
      lines.push(`📋 Due today:`);
      dueToday.forEach(t => lines.push(`  • ${t.name}`));
      lines.push('');
    }

    if (upcoming.length) {
      lines.push(`📅 Coming up:`);
      upcoming.forEach(t => lines.push(`  • ${t.name} — ${humanDate(t.due, today)}`));
      lines.push('');
    }

    // Dan's schedule: TimeTree events classified as Dan's + dashboard events
    const danSchedule = [
      ...ttDan.map(e => ({
        time: e.all_day ? '' : e.startTime,
        name: e.title,
        allDay: e.all_day,
        end: e.endTime,
      })),
      ...todayEvents.map(e => ({ time: e.time || '', name: e.name, allDay: false, end: null })),
    ].sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    if (danSchedule.length) {
      lines.push(`📅 Your schedule today:`);
      danSchedule.forEach(e => {
        const t = e.allDay ? '[all day]' : e.time ? `${e.time}${e.end ? '–'+e.end : ''}` : '';
        lines.push(`  • ${t ? t + ' — ' : ''}${e.name}`);
      });
      lines.push('');
    }

    if (ttJulia.length) {
      lines.push(`💜 Julia's plans today:`);
      ttJulia.forEach(e => {
        const t = e.all_day ? '[all day]' : e.startTime ? `${e.startTime}${e.endTime ? '–'+e.endTime : ''}` : '';
        lines.push(`  • ${t ? t + ' — ' : ''}${e.title}`);
      });
      lines.push('');
    }

    if (dailyHabits.length) {
      lines.push(`💪 Habits: ${dailyHabits.map(h => h.name).join(', ')}`);
      lines.push('');
    }

    if (budgetPct !== null) {
      const emoji = budgetPct > 90 ? '🔴' : budgetPct > 70 ? '🟡' : '🟢';
      lines.push(`${emoji} ${fmt(spent)} spent of ${fmt(budget)} this month (${budgetPct}%)`);
      lines.push('');
    }

    // ── AI daily note ──────────────────────────────────────────────
    const aiPrompt = `You are Dan's personal AI assistant sending him a morning briefing. Write 2-3 sentences spoken directly to him — warm, direct, like a trusted friend who knows his life. Don't greet him (already done). Don't recap the list. Just give him a moment of real perspective on his day: what actually matters, what to watch out for, or something worth thinking about. Keep it grounded and specific to what's below.

Today: ${dayName}, ${monthDay}
${weather ? `Weather: ${weather.temp}°F, ${weather.desc}` : ''}
Overdue tasks: ${overdue.length ? overdue.map(t => t.name).join(', ') : 'none'}
Due today: ${dueToday.length ? dueToday.map(t => t.name).join(', ') : 'nothing'}
Dan's schedule today: ${danSchedule.length ? danSchedule.map(e => (e.time||'all day') + ' ' + e.name).join(', ') : 'nothing scheduled'}
Julia's plans today: ${ttJulia.length ? ttJulia.map(e => (e.startTime||'all day') + ' ' + e.title).join(', ') : 'none'}
Coming up: ${upcoming.length ? upcoming.map(t => t.name + ' (' + humanDate(t.due, today) + ')').join(', ') : 'nothing'}
${budgetPct !== null ? `Budget: ${budgetPct}% used this month` : ''}`;

    const aiNote = await callClaude(aiPrompt);
    if (aiNote) {
      lines.push('─────────────────────');
      lines.push(aiNote);
    }

    await sendTelegram(lines.join('\n'));
    return { statusCode: 200, body: 'OK' };
  } catch (e) {
    console.error('Morning briefing error:', e);
    return { statusCode: 500, body: e.message };
  }
};
