# 003 — Make the page transition interruptible (keyframe → transition)

- **Status**: DONE — via [002](002-page-transition-rework.md)
- **Commit**: b25cd86
- **Severity**: MEDIUM
- **Category**: Interruptibility

## Problem

`styles.css:815` `.page.active{animation:pageFadeIn .18s ease}` is a `@keyframe`
on an element toggled by `switchTab()` (`js/core.js:548`). Keyframes restart
from zero on every trigger, so fast A→B→A tab switching replays the fade from
opacity 0 instead of retargeting from the current state.

## Resolution

This finding shares the exact same three lines of CSS as finding 2 (the 6px
translate), so the fix is the same edit. **Execute [plan 002](002-page-transition-rework.md)** —
it replaces the keyframe with an opacity `transition` on `.page` / `.page.active`,
which retargets from the current state and satisfies this finding.

Do not make a separate edit for this. When 002 is DONE, mark this DONE too.

## Verification

Covered by 002's feel check — specifically: "Rapidly toggle between two tabs
(10+ times fast) — no flicker, no 'starts from invisible each time' stutter."
