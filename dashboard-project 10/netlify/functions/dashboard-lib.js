// dashboard-lib.js — shared read/write logic for Dan's dashboard data.
//
// Extracted from telegram.js (JARVIS on Telegram already read/wrote this
// data server-side, no browser involved — this just makes that logic
// callable from more than one place). No exports.handler here, so Netlify
// doesn't treat this as a routable function (same pattern as tts.js /
// apple-calendar.js / finance-tools.mjs).
//
// Consumers: telegram.js (Telegram JARVIS), dashboard-context.js and
// dashboard-actions.js (the ChatGPT bridge — see CHATGPT_BRIDGE.md).

const calendarSvc = require('./apple-calendar.js');

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

// ── Build context object (mirrors buildChatContext in index.html) ──
function buildContext(data) {
  const today = todayStr();
  const now = new Date();
  // Netlify servers run UTC — always format in Pacific or the day name is
  // wrong every evening after 5pm PT (midnight UTC).
  const dayName = now.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long' });
  const monthName = now.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long' });

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

  // ── Reminders ──────────────────────────────────────────────────
  const nowPT = now.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: false });
  const reminders = (data.reminders || []).filter(r => !r.sent).sort((a, b) => a.dueAt - b.dueAt).slice(0, 15).map(r => ({
    id: r.id, text: r.text, recurrence: r.recurrence || '',
    when: new Date(r.dueAt).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
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
    nowPT, reminders,
  };
}

// Converts a Pacific-time "YYYY-MM-DD" + "HH:MM" to epoch ms, handling
// PDT (-07:00) vs PST (-08:00) by checking which offset round-trips.
function ptToEpoch(dateStr, timeStr) {
  for (const off of ['-07:00', '-08:00']) {
    const d = new Date(`${dateStr}T${timeStr}:00${off}`);
    if (isNaN(d)) continue;
    const back = d.toLocaleString('sv-SE', { timeZone: 'America/Los_Angeles' }); // "YYYY-MM-DD HH:MM:SS"
    if (back.startsWith(`${dateStr} ${timeStr}`)) return d.getTime();
  }
  return Date.parse(`${dateStr}T${timeStr}:00-07:00`); // fallback
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
      case 'add_calendar_event':
        labels.push(`Calendar: ${action.title} on ${action.date}`);
        break;
      case 'update_calendar_event':
        labels.push(`Updated event: ${action.title || action.event_id}`);
        break;
      case 'delete_calendar_event':
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
      case 'add_reminder': {
        const dueAt = ptToEpoch(action.date, action.time || '09:00');
        if (!dueAt || isNaN(dueAt)) { labels.push('Reminder failed: bad date/time'); break; }
        data.reminders = data.reminders || [];
        data.reminders.push({
          id: uidGen(), text: action.text || 'Reminder', dueAt,
          recurrence: action.recurrence || '', sent: false,
          createdAt: Date.now(), source: 'jarvis',
        });
        labels.push(`Reminder set`);
        break;
      }
      case 'cancel_reminder': {
        const before = (data.reminders || []).length;
        data.reminders = (data.reminders || []).filter(r => r.id !== action.id);
        labels.push(before !== data.reminders.length ? 'Reminder cancelled' : 'Reminder not found');
        break;
      }
    }
  }
  return { labels, spendingAlert };
}

// Async Apple Calendar side effects for the three calendar action types —
// applyActions() only writes a label for these; the actual CalDAV call
// happens here so both callers (telegram.js, dashboard-actions.js) get
// identical calendar behavior instead of duplicating this loop.
async function runCalendarSideEffects(actions) {
  for (const action of (actions || [])) {
    if (action.type === 'add_calendar_event' && action.title && action.date) {
      try {
        await calendarSvc.createEvent({
          title: action.title,
          date: action.date,
          time: action.time || null,
          endDate: action.end_date || null,
          endTime: action.end_time || null,
          allDay: action.all_day || false,
          location: action.location || null,
          note: action.note || null,
          recurrence: action.recurrence || null,
          calendar: action.calendar || null,
        });
        console.log('Calendar event created:', action.title, '->', action.calendar || 'Shared D+J (default)');
      } catch (e) {
        console.error('Calendar createEvent error:', e.message);
      }
    }
    if (action.type === 'update_calendar_event' && action.event_id) {
      try {
        await calendarSvc.updateEvent(action.event_id, {
          title: action.title,
          date: action.date,
          time: action.time,
          endDate: action.end_date,
          endTime: action.end_time,
          allDay: action.all_day,
          location: action.location,
          note: action.note,
        });
        console.log('Calendar event updated:', action.event_id);
      } catch (e) {
        console.error('Calendar updateEvent error:', e.message);
      }
    }
    if (action.type === 'delete_calendar_event' && action.event_id) {
      try {
        await calendarSvc.deleteEvent(action.event_id);
        console.log('Calendar event deleted:', action.event_id);
      } catch (e) {
        console.error('Calendar deleteEvent error:', e.message);
      }
    }
  }
}

module.exports = {
  uidGen, todayStr, isRDO, buildContext, ptToEpoch, findById, applyActions,
  runCalendarSideEffects, calendarSvc,
};
