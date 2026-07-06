// Entry point — loads all modules in dependency order.
// Each module attaches its public API to window so inline on*= handlers work.
import './core.js';
import './habits.js';
import './tasks.js';
import './projects.js';
import './finance.js';
import './calendar.js';
import './dashboard.js';
import './shipping.js';
import './plaid.js';
