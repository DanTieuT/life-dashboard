// Browser smoke test — loads the app in headless Chrome and fails on any
// console error or non-rendering tab. Run with: npm test
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';

const PORT = 3457;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TABS = ['dashboard', 'tasks', 'calendar', 'finance', 'projects'];

const fail = (msg) => { console.error('✗ ' + msg); process.exitCode = 1; };
const ok = (msg) => console.log('✓ ' + msg);

// 1. Start a static server
const server = spawn('npx', ['serve', '-p', String(PORT), '.'], { stdio: 'ignore' });
await new Promise((res) => setTimeout(res, 2500));

let browser;
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((res) => setTimeout(res, 1500));

  // Headless Chrome freezes CSS animations at frame 0, which pins animated
  // elements at their from-keyframe (opacity 0). Disable animations — this
  // test checks rendering, not motion.
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });

  // Firestore/auth network noise isn't a test failure; JS errors are.
  const jsErrors = consoleErrors.filter((e) => !/firestore|firebase|googleapis|net::|Failed to load resource/i.test(e));
  if (jsErrors.length) fail('console errors on load:\n  ' + jsErrors.join('\n  '));
  else ok('no console errors on load');

  // 2. Reveal the app (no auth in test) and walk every tab
  await page.evaluate(() => {
    document.getElementById('auth-screen').style.display = 'none';
    const app = document.getElementById('app');
    app.style.display = 'flex';
    app.style.flexDirection = 'column';
  });

  for (const tab of TABS) {
    const result = await page.evaluate((t) => {
      try {
        window.switchTab(t);
        const el = document.getElementById('page-' + t);
        if (!el) return 'missing element';
        const cs = getComputedStyle(el);
        if (cs.display !== 'block') return 'not visible (display: ' + cs.display + ')';
        if (parseFloat(cs.opacity) === 0) return 'opacity 0';
        if (el.textContent.trim().length < 20) return 'no content';
        return 'ok';
      } catch (e) { return 'throws: ' + e.message; }
    }, tab);
    if (result === 'ok') ok(`tab ${tab} renders`);
    else fail(`tab ${tab}: ${result}`);
  }

  // 3. Open + close the main modals
  for (const [name, open, modalId] of [
    ['task modal', 'openNewTaskModal', 'newTaskModal'],
    ['habit modal', 'openAddHabitModal', 'addHabitModal'],
    ['transaction modal', 'openTxnModal', 'txnModal'],
  ]) {
    const result = await page.evaluate(([fn, id]) => {
      try {
        window[fn]();
        const opened = document.getElementById(id).classList.contains('open');
        window.closeModal(id);
        const closed = !document.getElementById(id).classList.contains('open');
        return opened && closed ? 'ok' : 'did not toggle';
      } catch (e) { return 'throws: ' + e.message; }
    }, [open, modalId]);
    if (result === 'ok') ok(`${name} opens and closes`);
    else fail(`${name}: ${result}`);
  }

  // 4. Inline-handler audit: every on*= function must exist on window
  const missing = await page.evaluate(() => {
    const names = new Set();
    for (const el of document.querySelectorAll('*')) {
      for (const attr of el.attributes) {
        if (!attr.name.startsWith('on')) continue;
        for (const m of attr.value.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) names.add(m[1]);
      }
    }
    const builtins = new Set(['if', 'confirm', 'alert', 'event', 'blur', 'stopPropagation', 'preventDefault', 'parseFloat', 'parseInt']);
    return [...names].filter((n) => !builtins.has(n) && typeof window[n] !== 'function');
  });
  if (missing.length) fail('inline handlers reference missing globals: ' + missing.join(', '));
  else ok('all inline handlers resolve to window functions');

  const lateErrors = consoleErrors.filter((e) => !/firestore|firebase|googleapis|net::|Failed to load resource/i.test(e));
  if (lateErrors.length > jsErrors.length) fail('console errors during interaction:\n  ' + lateErrors.slice(jsErrors.length).join('\n  '));
  else ok('no console errors during interaction');
} catch (e) {
  fail('smoke test crashed: ' + e.message);
} finally {
  if (browser) await browser.close();
  server.kill();
}

console.log(process.exitCode ? '\nSMOKE TEST FAILED' : '\nSMOKE TEST PASSED');
