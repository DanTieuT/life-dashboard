const https = require('https');
const admin = require('firebase-admin');

// Fallback: load .env when netlify dev skips long-value vars
try {
  const fs = require('fs'), path = require('path');
  fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s]+)=(.+)$/);
    if (m) process.env[m[1]] = m[2].trim();
  });
} catch {}

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

function callClaude(prompt) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 400,
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

exports.handler = async (event) => {
  const secret = process.env.CRON_SECRET;
  const provided = (event?.queryStringParameters?.secret) || '';
  if (secret && provided !== secret) return { statusCode: 403, body: 'Forbidden' };

  try {
    initFirebase();
    const db = admin.firestore();
    const snap = await db.doc('users/aqzJe5gq4IVYdKmUIW0pNJGL2ML2/data/main').get();
    const data = snap.exists ? snap.data() : {};

    const today = todayPacific();
    const todayDate = new Date(today + 'T12:00:00');

    // Week boundaries: last Monday → last Sunday (the week just finished)
    const dayOfWeek = todayDate.getDay(); // 0=Sun
    const daysToLastMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(todayDate);
    weekStart.setDate(todayDate.getDate() - daysToLastMon - 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const weekStartStr = weekStart.toISOString().slice(0, 10);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);
    const weekLabel = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      + ' – ' + weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    // Tasks completed this week
    const completedTasks = (data.projects || []).filter(t =>
      t.done && t.completedAt && t.completedAt >= weekStartStr && t.completedAt <= weekEndStr
    );
    // Tasks that were due this week (completed or not)
    const dueTasks = (data.projects || []).filter(t => t.due >= weekStartStr && t.due <= weekEndStr);
    const overdueTasks = (data.projects || []).filter(t => !t.done && t.due < today);

    // Habits logged this week
    const habitLogs = data.habitLogs || {};
    const dailyHabits = (data.habits || []).filter(h => h.type === 'daily' || !h.type);
    const habitSummary = dailyHabits.map(h => {
      let streak = 0;
      const d = new Date(today + 'T12:00:00');
      while (true) {
        const ds = d.toISOString().slice(0, 10);
        if ((habitLogs[h.id] || []).includes(ds)) { streak++; d.setDate(d.getDate() - 1); }
        else break;
      }
      const thisWeek = [0,1,2,3,4,5,6].filter(i => {
        const ds2 = new Date(weekStart); ds2.setDate(weekStart.getDate() + i);
        return (habitLogs[h.id] || []).includes(ds2.toISOString().slice(0, 10));
      }).length;
      return { name: h.name, thisWeek, streak };
    });

    // Spending this week and this month
    const now = new Date();
    const weekTransactions = (data.transactions || []).filter(t =>
      t.type === 'out' && t.date >= weekStartStr && t.date <= weekEndStr
    );
    const monthTransactions = (data.transactions || []).filter(t => {
      const d = new Date(t.date);
      return t.type === 'out' && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const weekSpent = weekTransactions.reduce((s, t) => s + (t.amount || 0), 0);
    const monthSpent = monthTransactions.reduce((s, t) => s + (t.amount || 0), 0);
    const budget = Math.round(data.budget?.monthly || 0);
    const budgetPct = budget > 0 ? Math.round(monthSpent / budget * 100) : null;

    // Spending by category this week
    const byCategory = {};
    weekTransactions.forEach(t => {
      const cat = t.category || 'Other';
      byCategory[cat] = (byCategory[cat] || 0) + (t.amount || 0);
    });
    const topCategories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 3);

    // TimeTree: upcoming week ahead
    const ttEvents = await timetree.getUpcomingEvents(7).catch(() => []);
    const nextWeekStr = new Date(today + 'T12:00:00');
    nextWeekStr.setDate(nextWeekStr.getDate() + 7);
    const danNext = ttEvents.filter(timetree.isDanEvent).slice(0, 5);
    const juliaNext = ttEvents.filter(e => !timetree.isDanEvent(e)).slice(0, 3);

    // Build the message
    const lines = [];
    lines.push(`📋 Weekly Review — ${weekLabel}`);
    lines.push('');

    // Tasks
    lines.push('✅ Tasks completed this week:');
    if (completedTasks.length) completedTasks.forEach(t => lines.push(`  • ${t.name}`));
    else lines.push('  • None logged');
    if (overdueTasks.length) {
      lines.push(`\n⚠️ Still overdue (${overdueTasks.length}):`);
      overdueTasks.slice(0, 3).forEach(t => lines.push(`  • ${t.name} (due ${t.due})`));
      if (overdueTasks.length > 3) lines.push(`  • +${overdueTasks.length - 3} more`);
    }
    lines.push('');

    // Habits
    if (dailyHabits.length) {
      lines.push('💪 Habit streaks:');
      habitSummary.forEach(h => {
        const bar = '▓'.repeat(h.thisWeek) + '░'.repeat(7 - h.thisWeek);
        lines.push(`  ${h.name}: ${bar} ${h.thisWeek}/7 days${h.streak > 1 ? ` · 🔥 ${h.streak}d streak` : ''}`);
      });
      lines.push('');
    }

    // Spending
    lines.push(`💸 Spending this week: ${fmt(weekSpent)}`);
    if (topCategories.length) {
      topCategories.forEach(([cat, amt]) => lines.push(`  • ${cat}: ${fmt(amt)}`));
    }
    if (budgetPct !== null) {
      const emoji = budgetPct > 90 ? '🔴' : budgetPct > 70 ? '🟡' : '🟢';
      lines.push(`${emoji} Month total: ${fmt(monthSpent)} of ${fmt(budget)} (${budgetPct}%)`);
    }
    lines.push('');

    // Week ahead
    if (danNext.length) {
      lines.push('📅 Your week ahead:');
      danNext.forEach(e => {
        const t = e.all_day ? '' : ` ${e.startTime}`;
        lines.push(`  • ${e.dateLabel}${t} — ${e.title}`);
      });
    }
    if (juliaNext.length) {
      lines.push("💜 Julia's week ahead:");
      juliaNext.forEach(e => {
        const t = e.all_day ? '' : ` ${e.startTime}`;
        lines.push(`  • ${e.dateLabel}${t} — ${e.title}`);
      });
    }
    lines.push('');

    // AI reflection
    const aiPrompt = `You are Dan's personal AI assistant writing him a Sunday evening weekly review. Write 3-4 sentences of honest, warm reflection on the week. Be direct and personal — not generic. Mention specifics where possible.

Week: ${weekLabel}
Tasks completed: ${completedTasks.length ? completedTasks.map(t => t.name).join(', ') : 'none'}
Overdue tasks: ${overdueTasks.length ? overdueTasks.map(t => t.name).join(', ') : 'none'}
Habit performance: ${habitSummary.map(h => `${h.name} ${h.thisWeek}/7 days`).join(', ') || 'no data'}
Spent this week: ${fmt(weekSpent)}${budgetPct !== null ? ` (${budgetPct}% of monthly budget used)` : ''}
Coming up: ${danNext.map(e => e.title).join(', ') || 'nothing scheduled'}

Close with one short encouraging or grounding thought for the week ahead.`;

    const aiNote = await callClaude(aiPrompt);
    if (aiNote) {
      lines.push('─────────────────────');
      lines.push(aiNote);
    }

    await sendTelegram(lines.join('\n'));
    return { statusCode: 200, body: 'OK' };
  } catch (e) {
    console.error('Weekly review error:', e);
    return { statusCode: 500, body: e.message };
  }
};
