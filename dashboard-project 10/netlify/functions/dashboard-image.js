const { Resvg } = require('@resvg/resvg-js');

const W = 800, H = 520;
const BG = '#0a0a0c';
const CARD = '#111115';
const CARD2 = '#18181d';
const BORDER = 'rgba(255,255,255,0.07)';
const TEXT = '#f0f0f5';
const SUB = '#8888a0';
const MUTED = '#55556a';
const GREEN = '#3dffa0';
const YELLOW = '#ffd600';
const RED = '#ff5f5f';
const BLUE = '#93b5ff';

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function humanDate(dateStr, today) {
  const d = new Date(dateStr + 'T12:00:00');
  const t = new Date(today + 'T12:00:00');
  const diff = Math.round((d - t) / 86400000);
  const md = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const wd = d.toLocaleDateString('en-US', { weekday: 'short' });
  if (diff > 1 && diff <= 6) return `${wd} (${md})`;
  if (diff >= 7 && diff <= 13) return `Next ${wd}`;
  if (diff < -1 && diff >= -6) return `${wd} (${md})`;
  return md;
}

function card(x, y, w, h) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${CARD}" stroke="${BORDER}" stroke-width="1"/>`;
}

function label(txt, x, y, color = MUTED, size = 10, weight = '700') {
  return `<text x="${x}" y="${y}" font-family="system-ui,sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}" letter-spacing="0.8">${esc(txt.toUpperCase())}</text>`;
}

function text(txt, x, y, color = TEXT, size = 13, weight = '500', anchor = 'start') {
  return `<text x="${x}" y="${y}" font-family="system-ui,sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${esc(txt)}</text>`;
}

function pill(txt, x, y, bg, color, w = 80) {
  return `<rect x="${x}" y="${y - 11}" width="${w}" height="16" rx="5" fill="${bg}"/>
          <text x="${x + w / 2}" y="${y}" font-family="system-ui,sans-serif" font-size="9" font-weight="600" fill="${color}" text-anchor="middle">${esc(txt)}</text>`;
}

function dot(x, y, color) {
  return `<circle cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`;
}

