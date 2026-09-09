# 004 — Task swipe: velocity-based commit + ease-out snap-back

- **Status**: DONE (branch redesign/animation-polish)
- **Commit**: b25cd86
- **Severity**: MEDIUM
- **Category**: Interruptibility / Physicality
- **Estimated scope**: 1 file (`js/tasks.js`), ~15 lines in `attachTaskTouchGestures`

## Problem

Swipe-to-edit / swipe-to-delete on task rows (`js/tasks.js`, function around
`:486`, the `touchend` handler at `:563-590`) commits purely on **distance**:

```js
/* js/tasks.js:534-546 — current touchmove */
row.addEventListener('touchmove',e=>{
  ...
  if(state==='swipe'){
    moved=true;e.preventDefault();
    if(Math.abs(dx)<120){
      row.style.transition='none';
      row.style.transform=`translateX(${dx}px)`;
      ...
```

```js
/* js/tasks.js:563-578 — current touchend */
row.addEventListener('touchend',e=>{
  clearTimeout(lpTimer);
  const dx=e.changedTouches[0].clientX-sx;
  if(state==='swipe'){
    row.style.transition='transform .2s ease';
    if(dx<-SWIPE_THRESHOLD){
      haptic(25);
      row.style.transform='translateX(-80px)';
      ...
      if(dx<-100){resetSwipe();if(row.dataset.taskId)deleteTask(row.dataset.taskId);}
    } else if(dx>SWIPE_THRESHOLD){ ... if(dx>100){ ... openEditTaskModal ... } }
    else resetSwipe();
```

Two issues, per the gesture rules:

1. **No velocity.** A quick flick that travels < 100px does not commit, even
   though the intent is obvious. Dismissal should fire when
   `Math.abs(distance) / elapsedMs > ~0.11` OR the distance threshold is met.
2. **Snap-back easing.** The release transition is `transform .2s ease`. For a
   system response to a released gesture it should be `ease-out` (starts fast).
   `ease` is the hover/color curve.

`SWIPE_THRESHOLD` and the `120` / `100` / `80` constants are defined near the
top of the same function — read them at b25cd86, do not assume values.

## Target

1. Track the pointer's recent position + timestamp so release velocity is
   available in `touchend`.
2. In `touchend`, compute `velocity = Math.abs(dx) / dt` (px/ms) where `dt` is
   the time since the last `touchmove`. Commit the action when
   **either** `Math.abs(dx) >= 100` (existing full-commit threshold)
   **or** `velocity > 0.11 && Math.abs(dx) > MOVE_SLOP` and the sign matches.
3. Change the release transition string from `transform .2s ease` to
   `transform 200ms cubic-bezier(0.23, 1, 0.32, 1)` (strong ease-out).

```js
/* target — add near the other gesture state vars at the top of the function */
let lastX = 0, lastT = 0, vx = 0;

/* target — in touchmove, inside the state==='swipe' branch, after setting transform */
const now = e.timeStamp;
if (now > lastT) { vx = (e.touches[0].clientX - lastX) / (now - lastT); }
lastX = e.touches[0].clientX; lastT = now;

/* target — replace the touchend commit logic */
row.style.transition = 'transform 200ms cubic-bezier(0.23, 1, 0.32, 1)';
const flick = Math.abs(vx) > 0.11;
const goDelete = dx < 0 && (dx < -100 || (flick && vx < 0 && dx < -MOVE_SLOP));
const goEdit   = dx > 0 && (dx >  100 || (flick && vx > 0 && dx >  MOVE_SLOP));
if (goDelete) { haptic(25); resetSwipe(); if (row.dataset.taskId) deleteTask(row.dataset.taskId); }
else if (goEdit) { haptic(25); resetSwipe(); if (row.dataset.taskId) openEditTaskModal(row.dataset.taskId); }
else if (dx < -SWIPE_THRESHOLD) { /* keep: rest at -80px armed state, existing 2s auto-reset */ ... }
else if (dx >  SWIPE_THRESHOLD) { /* keep: rest at +80px armed state */ ... }
else resetSwipe();
```

Keep the existing "armed / rest at ±80px with a 2s auto-reset and
touchstart-to-dismiss" behavior for partial swipes that pass `SWIPE_THRESHOLD`
but neither the distance nor the flick commit test. Only the **commit** path and
the **easing string** change.

## Repo conventions to follow

- This file is plain ES5-ish DOM code, no framework, semicolons, `const`/`let`,
  no arrow-body braces for one-liners. Match it.
- `haptic()` is already imported/global in this file — keep using it.
- Existing curve used elsewhere in the repo: `cubic-bezier(.2,.8,.3,1)`
  (`styles.css:416`). This plan uses the AUDIT.md strong ease-out
  `cubic-bezier(0.23, 1, 0.32, 1)` for the release — that is intentional and
  correct for a gesture snap.

## Steps

1. Read `js/tasks.js` `attachTaskTouchGestures` in full at b25cd86; note the
   real names/values of `SWIPE_THRESHOLD`, `MOVE_SLOP`, `HOLD_MS`, and the
   `120/100/80` literals.
2. Add `lastX/lastT/vx` state vars alongside the existing gesture vars.
3. In the `touchmove` `state==='swipe'` branch, update `vx` as in Target.
4. Reset `lastX/lastT/vx` in `touchstart` (set `lastX=sx; lastT=e.timeStamp; vx=0`).
5. Replace the `touchend` commit block with the Target logic; keep the armed-rest
   branches and their `setTimeout(r,2000)` / `document.addEventListener('touchstart',r,...)` intact.
6. Change the release `row.style.transition` string to the ease-out cubic-bezier.

## Boundaries

- Do NOT touch `styles.css` or the `.task-swipe-*` CSS.
- Do NOT change the long-press-to-reorder path (`state==='drag'`) — swipe only.
- Do NOT change `deleteTask` / `openEditTaskModal` signatures or behavior.
- Do NOT add a spring library — raw velocity math only.
- If `attachTaskTouchGestures` has drifted from the excerpts above, STOP and report.

## Verification

- **Mechanical**: `npm run test:unit` passes. App loads, open the Tasks tab in
  a mobile viewport (DevTools device mode, touch on).
- **Feel check** (must be done with touch emulation or a real device):
  - Slow drag past ~100px left → deletes, as before.
  - **Quick flick** left ~40px and release → now also deletes (did not before).
  - Slow drag ~50px and release (no flick) → snaps back, no action.
  - Snap-back starts fast and eases to rest — not linear, not sluggish.
  - Half-swipe to the armed state still rests at ±80px and auto-clears after 2s.
  - On a real device: a natural flick to delete feels like the row was *thrown*
    off, not like it waited to measure distance.
- **Done when**: flicks commit, distance still commits, snap-back is `ease-out`,
  the reorder gesture is untouched.
