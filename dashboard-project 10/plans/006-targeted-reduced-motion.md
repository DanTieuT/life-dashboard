# 006 — Replace the blanket reduced-motion rule with a targeted one

- **Status**: DONE (branch redesign/animation-polish)
- **Commit**: b25cd86
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 1 file (`styles.css`), ~10 lines

## Problem

```css
/* styles.css:3-5 — current */
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}
}
```

This is the "sledgehammer" pattern: it freezes **all** motion, including opacity
and colour transitions that *aid* comprehension (a page fade that tells you the
view changed, a menu that fades in so it doesn't just pop). Reduced motion means
*gentler and fewer*, not *none* — keep non-vestibular motion (opacity, colour),
drop movement (transform, position, parallax, looping oscillation).

## Target

Keep a global cap on **looping / long** animations and **transform/position**
motion, but let short opacity & colour transitions through.

```css
/* target — replaces styles.css:3-5 */
@media (prefers-reduced-motion: reduce){
  /* Stop looping and long-running animations */
  *,*::before,*::after{
    animation-iteration-count:1 !important;
    animation-duration:.01ms !important;
    scroll-behavior:auto !important;
  }
  /* Drop movement, keep opacity/colour fades */
  *,*::before,*::after{
    transition-property: opacity, color, background-color, border-color, fill, stroke !important;
    transition-duration: .15s !important;
  }
  /* Neutralise transform-based transitions/animations specifically */
  .page, .modal, .toast, .task-row-swipe-inner, .fin-more-menu, .quick-action-item,
  .modal-overlay.open .modal, .fin-more-menu.open{
    transform: none !important;
  }
}
```

Rationale:
- `transition-property: opacity, color, ...` forces every element's transition
  to only animate those safe properties, at a short 150ms — so a `transform`
  transition still "happens" instantly (no movement) while a colour fade stays.
- `animation-duration:.01ms` + `iteration-count:1` still kills `aipulse`,
  `micpulse`, `shimmer`, `ptr-spin` loops and `pageFadeIn` / `modalMaterialize`
  keyframes' movement.
- The explicit `transform:none` list covers the elements whose *resting* state
  is a keyframe end-state, so they don't get stuck mid-transform.

## Repo conventions to follow

- `!important` is already the norm inside this media query — keep it.
- Keyframe names to be aware of (all defined in `styles.css`): `pageFadeIn`
  (:816 — removed by plan 002), `modalOverlayFade` (:414), `modalMaterialize`
  (:415), `aipulse` (:447), `micpulse` (:467), `ptr-spin` (:856),
  `shimmer` (:917).

## Steps

1. Replace the `@media (prefers-reduced-motion: reduce)` block at
   `styles.css:3-5` with the Target block.
2. If plan 002 has already run, `pageFadeIn` is gone and `.page` uses an opacity
   transition — the new rule already allows that (opacity is in the keep-list),
   so `.page` stays a fade. Good, no conflict.
3. Load the app with `prefers-reduced-motion` emulated and walk the checks below.

## Boundaries

- Do NOT remove the `animation` freeze entirely — loops must still stop.
- Do NOT edit individual component rules to add their own reduced-motion
  handling in this plan (that is a larger follow-up); this is the global policy only.
- Do NOT touch `js/` — no `matchMedia` branching in this plan.
- Do NOT touch `.dc.html` / `tokens.css`.
- If the media block at :3-5 has drifted, STOP and report.

## Verification

- **Mechanical**: app loads, no console errors.
- **Feel check** — DevTools → Rendering → "Emulate CSS prefers-reduced-motion: reduce":
  - Tab switches still **cross-fade** (opacity) — they are not a hard cut.
  - Modals still fade their overlay in; the `scale(.94)` materialise does NOT
    play (no zoom), the modal just appears at final size with an opacity fade.
  - The JARVIS status dot (`aipulse`) and mic pulse do NOT loop.
  - Skeleton `shimmer` does not sweep; pull-to-refresh spinner does not spin
    (or spins one step).
  - Task swipe still tracks the finger 1:1 (that is direct manipulation, driven
    by inline `style.transform` in JS, not a CSS transition — unaffected and
    correct to keep).
  - Toggle the emulation off → full motion returns.
- **Done when**: with reduced motion on, opacity/colour fades remain, all
  movement and looping animation is gone, nothing is stuck mid-transform.
