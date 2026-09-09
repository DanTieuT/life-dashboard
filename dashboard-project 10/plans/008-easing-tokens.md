# 008 — Add easing tokens and adopt them in the high-traffic transitions

- **Status**: DONE (branch redesign/animation-polish)
- **Commit**: b25cd86
- **Severity**: LOW
- **Category**: Cohesion & tokens
- **Estimated scope**: 1 file (`styles.css`), ~5 token lines + ~15 transition edits

## Problem

`styles.css` has no easing tokens. ~90% of transitions use the bare default
`ease`; only two rules use a custom curve, and they disagree
(`cubic-bezier(.2,.8,.2,1)` at :375, `cubic-bezier(.2,.8,.3,1)` at :416).
Default `ease` is too weak for deliberate UI motion, and hand-typed near-matches
are a consolidation smell.

## Target

Add a small, named curve set to `:root` (values from AUDIT.md, verbatim):

```css
/* target — add inside the :root{} block in styles.css, near --radius (~line 15) */
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);       /* entering/exiting UI, press release */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);   /* on-screen move/morph */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);    /* iOS-like drawer/sheet */
```

Then adopt `var(--ease-out)` in the transitions the user feels most often. Do
**not** sweep all ~120 transitions — target these:

| Selector | file:line | Change |
| --- | --- | --- |
| `.btn-new` | styles.css:59 | `transform .08s ease-out` → `transform .08s var(--ease-out)` |
| `.nav-tab` | styles.css:50 | (after plan 001) add `var(--ease-out)` to each listed prop |
| `.nw-range-btn` | styles.css:1289 | (after plan 001) `var(--ease-out)` on the props |
| `.nw-collapse-btn` | styles.css:1285 | `transform .08s ease-out` → `var(--ease-out)` |
| `.fin-more-btn` | styles.css:1302 | `transform .08s ease-out` → `var(--ease-out)` |
| `.goal-icon` | styles.css:375 | `cubic-bezier(.2,.8,.2,1)` → `var(--ease-out)` |
| `.modal-overlay.open .modal` | styles.css:416 | `cubic-bezier(.2,.8,.3,1)` → `var(--ease-drawer)` (it is a sheet-like materialise) |
| `.fin-more-menu.open` | styles.css:1309 | `cubic-bezier(.2,.8,.3,1)` → `var(--ease-out)` (small popover) |
| `.page` (from plan 002) | styles.css | `opacity 120ms ease-out` → `opacity 120ms var(--ease-out)` |

## Alignment with the redesign

The editorial redesign's `design-canvas/tokens.css` also defines motion tokens
(`--ease: cubic-bezier(0.16, 1, 0.3, 1)`). When that file becomes the app's
token source, **reconcile the names**: keep `--ease-out`, `--ease-in-out`,
`--ease-drawer` as the canonical set and drop the generic `--ease`. Flag this in
your report so it is not forgotten; do not edit `tokens.css` in this plan.

## Repo conventions to follow

- `:root` custom props in this file are grouped and semicolon-packed
  (`--radius:20px;--radius-lg:26px;--radius-sm:10px;`). Add the three curves as
  their own short line with a comment, matching that density.
- There is a second `:root` / `[data-theme="light"]` block for colours — put the
  curves in the **first** `:root` (the one with `--radius`), not the theme one
  (curves don't change per theme).

## Steps

1. Add the three `--ease-*` custom properties to the main `:root` block.
2. Apply `var(--ease-out)` / `var(--ease-drawer)` to exactly the rows in the
   Target table. If plan 001 has not run yet, still do `.btn-new`, `.goal-icon`,
   the modal/menu, `.nw-collapse-btn`, `.fin-more-btn`, `.page`; leave `.nav-tab`
   / `.nw-range-btn` for whoever runs 001 (note it in the report).
3. Grep `grep -n "cubic-bezier(.2,.8" styles.css` — should return nothing after.

## Boundaries

- Do NOT mass-replace `ease` across the whole file — only the Target table.
- Do NOT change any duration.
- Do NOT add `--ease-in` (there is no correct use for it in UI).
- Do NOT touch `design-canvas/tokens.css` or `.dc.html` files.
- If a Target line has drifted from the excerpt, skip that one and report it.

## Verification

- **Mechanical**: `grep -n "\-\-ease-out" styles.css` shows the definition plus
  the adopted uses. App loads, no console errors.
- **Feel check**:
  - Press `.btn-new` ("+ New"): the release feels like it has a bit more snap
    than the old default `ease` — starts fast, settles clean.
  - Open the finance "⋯" menu and a modal: both materialise with a firmer curve,
    no change to duration.
  - Side-by-side (git stash / unstash) the modal open at 10% DevTools speed:
    new curve reaches ~80% scale faster, then eases the last bit.
- **Done when**: three easing tokens exist in `:root`, the listed high-traffic
  transitions use them, and no `cubic-bezier(.2,.8,...)` literals remain.
