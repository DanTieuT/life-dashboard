# 002 — Rework the page/tab transition (covers findings 2 and 3)

- **Status**: DONE (branch redesign/animation-polish)
- **Commit**: b25cd86
- **Severity**: HIGH (finding 2) + MEDIUM (finding 3)
- **Category**: Purpose & frequency / Interruptibility
- **Estimated scope**: 1 file (`styles.css`), ~4 lines

## Problem

Every tab switch runs a keyframe animation on the newly-active page:

```css
/* styles.css:815 — current */
.page.active{animation:pageFadeIn .18s ease}
/* styles.css:816 — current */
@keyframes pageFadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
```

Triggered by `js/core.js:548` `switchTab()`, which is a **primary navigation
action used dozens of times a day** (5 tabs, top nav + bottom tab bar).

Two problems:

1. **Frequency (finding 2)**: a 6px upward translate on every navigation adds a
   perceived delay to the exact action the user repeats most. Per the frequency
   rule, tens-of-times-a-day actions get *reduced* motion — the movement should
   go; a fast opacity fade is the most this earns.
2. **Interruptibility (finding 3)**: `@keyframes` restart from zero. Tab A → B →
   A quickly replays `pageFadeIn` from opacity 0 each time instead of retargeting
   from the current state. A CSS transition retargets; a keyframe cannot.

## Target

Replace the keyframe with an opacity-only transition on `.page`, driven by the
`.active` class toggle (which `switchTab` already does).

```css
/* target — replaces styles.css:815-816 */
.page{opacity:0;transition:opacity 120ms ease-out}
.page.active{opacity:1}
```

Notes:
- `.page` already has `display:none` when inactive and `display:block` when
  `.active` (see `styles.css` `.page` / `.page.active` rules near line 70-ish:
  `.page{display:none}` / `.page.active{display:block}`). Opacity transition on a
  `display:none` element is inert, and when `.active` is added the element goes
  `display:block` + `opacity:0` → `opacity:1` transitions. If the transition
  does not fire because `display` and `opacity` change in the same frame, add
  `@starting-style` as the fallback:
  ```css
  .page.active{opacity:1}
  @starting-style{ .page.active{opacity:0} }
  ```
- No `transform`. No keyframe. Duration 120ms (under the 150ms floor for a
  navigation the user does constantly — this is deliberately near-invisible).
- `ease-out` is correct here (an entering element).

## Repo conventions to follow

- The existing `.page{display:none}` / `.page.active{display:block}` rule lives
  near the top of the layout section — keep the new `opacity` declarations on
  those same two selectors, don't create a third rule block.
- `styles.css:815` has a `/* ── PAGE TRANSITION ── */` section comment — keep it.

## Steps

1. In `styles.css`, find `.page{display:none}` and `.page.active{display:block}`.
   Add `opacity:0;transition:opacity 120ms ease-out` to `.page` and
   `opacity:1` to `.page.active`.
2. Delete `styles.css:815` `.page.active{animation:pageFadeIn .18s ease}`.
3. Delete the `@keyframes pageFadeIn{...}` block at `styles.css:816`.
4. Load the app, switch tabs, confirm the fade still happens. If the first
   switch to a page shows no fade, add the `@starting-style` block from Target.

## Boundaries

- Do NOT touch `js/core.js` or any other JS — `switchTab` already toggles
  `.active`, that is all this needs.
- Do NOT add a `transform`, a slide, or a stagger.
- Do NOT change `switchTab`'s `haptic(10)` call.
- Do NOT touch `.page-hdr` / `.page-header` (unrelated).
- If `.page{display:none}` is not present at b25cd86, STOP and report.

## Verification

- **Mechanical**: `grep -n "pageFadeIn" styles.css` returns nothing. App loads
  with no console errors.
- **Feel check**: click through all 5 tabs top-nav, then the bottom tab bar:
  - Content cross-fades; nothing slides up.
  - Rapidly toggle between two tabs (10+ times fast) — no flicker, no "starts
    from invisible each time" stutter; it should feel continuous.
  - DevTools Animations panel at 10%: one opacity transition, no transform track.
  - Rendering panel → emulate `prefers-reduced-motion: reduce` → the fade
    becomes instant (global rule at `styles.css:3` handles this) and nothing
    breaks.
- **Done when**: tab switches are an opacity-only ≤120ms fade, interruptible,
  no keyframe.
