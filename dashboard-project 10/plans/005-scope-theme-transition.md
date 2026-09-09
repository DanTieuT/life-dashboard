# 005 — Scope the theme-change transition to the switch itself

- **Status**: DONE (branch redesign/animation-polish)
- **Commit**: b25cd86
- **Severity**: MEDIUM
- **Category**: Performance / feel
- **Estimated scope**: `styles.css` (~3 lines) + `js/core.js` (~4 lines in the theme toggle)

## Problem

```css
/* styles.css:819 — current */
:root{transition:background-color .3s ease,color .3s ease,border-color .3s ease}
/* styles.css:823-824 — current */
.habit-card,.stat-card,...,
input,select,textarea,button{transition:background-color .3s ease,color .3s ease,border-color .3s ease}
```

This is always on. Its purpose is to cross-fade colors when the user flips
light/dark (good — abrupt theme jumps are jarring). But because it is
permanently applied to `button`, `input`, `.task-row`, `.txn-item`, etc., **every
hover and focus colour change on those elements is also forced through a 300ms
ease** — so buttons feel laggy and unresponsive on press/hover, the opposite of
"respond instantly".

## Target

Apply the 300ms color transition **only during a theme switch**, via a class on
`<html>` that is added when the theme changes and removed ~350ms later.

```css
/* target — replaces styles.css:819 and :823-824 */
html.theme-switching,
html.theme-switching *{
  transition: background-color .3s ease, color .3s ease, border-color .3s ease !important;
}
```

```js
/* target — in the theme toggle in js/core.js, wherever data-theme is set */
document.documentElement.classList.add('theme-switching');
document.documentElement.setAttribute('data-theme', next);   // existing line
// ...persist to storage (existing)...
setTimeout(() => document.documentElement.classList.remove('theme-switching'), 350);
```

Now: theme flip → smooth 300ms colour fade everywhere; normal hover/press →
whatever short transition that element declares itself (plan 001 gives them
`background-color .15s` etc.), no 300ms tax.

## Repo conventions to follow

- The theme is set via `data-theme` on `:root` / `<html>` — find the existing
  toggle (search `js/core.js` for `data-theme` and `setAttribute('data-theme'`).
  There is a `.nav-theme-btn` and a `toggleTheme`-style function.
- `!important` is already used in this file for the reduced-motion override
  (`styles.css:4`) — acceptable here for the same "win over everything briefly"
  reason.

## Steps

1. In `styles.css`, delete the always-on `:root{transition:...}` at :819.
2. Replace the big selector-list rule at :823-824 with the
   `html.theme-switching, html.theme-switching *` rule from Target.
3. In `js/core.js`, in the theme-toggle function: add
   `document.documentElement.classList.add('theme-switching')` before the
   `data-theme` change, and a `setTimeout(... 'theme-switching' ..., 350)` after.
4. Keep the `:root{transition:...}` for the theme-color `<meta>` if present —
   that is unrelated.

## Boundaries

- Do NOT remove or shorten any element's own `transition` declarations.
- Do NOT change how the theme value is stored or read.
- Do NOT touch `.dc.html` files or `tokens.css`.
- If there is no single theme-toggle function (e.g. theme is set in multiple
  places), add the class-add/remove to each, or add a tiny helper
  `function setTheme(t){ ... }` and route them through it — note this in the report.
- If the selector list at :823-824 has drifted, STOP and report.

## Verification

- **Mechanical**: app loads, no console errors. `grep -n "theme-switching" styles.css js/core.js`
  shows the rule and both class ops.
- **Feel check**:
  - Flip the theme: all card/text/border colours cross-fade over ~300ms, no
    hard flash. (DevTools Rendering → no jank.)
  - Immediately after, hover a nav tab / press `.btn-new`: the colour change is
    now snappy (~150ms or its own duration), NOT a 300ms drift.
  - Press-and-hold a button while flipping theme — no stuck transition state.
  - `prefers-reduced-motion: reduce` → theme flip is instant (global rule wins).
- **Done when**: the 300ms colour fade happens only on theme flip; interactive
  elements respond at their own (short) speed the rest of the time.