exports.buildDashboardSvg = function(data) {
  // Netlify servers run UTC — compute "today" in Pacific or evening renders
  // (5pm–midnight PT) shift every task/date off by one day.
  const now = new Date();
  const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const dayName = now.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long' });
  const dateLabel = now.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric' });

  const allTasks = data.projects || [];
  const overdue = allTasks.filter(t => !t.done && t.due && t.due < today).sort((a, b) => a.due < b.due ? -1 : 1);
  const todayTasks = allTasks.filter(t => !t.done && t.due === today);
  const upcoming = allTasks.filter(t => !t.done && t.due && t.due > today).sort((a, b) => a.due < b.due ? -1 : 1);
  const taskRows = [...overdue, ...todayTasks, ...upcoming].slice(0, 6);

  const todayEvents = (data.events || []).filter(e => e.date === today).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const dailyHabits = (data.habits || []).filter(h => h.type === 'daily' || !h.type);
  const habitsDoneToday = dailyHabits.filter(h => h.log && h.log[today]).length;

  const budget = Math.round(data.budget?.monthly || data.budget?.income || 0);
  const spent = Math.round((data.transactions || []).filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && t.type === 'out';
  }).reduce((s, t) => s + (t.amount || 0), 0));
  const budgetPct = budget > 0 ? Math.round(spent / budget * 100) : null;

  const projects = (data.userProjects || []).slice(0, 3);

  const stageColors = { planning: SUB, sourcing: YELLOW, building: GREEN, blocked: RED, done: GREEN };
  const stageLabels = { planning: 'Planning', sourcing: 'Sourcing', building: 'Building', blocked: 'Blocked', done: 'Done' };

  const els = [];

  // ── Background
  els.push(`<rect width="${W}" height="${H}" fill="${BG}"/>`);

  // ── Header bar
  els.push(`<rect width="${W}" height="52" fill="${CARD2}"/>`);
  // Gem icon
  els.push(`<rect x="18" y="12" width="28" height="28" rx="8" fill="#0e3320"/>`);
  els.push(`<text x="32" y="30" font-family="system-ui,sans-serif" font-size="14" text-anchor="middle" fill="${GREEN}">◆</text>`);
  els.push(text('Command Center', 54, 30, TEXT, 14, '700'));
  els.push(text(`${dayName}, ${dateLabel}`, W - 18, 30, SUB, 12, '400', 'end'));

  // ── LEFT COLUMN: Tasks (x=18, w=350)
  const TX = 18, TY = 70, TW = 350, TH = 290;
  els.push(card(TX, TY, TW, TH));
  els.push(label('Tasks', TX + 16, TY + 20));

  let ty = TY + 38;
  if (taskRows.length === 0) {
    els.push(text('All caught up! 🎉', TX + 16, ty + 14, MUTED, 12));
  } else {
    taskRows.forEach(t => {
      const isOver = t.due && t.due < today;
      const isToday = t.due === today;
      // circle
      els.push(`<circle cx="${TX + 28}" cy="${ty + 8}" r="7" fill="none" stroke="${isOver ? RED : isToday ? YELLOW : BORDER}" stroke-width="1.5"/>`);
      // task name
      const nameColor = isOver ? 'rgba(255,95,95,0.9)' : TEXT;
      els.push(text(truncate(t.name, 28), TX + 42, ty + 13, nameColor, 12, '500'));
      // due pill
      if (t.due) {
        const dueLabel = humanDate(t.due, today);
        const dueColor = isOver ? RED : isToday ? YELLOW : MUTED;
        els.push(text(dueLabel, TX + TW - 16, ty + 13, dueColor, 10, '500', 'end'));
      }
      ty += 30;
    });
  }
  if (allTasks.filter(t => !t.done).length > 6) {
    els.push(text(`+${allTasks.filter(t => !t.done).length - 6} more`, TX + 16, ty + 8, MUTED, 10, '400'));
  }

  // ── LEFT BOTTOM: Projects (x=18, y=375)
  const PY = 375, PH = 125;
  els.push(card(TX, PY, TW, PH));
  els.push(label('Projects', TX + 16, PY + 20));

  if (projects.length === 0) {
    els.push(text('No projects yet', TX + 16, PY + 44, MUTED, 12));
  } else {
    projects.forEach((p, i) => {
      const py2 = PY + 36 + i * 28;
      const col = stageColors[p.stage] || SUB;
      els.push(dot(TX + 24, py2 + 4, col));
      els.push(text(truncate(p.name, 26), TX + 36, py2 + 9, TEXT, 12, '500'));
      const sl = stageLabels[p.stage] || p.stage || '';
      els.push(text(sl, TX + TW - 16, py2 + 9, col, 10, '600', 'end'));
    });
  }

  // ── RIGHT TOP: Schedule (x=386, y=70, w=396, h=170)
  const SX = 386, SY = 70, SW = 396, SH = 170;
  els.push(card(SX, SY, SW, SH));
  els.push(label("Today's Schedule", SX + 16, SY + 20));

  if (todayEvents.length === 0) {
    els.push(text('Nothing scheduled today', SX + 16, SY + 56, MUTED, 12));
  } else {
    todayEvents.slice(0, 4).forEach((e, i) => {
      const ey = SY + 38 + i * 30;
      els.push(`<rect x="${SX + 16}" y="${ey}" width="3" height="18" rx="1.5" fill="${BLUE}"/>`);
      els.push(text(e.time || '—', SX + 26, ey + 13, BLUE, 11, '600'));
      els.push(text(truncate(e.name, 30), SX + 70, ey + 13, TEXT, 12, '500'));
    });
    if (todayEvents.length > 4) {
      els.push(text(`+${todayEvents.length - 4} more`, SX + 16, SY + SH - 12, MUTED, 10));
    }
  }

  // ── RIGHT MIDDLE: Habits (x=386, y=252, w=190, h=120)
  const HX = SX, HY = 252, HW = 190, HH = 120;
  els.push(card(HX, HY, HW, HH));
  els.push(label('Habits', HX + 16, HY + 20));
  const habitColor = habitsDoneToday === dailyHabits.length && dailyHabits.length > 0 ? GREEN : habitsDoneToday > 0 ? YELLOW : MUTED;
  els.push(text(`${habitsDoneToday} / ${dailyHabits.length}`, HX + 16, HY + 54, habitColor, 28, '700'));
  els.push(text('done today', HX + 16, HY + 72, MUTED, 11, '400'));
  // habit dots
  const dotY = HY + 95;
  dailyHabits.slice(0, 8).forEach((h, i) => {
    const done = h.log && h.log[today];
    els.push(`<circle cx="${HX + 16 + i * 20}" cy="${dotY}" r="7" fill="${done ? GREEN : CARD2}" stroke="${done ? GREEN : BORDER}" stroke-width="1.5"/>`);
    if (done) els.push(text('✓', HX + 16 + i * 20, dotY + 4, '#000', 8, '700', 'middle'));
  });

  // ── RIGHT BOTTOM: Finance (x=590, y=252, w=192, h=248)
  const FX = SX + HW + 8, FY = HY, FW = SW - HW - 8, FH = 248;
  els.push(card(FX, FY, FW, FH));
  els.push(label('Finance', FX + 16, FY + 20));

  if (budget > 0) {
    const pct = Math.min(budgetPct, 100);
    const barColor = budgetPct > 90 ? RED : budgetPct > 70 ? YELLOW : GREEN;
    els.push(text(`$${spent.toLocaleString()}`, FX + 16, FY + 58, TEXT, 26, '700'));
    els.push(text('spent this month', FX + 16, FY + 74, MUTED, 10, '400'));
    // progress bar
    const barX = FX + 16, barY = FY + 92, barW = FW - 32, barH = 8;
    els.push(`<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="4" fill="${CARD2}"/>`);
    els.push(`<rect x="${barX}" y="${barY}" width="${Math.round(barW * pct / 100)}" height="${barH}" rx="4" fill="${barColor}"/>`);
    els.push(text(`${budgetPct}% of $${budget.toLocaleString()}`, FX + 16, FY + 116, MUTED, 10, '400'));

    // recent transactions
    const recentTxns = (data.transactions || [])
      .filter(t => t.type === 'out')
      .sort((a, b) => b.date > a.date ? 1 : -1)
      .slice(0, 4);
    if (recentTxns.length) {
      els.push(label('Recent', FX + 16, FY + 140));
      recentTxns.forEach((t, i) => {
        const ty2 = FY + 152 + i * 24;
        els.push(text(truncate(t.name || t.category, 14), FX + 16, ty2 + 10, SUB, 10, '400'));
        els.push(text(`$${Math.round(t.amount).toLocaleString()}`, FX + FW - 16, ty2 + 10, TEXT, 11, '600', 'end'));
      });
    }
  } else {
    els.push(text('No budget set', FX + 16, FY + 58, MUTED, 12, '400'));
  }

  // ── Habits card continues below (weather strip)
  const WX = HX, WY = HY + HH + 8, WW = HW, WH = FH - HH - 8;
  els.push(card(WX, WY, WW, WH));
  els.push(label('Weather · Sacramento', WX + 16, WY + 20));
  els.push(text('See morning briefing', WX + 16, WY + 50, MUTED, 11, '400'));
  els.push(text('for live weather', WX + 16, WY + 66, MUTED, 11, '400'));

  // ── Footer
  els.push(text('Generated by Command Center', W / 2, H - 10, MUTED, 9, '400', 'middle'));

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  ${els.join('\n  ')}
</svg>`;
};

exports.buildDashboardPng = function(data) {
  const svg = exports.buildDashboardSvg(data);
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: W } });
  return resvg.render().asPng();
};
