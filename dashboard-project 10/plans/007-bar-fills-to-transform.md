# 007 — Animate bar fills / chart bars with transform, not width/height

- **Status**: PARTIAL (see plans/README.md)
- **Commit**: b25cd86
- **Severity**: LOW
- **Category**: Performance
- **Estimated scope**: 1 file (`styles.css`), ~12 rules; possibly a few inline-style writes in `js/` (see Boundaries)

## Problem

Progress bars and mini chart bars animate `width` or `height` — layout
properties that trigger layout + paint + composite every frame:

```css
/* styles.css:125 — current */
.mini-bar{flex:1;border-radius:2px 2px 0 0;min-height:3px;transition:height .3s}
/* styles.css:1009 — current */
.trend-bar{width:100%;border-radius:4px 4px 0 0;min-height:4px;transition:height .4s}
/* styles.css:1002 — current */
.cat-bar-fill{height:100%;border-radius:4px;transition:width .4s}
```

Other `transition:width .4s` fills at this commit (confirm with
`grep -n "transition:width" styles.css`): `.budget-bar-fill:332`,
`.goal-bar-fill:385`, `.proj-prog-fill:597`, `.payday-fill:725`,
`.runway-fill:732`, `.spend-total-fill:779`, `.savings-rate-gauge-fill` (SVG,
uses `stroke-dashoffset` — leave it), `.proj-prog-fill`.

These animate on data refresh / render, not on a hot path, so severity is LOW —
but the fix is cheap and removes jank on lower-end phones when a whole finance
page of bars animates at once.

## Target

Replace width/height animation with `transform: scaleX()` / `scaleY()` and pin
the origin. The fill element keeps `width:100%` / `height:100%` and is scaled
down to the data value instead of being sized to it.

```css
/* target — horizontal fills */
.cat-bar-fill{
  height:100%; width:100%;
  border-radius:4px;
  transform-origin:left center;
  transform:scaleX(0);                 /* JS sets scaleX(<ratio 0..1>) */
  transition:transform .4s cubic-bezier(0.23, 1, 0.32, 1);
}
/* target — vertical mini/trend bars */
.mini-bar{
  flex:1; height:100%;
  border-radius:2px 2px 0 0;
  transform-origin:bottom center;
  transform:scaleY(0);                 /* JS sets scaleY(<ratio 0..1>) */
  transition:transform .3s cubic-bezier(0.23, 1, 0.32, 1);
}
.trend-bar{
  width:100%; height:100%;
  border-radius:4px 4px 0 0;
  transform-origin:bottom center;
  transform:scaleY(0);
  transition:transform .4s cubic-bezier(0.23, 1, 0.32, 1);
}
```

The JS that currently sets `el.style.width = pct + '%'` (or `.height`) must set
`el.style.transform = 'scaleX(' + ratio + ')'` (ratio = pct/100). Find these
with `grep -rn "style.width\|style.height\|\.width\s*=\|\.height\s*=" js/*.js`
and match each to the class list above.

**Rounding / min-visibility:** where the CSS had `min-height:3px` /
`min-height:4px` to keep an empty bar visible, replace with a JS clamp:
`Math.max(0.02, ratio)` so a 0-value bar still shows a sliver, OR keep a 1px
`background` on the track. Note which you chose.

## Repo conventions to follow

- `cubic-bezier(0.23, 1, 0.32, 1)` is the strong ease-out from AUDIT.md; the
  repo also uses `cubic-bezier(.2,.8,.3,1)` (`styles.css:416`). Prefer the
  AUDIT.md value here for consistency with plans 002/004.
- Bar-fill JS lives in the per-tab render files: `js/finance.js` (budget, cat
  bars, trend, payday, runway, spend), `js/dashboard.js` (mini bars),
  `js/projects.js` (proj-prog). Each renders innerHTML then may set an inline
  size — check both patterns.

## Steps

1. `grep -n "transition:width\|transition:height" styles.css` — list every rule.
   Exclude SVG stroke ones (`stroke-dashoffset`).
2. For each, convert to the `transform: scale*()` + `transform-origin` + ease-out
   pattern above (X for horizontal fills, Y for vertical bars).
3. `grep -rn "style.width\|style.height" js/` — for every match that targets one
   of those fill/bar classes, change to `style.transform='scaleX('+r+')'`
   (or `scaleY`), where `r` is the 0..1 ratio the code already computes (it
   currently multiplies by 100 for `%` — drop that).
4. Handle the `min-height` sliver case per Target.
5. Grep again — no `transition:width`/`transition:height` on non-SVG fills; no
   `style.width=`/`style.height=` feeding an animated bar.

## Boundaries

- Do NOT touch SVG-based gauges/rings (`.ring-progress:150`,
  `.savings-rate-gauge-fill:1030`, `.nw-chart` paths) — they animate
  `stroke-dashoffset`, which is correct.
- Do NOT change bar colours, track styles, labels, or layout.
- Do NOT change the data math — only how the computed ratio is applied.
- Do NOT add `will-change` to every bar (dozens of elements) — skip it here.
- If a fill's JS writes `width` as a `px` value rather than `%`/ratio, STOP and
  report that one rather than guessing the denominator.

## Verification

- **Mechanical**: `grep -n "transition:width\|transition:height" styles.css`
  returns only SVG-stroke lines (or nothing). `npm run test:unit` passes.
- **Feel check**: open Finance and Dashboard:
  - Budget category bars, the 6-month trend chart, mini stat bars, project
    progress bars all still fill to the right proportion.
  - They animate in on tab open with the same ~0.4s ease-out.
  - An over-budget / 100%+ bar still clamps at full.
  - A zero-value bar still shows a visible sliver.
  - DevTools Performance: record a Finance-tab open — the bar fill animation
    frames show **no "Layout" entries** (only Composite), unlike before.
- **Done when**: every non-SVG bar animates via `transform: scale`, visuals
  unchanged, no layout thrash on the finance page.
