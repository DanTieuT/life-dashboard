---
version: 1
slug: "js-finance-js"
primary_target: "js/finance.js"
related_targets: ["styles.css","index.html"]
---

Scope: the Finance tab of the life dashboard, plus the shared app shell it
depends on (token layer, top nav, mobile bottom tab bar, base typography, the
transaction detail/add sheet). Visitor mode: Operate. Calendar, Dashboard,
Tasks, Projects and a bespoke dark pass are out of this build.

Audience: the single owner, on his phone, in short bursts — checking a balance,
budget standing, what's coming, recent activity. Occasionally a laptop for
reconciliation. Job: know where the money stands in one glance; get depth
(allocation, per-category pace, sinking funds, anomalies) one scroll down.

Proof / product truth: real connected numbers — the same budget figure the
dashboard hero and JARVIS use — and a screen that reacts to context
(days-to-payday, RDO schedule). Single-user forever; no framework, no build
step, static deploy.

Constraints: mobile-primary PWA, must still render on desktop (~960 column).
Vanilla ES modules; edit index.html + styles.css + js/finance.js on a branch.
Every current feature survives; JARVIS action parity preserved. Honor
reduced-motion and reduced-transparency.

Memorable moment: the net-worth figure and its hairline-framed trend set in
Newsreader, reading like the headline of a private ledger rather than a KPI
tile.

Unresolved (decide at build): exact desktop treatment of the editorial system
(mockups are phone-only); whether the net-worth chart gets the scrub
interaction this pass; final transaction-row density.

## Direction contract

THESIS: Finance is a personal ledger, not a fintech dashboard. It owns the
idea that money information reads like a well-set page — hairline-ruled
sections in document rhythm, every figure in a serif — and refuses the stack
of glossy self-contained metric cards that every finance UI ships. One
column, one voice, numbers you trust because they look considered.

OWN-WORLD: Warm bone ground (#f7f6f3), ink #2a2723 (never pure black), muted
#8a8578. Hairlines #e6e1d6 / #ece8de instead of borders-on-cards; near-zero
shadows. Newsreader serif for section titles and every monetary figure; system
sans for body, labels, controls. One accent, rust #9a3b1b, used sparingly
(links, active nav, the trend line). Status as desaturated pastel pills
(#edf3ec/#346538 positive, #fdebec/#9f2f2d negative, #fbf3db/#956400 caution).
Radius 10px, reserved for the few genuine cards; 6px controls; 999px only on
small status pills. Nav and bottom tab bar are translucent materials
(blur 20px, bright top edge) with a soft scroll-edge, no hard divider.

STORY: The visitor understands their whole money picture is here and coherent;
believes the numbers because the screen is calm, precise, and consistent with
the rest of the app; and acts by scanning, tapping a row to see detail, or
switching the range — never by hunting through boxes.

FIRST VIEWPORT: Sticky translucent header — "Finance" (serif) left, the
account avatar right (the app's existing pattern; the month nav lives with the
period actions just below the chart, not in the header). Below, 20px gutter:
"NET WORTH" tracked-caps label, then the figure at ~37px Newsreader, a one-line
delta in muted green, then a hairline-framed area chart (~118px) with rust
stroke and a faint fill. A row of five range chips (30D…All), 30D active. Then
the allocation split — a ruled list, one row per bucket: marker + label +
serif figure + percent (NOT a stacked colour bar). Then the month nav
(‹ September ›, serif) beside "+ Transaction". No cards in the first viewport;
the only ruled box is the chart's frame. Two existing app affordances persist
on Finance and are exempt from "no floating button": the quick-add and JARVIS
buttons, docked bottom-right as quiet paper circles clear of content.

FORM: Pinned editorial direction — chosen by the user ("i like b") and
prototyped across five iPhone mockups plus design-canvas/tokens.css before
this build. No concept roll ran; a user-pinned direction beats the roll. Code-
led build; visual authority is the mockup set and tokens.css. No seed key.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
