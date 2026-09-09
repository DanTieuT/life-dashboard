# 001 — Replace `transition: all` with explicit properties

- **Status**: DONE (branch redesign/animation-polish)
- **Commit**: b25cd86
- **Severity**: HIGH
- **Category**: Easing & duration / Performance
- **Estimated scope**: 1 file (`styles.css`), ~26 one-line edits

## Problem

`styles.css` uses `transition: all` in ~26 rules. `all` transitions every
animatable property — including `background`, `color`, `border-color`,
`box-shadow`, and sometimes `width`/`transform` — on any state change. That
animates properties off the GPU (layout/paint) and animates changes you did not
intend to animate. It also makes future edits fragile: adding a `transform` to
`:active` silently gets a 150ms tween.

Representative locations (run `grep -n "transition:all" styles.css` for the full list):

```css
/* styles.css:50 — current */
.nav-tab{...;transition:all .15s;...}
/* styles.css:57 — current */
.nav-theme-btn{...;transition:all .15s}
/* styles.css:136 — current */
.focus-num{...;transition:all .2s}
/* styles.css:207 — current */
.habit-tab-pill{...;transition:all .15s;}
/* styles.css:1289 — current */
.nw-range-btn{...;transition:all .12s}
```

## Target

Each `transition: all <dur>` becomes an explicit list of only the properties
that actually change on `:hover` / `:active` / `.active` for that selector.
Keep the existing duration. In almost every case here the animated properties
are `background-color`, `color`, and `border-color`; a few also change
`opacity` or `box-shadow`.

```css
/* target — styles.css:50 */
.nav-tab{...;transition:background-color .15s,color .15s;...}
/* target — styles.css:57 */
.nav-theme-btn{...;transition:background-color .15s,color .15s,border-color .15s}
/* target — styles.css:1289 */
.nw-range-btn{...;transition:background-color .12s,color .12s}
```

Rules that ALSO have a `:active{transform:scale(...)}` (e.g. `.nw-range-btn:active`
at :1290, `.goal-icon`) must additionally list `transform`:

```css
/* target — styles.css:1289, because .nw-range-btn:active does transform:scale(.93) */
.nw-range-btn{...;transition:background-color .12s,color .12s,transform .12s}
```

## How to decide the property list per rule

For each rule with `transition: all`:

1. Find every `:hover`, `:active`, `.active`, `.open`, `.armed`, `.listening`
   variant of that selector in `styles.css`.
2. List which CSS properties differ in those variants (`background`,
   `color`, `border-color`, `opacity`, `box-shadow`, `transform`, `filter`).
3. Replace `all` with exactly those, each with the original duration.
4. If a variant changes `width`/`height`/`padding`/`margin`, do NOT add it —
   leave that property out of the transition (it should not animate). Note it
   in your report.

## Repo conventions to follow

- No easing tokens exist yet at this commit. Do NOT introduce curves in this
  plan — keep the bare duration (`transition:background-color .15s`). Plan 008
  adds `--ease-out` and re-touches the high-traffic ones.
- Multi-property transitions in this file are already written comma-separated
  on one line, e.g. `styles.css:59`
  `.btn-new{...;transition:transform .08s ease-out,filter .1s}` — match that style.

## Steps

1. `grep -n "transition:all" styles.css` — capture all line numbers.
2. For each, apply the decision procedure above and replace `all` with the
   explicit property list at the same duration.
3. Leave `styles.css:1128` (`.settings-toggle` area — inside the `.profile-*`
   block) and any `transition:all` inside a `@media` block handled the same way.
4. Re-run the grep — expect **zero** matches.

## Boundaries

- Do NOT touch `js/`, `index.html`, or any `.dc.html` file.
- Do NOT change durations, add easing curves, or add `will-change`.
- Do NOT add or remove `:hover`/`:active` rules — transition property lists only.
- If a rule has `transition: all` but you cannot find any state variant that
  changes any property, set `transition: none` and note it in your report.
- If a step doesn't match the code (drift since b25cd86), STOP and report.

## Verification

- **Mechanical**: `grep -c "transition:all" styles.css` returns `0`. App still
  loads (`npx serve -p 3456 .`, open `http://localhost:3456`, no console errors).
- **Feel check**: hover and press the top nav tabs, the `.nw-range-btn` chips,
  the habit pills, and the project filter buttons:
  - Color/background still fades on hover at the same speed as before.
  - Press (`:active`) scale on `.nw-range-btn` / `.goal-icon` still fires and is
    not "gummy" (no stray property lagging behind).
  - In DevTools Animations panel at 10% speed, confirm only the intended
    properties move — nothing animating `width`/`border-radius`/`box-shadow`
    unexpectedly.
- **Done when**: zero `transition:all` in `styles.css`, and no visible change to
  hover/press behavior except that it feels slightly crisper.
