---
name: Dashboard
description: A personal life dashboard that reads like a well-set private ledger — warm bone paper, one rust accent, every figure in a display serif.
colors:
  accent-rust: "#9a3b1b"
  accent-weak: "#f1e6de"
  bg-bone: "#f7f6f3"
  surface-card: "#ffffff"
  surface-fold: "#f2f0ea"
  surface-raised: "#fcfcfb"
  ink: "#2a2723"
  ink-sub: "#6a6153"
  ink-muted: "#79715f"
  border: "#e6e1d6"
  border-strong: "#d8d2c4"
  hairline: "#ece8de"
  positive: "#3f6b43"
  positive-wash: "#e6efe4"
  negative: "#9f2f2d"
  negative-wash: "#fbe7e6"
  caution: "#8a5b12"
  caution-wash: "#f7efd8"
  allocation-clay: "#c9a37a"
typography:
  display:
    fontFamily: "'Newsreader', 'Iowan Old Style', Georgia, 'Times New Roman', serif"
    fontSize: "27px"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  figure:
    fontFamily: "'Newsreader', 'Iowan Old Style', Georgia, 'Times New Roman', serif"
    fontSize: "37px"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.02em"
    fontVariation: "tabular-nums in ledger columns"
  title:
    fontFamily: "'Newsreader', 'Iowan Old Style', Georgia, 'Times New Roman', serif"
    fontSize: "20px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.12em"
  caption:
    fontFamily: "'Newsreader', 'Iowan Old Style', Georgia, 'Times New Roman', serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
    fontFeature: "italic"
rounded:
  radius-sm: "8px"
  radius: "14px"
  radius-lg: "16px"
  radius-pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  gutter-mobile: "14px"
  lg: "16px"
  xl: "20px"
  section: "26px"
  gutter-desktop: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.bg-bone}"
    rounded: "{rounded.radius-sm}"
    padding: "8px 16px"
    typography: "{typography.body}"
  chip-range:
    backgroundColor: "transparent"
    textColor: "{colors.ink-sub}"
    rounded: "{rounded.radius-sm}"
    padding: "6px 11px"
  chip-range-active:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.radius-sm}"
    padding: "6px 11px"
  card:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.radius}"
    padding: "20px"
  input-underline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "0"
    padding: "6px 2px"
  nav-tab-active:
    backgroundColor: "transparent"
    textColor: "{colors.accent-rust}"
---

# Design System: Dashboard

## Overview

**Creative North Star: "The Private Ledger"**

This is a personal life dashboard set like a well-made page from a household ledger rather than a fintech console. The ground is warm bone paper (#f7f6f3), the ink is a soft near-black (#2a2723, never pure black), and information is organised in document rhythm: hairline rules between sections, not boxes around them. Every monetary figure and every section running head is set in Newsreader, a self-hosted variable display serif; labels, body copy, and controls stay in the system sans stack. One accent — a restrained rust (#9a3b1b in light, a lit #df9163 in dark) — carries links, the active tab, the net-worth trend line, and little else. Status reads as desaturated pastel, closer to a printed annual report than an iOS badge.

The redesign shipped as a **token layer plus shell applied app-wide**, with Finance rebuilt first and Dashboard following the same model. Both are now de-carded, hairline-ruled documents; Tasks, Projects, and Calendar inherit the new palette, serif, translucent chrome, and primary-button treatment, but keep their older card-heavy structure until each is separately rebuilt. Where this document describes a de-carded, hairline-ruled composition, that is the Finance/Dashboard model and the target for the rest of the app.

The system refuses the stack of glossy, self-contained metric cards that nearly every finance UI ships. It is calm, precise, and consistent from tab to tab; the reader trusts the numbers because the screen looks considered. Light is the default theme (no attribute); `[data-theme="dark"]` is an opt-in tuned inversion, first-class in every surface.

**Key Characteristics:**
- Warm bone paper ground, soft-black ink, one rust accent used sparingly
- Newsreader serif for every figure and section head; system sans for everything else
- Hairline rules divide sections; near-zero shadow
- Translucent blurred materials for the top nav and bottom tab bar
- Desaturated pastel status, never iOS-bright
- Mobile-primary: transparent floating top bar, docked bottom tab bar

## Colors

A warm monochrome field — bone, cream, and ink in the same hue family — broken only by a single rust accent and three quiet status washes.

### Primary
- **Rust** (#9a3b1b light / #df9163 dark): The lone accent. Links, the active bottom tab, the net-worth trend line and its scrub dot, the days-to-payday number, budget pace ticks, and the logo gem glyph. It never fills a region behind content.
- **Rust Wash** (#f1e6de): The accent at low volume — the logo-gem tile, `::selection` background, focus-adjacent surfaces. Dark: #33261d.

### Neutral
- **Bone** (#f7f6f3): The app background — warm, paper-like. Dark: #17150f.
- **Card White** (#ffffff): Genuine card surfaces on the not-yet-rebuilt tabs. Dark: #201d16.
- **Fold** (#f2f0ea): Recessed fills — pill backgrounds, the active nav-tab chip. Dark: #26221a.
- **Raised Cream** (#fcfcfb): Barely-lifted alternate surface. Dark: #141209.
- **Ink** (#2a2723): All primary text. Dark: #ece6da.
- **Ink Sub** (#6a6153): Secondary text, section labels, captions. Dark: #a49c8b.
- **Ink Muted** (#79715f): Tertiary text, disabled, chevrons, gridline labels. Dark: #6d6656.
- **Border** (#e6e1d6): Control and input outlines, range chips. Dark: #2f2b22.
- **Border Strong** (#d8d2c4): Scrollbar thumb, higher-contrast outlines. Dark: #3d382c.
- **Hairline** (#ece8de): The section rule — 1px top borders that separate Finance sections and ledger rows; also the divider under translucent chrome. Dark: #282318.

### Semantic (status)
- **Positive** (#3f6b43) on **Positive Wash** (#e6efe4): Gains, on-pace budgets, synced state, "ready" marks. Dark: #84bd8a / #1b2a1c.
- **Negative** (#9f2f2d) on **Negative Wash** (#fbe7e6): Losses, over-budget, missed paycheck, shortfalls. Dark: #dd8a86 / #2e1c1c.
- **Caution** (#8a5b12) on **Caution Wash** (#f7efd8): Approaching a limit, "over 80% of budget". Dark: #d3ab5e / #2a2414.
- **Allocation Clay** (#c9a37a): First step of the allocation/donut marker ramp (`#c9a37a, #6d6656, #9a8c73, #b3a17e, #847c6c, #d8d2c4`), used only for the small square markers beside allocation and category rows. Rust is always the first slice.

### Named Rules
**The One Accent Rule.** Rust is the only chromatic color in the interface. It appears on links, the active tab, the trend line, the payday number, and pace ticks — never as a background behind content, never on more than a few glyphs per screen. Its rarity is the signal.

**The Never-Black Rule.** Text ink is #2a2723 and dark-mode ink is #ece6da. Pure #000 / #fff never appear as text or background.

**The Desaturated-Status Rule.** Positive / negative / caution are only ever the pastel wash + muted-ink pairs above. No saturated green/red/amber, no iOS system colors.

## Typography

**Display Font:** Newsreader (self-hosted variable, latin subset; weights 400–600 roman, 400–500 italic), falling back to 'Iowan Old Style', Georgia, 'Times New Roman', serif.
**Body Font:** system sans — `-apple-system, 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif`.

**Character:** A newspaper-desk pairing: a warm, high-contrast serif carries all the meaning (headlines and money), while a neutral system sans does the quiet labor of labels and controls. The serif is always medium weight (500) with optical sizing on and letters tightened (-0.01 to -0.02em) so figures read as set type, not as UI text.

### Hierarchy
- **Display** (Newsreader 500, 27px, line-height 1.1, -0.02em): Page headers (`.page-hdr-title`). The greeting and legacy `.page-title` run larger at 32px in the same style.
- **Figure** (Newsreader 500, up to 37px, -0.02em): Money numbers. Net worth ~37px; budget number 31px; monthly spend 29px; payday / runway / credit-card 22px; inline ledger amounts 15px. Tabular-nums wherever figures stack in a column.
- **Title** (Newsreader 500, 20px, -0.01em): Section running heads (`.section-title`, `#page-finance .fin-collapse-hdr` at 18px). Sentence case, never uppercase.
- **Body** (system sans, 14px, line-height 1.55): Row names, descriptions, general copy.
- **Meta** (system sans, 13px, Ink Sub): Sub-labels, dates, secondary row detail.
- **Label** (system sans, 11px, 600, letter-spacing 0.11–0.13em, UPPERCASE, Ink Sub): Tracked-caps labels — "NET WORTH", "PAYDAY", and the trailing "synced 9m ago / view all" context that follows a section title.
- **Caption** (Newsreader *italic*, 14px, Ink Sub): Helper text, empty states, and chart sublines on Finance.

### Named Rules
**The Serif-for-Figures Rule.** Every monetary figure and every section running head is Newsreader. Everything else — labels, body, buttons, inputs, tab bar — is the system sans. There is no third voice.

**The Tracked-Caps-Is-Secondary Rule.** Uppercase 11px tracked labels are reserved for eyebrow labels and the context strip trailing a section title. Section titles themselves are always sentence-case serif; an uppercase title is wrong.

**The No-Kicker Rule.** The serif page title stands alone. The eyebrow slot above it is permanently removed (`.page-hdr-eyebrow { display: none }`); do not reintroduce a kicker or eyebrow over a page or section title.

## Layout

One column, centered, `max-width: 960px`. Desktop padding is 32px; mobile is 14px side gutters with `env(safe-area-inset-*)` added top and bottom. Finance is a single scrolling document: the first viewport is net worth (label, figure, delta, ~118px framed area chart, five range chips), then the allocation list, then the month nav beside "+ Transaction" — no cards above the fold except the chart's own ruled frame.

**Spacing rhythm** is loosely based on a 4px step: 4 / 8 / 12 / 16 / 20 for internal spacing, 26px above each Finance section (with a 1px hairline top rule), 8–12px vertical padding on ledger and allocation rows. Legacy cards on un-rebuilt tabs use 18–22px internal padding.

**Responsive:** below 768px the top nav becomes a transparent, non-interactive floating bar (avatar only, `pointer-events: none` except the right cluster) and a translucent bottom tab bar appears, fixed, with a 1px hairline top border. Grid rows (`.stats-row`, `.mid-row`) collapse to one column. Reduced-motion keeps short opacity/color fades but drops movement; reduced-transparency swaps `--material-bg` to an opaque bone (`#f4f2ec` light / `#1c1a12` dark) and removes the blur.

## Elevation & Depth

Near-flat by doctrine. Finance and Dashboard surfaces carry **no shadow and no border** — depth is entirely a matter of hairline rules and whitespace in document rhythm. Legacy cards (Tasks, Projects, Calendar) use one barely-there shadow (`0 1px 2px rgba(42,39,35,.045)`) and no border. The only genuinely raised element left is the "⋯" overflow menu.

### Shadow Vocabulary
- **Card rest** (`box-shadow: 0 1px 2px rgba(42,39,35,.045)`): The single elevation for legacy cards on un-rebuilt tabs. Dark: `0 1px 2px rgba(0,0,0,.3)`.
- **Card hover** (`box-shadow: 0 2px 10px rgba(42,39,35,.06)`): Legacy card hover only.
- **Menu** (`box-shadow: 0 12px 34px -10px rgba(42,39,35,.3)`): The overflow menu popover.
- **Scroll edge** (`--edge-shadow: 0 12px 22px -18px rgba(42,39,35,.28)`): A soft fade under sticky translucent chrome instead of a hard divider.

### Named Rules
**The Flat Ledger Rule.** Finance surfaces never take a shadow or a box border. If something needs separation there, it gets a 1px `--hairline` rule and 26px of space, nothing else.

**The Hairline-Not-Border Rule.** Sections and rows are divided by a single top `1px solid var(--hair)`. Cards that wrap content in an outline belong to the old system being replaced.

## Shapes

Corner language is quiet and small: **8px** on controls, chips, inputs, and the overflow menu (`--radius-sm`); **14px** on genuine cards (`--radius`), 16px on the few large ones (`--radius-lg`); **999px** reserved for small status pills only. Finance overrides most of this toward squarer forms — de-carded sections are `border-radius: 0`, the transaction search is a bare 1px bottom rule with no radius, and range chips take the 8px control radius.

Progress tracks are **2px** tall, no gradients, filled with solid ink (`var(--text)`); an over-budget track fills with Negative. Allocation and category markers are 7px squares with a 1px radius, not dots. Icons are drawn inline SVG at ~16px with a 1.6–1.8 stroke.

## Components

### Buttons
- **Shape:** Gently rounded (10px base `.btn-new`; 8px `--radius-sm` in Finance).
- **Primary:** Ink fill — `background: var(--text)`, `color: var(--bg)`, `border: 1px solid var(--text)`, padding `8px 16px`, sans 13px weight 500. Replaces the old iOS-green slab across `.btn-new`, `.tasks-add-btn`, `.btn-save`, `.proj-new-btn`, chat/note send buttons.
- **Hover / Focus:** `filter: brightness(1.12)`; `:active` scales to 0.96. Focus-visible is a 2px rust outline offset 2px.
- **Secondary / Ghost:** Google sign-in and the overflow-menu button are `background: none` with a 1px `--border` outline; hover darkens the border to ink.

### Chips
- **Range chips (net-worth ranges 30D…All):** `background: none`, 1px `--border`, 8px radius, `--sub` text, weight 500, padding `6px 11px`. `:active` scales 0.96.
- **Active range chip:** still no fill — `color: var(--text)` with `border-color: var(--text)`. Selection is an ink outline, never a filled pill.
- **Status pills:** pastel wash background + muted-ink text, `999px` radius, ~11px. Small only.

### Cards / Containers
- **Finance:** not cards. Each section is `background: none; box-shadow: none; border: 0; border-radius: 0`, separated by `border-top: 1px solid var(--hair)` and `padding: 26px 0 0`.
- **Legacy tabs:** `background: var(--card)`, 14px radius, no border, the single `Card rest` shadow, 18–22px internal padding.

### Inputs / Fields
- **Finance search:** bare — `background: none`, no radius, `border-bottom: 1px solid var(--border)`, padding `6px 2px`, 13px. Focus swaps the bottom border to `var(--text)` and removes the outline.
- **Legacy inputs:** `--radius-sm` (8px), 1px `--border2`, placeholder in `--muted`.

### Navigation
- **Desktop top nav:** sticky, `background: var(--material-bg)` with `backdrop-filter: blur(20px) saturate(180%)`, 1px `--hair` bottom border, 56px tall. Logo in serif 16px with the rust gem tile. Tabs are 13px sans; active tab gets a `--seg-active` chip with a faint `0 1px 3px` shadow and ink text.
- **Mobile:** top bar goes transparent and non-interactive (avatar cluster only). Bottom tab bar is fixed, translucent (same material + blur), 1px `--hair` top border, safe-area padded. Tab labels are 11px sans weight 600 in `--sub`; the **active tab is rust** (`var(--blue)`, which is remapped to the accent).

### Signature — The Ledger Row
The repeating unit of Finance: a flex row, `align-items: baseline`, `padding: 8–12px 0`, `border-bottom: 1px solid var(--hair)`, last row un-ruled. Layout is marker (7px square) · name (13–14px sans, `flex: 1`) · figure (Newsreader 500, tabular-nums) · optional percent (12px `--sub`, right-aligned, fixed 34px column). Used for allocation, categories, accounts, credit cards, and transactions (transaction rows drop the marker and the old emoji tile). `:active` scales the row 0.99; no hover fill.

### Signature — The Net-Worth Chart
A hairline-framed area chart (~118px). Trend polyline is always `var(--accent)` at 2px with round caps; fill is a vertical accent gradient from 0.10 to 0 opacity; gridlines are dashed `var(--border)` with `--muted` labels rounded to a clean step; the scrub dot is a 3.5px accent circle. Direction is never carried by recoloring the line — only by the delta note beside the figure.

### Drawn Status Marks
`_ICO_CHECK` and `_ICO_WARN` are inline 16px SVGs (stroke `currentColor`, 1.6–1.8 width) used wherever a checkmark or warning would otherwise be a Unicode glyph — "paycheck received", "ready", "over the limit", duplicate-transaction flag. Class `.fin-ico`, sized `0.95em`, inherits the surrounding text color.

## Do's and Don'ts

### Do:
- **Do** build new Finance-family surfaces as one scrolling document: hairline-ruled sections (`border-top: 1px solid var(--hair)`, 26px lead), no cards.
- **Do** set every money figure and section head in Newsreader 500 with `-0.02em` / `-0.01em` tracking and `tabular-nums` in any column of figures.
- **Do** keep the net-worth trend line rust in every state; put gain/loss in the delta note, not the line color.
- **Do** keep rust to links, the active tab, the trend line, the payday number, and pace ticks — a few glyphs per screen.
- **Do** use the pastel wash + muted-ink pairs for all status, and drawn SVG marks (`_ICO_CHECK` / `_ICO_WARN`) for check/warning symbols.
- **Do** render translucent chrome with `var(--material-bg)` + `blur(20px) saturate(180%)` and a 1px `--hair` edge; honor reduced-transparency and reduced-motion.

### Don't:
- **Don't** wrap Finance content in bordered or shadowed metric cards, or stack self-contained KPI tiles.
- **Don't** use pure black/white for text or background, or saturated/iOS status colors.
- **Don't** use Unicode glyphs (✓ ⚠ ▲ ▼ ●) as icons — draw them as inline SVG.
- **Don't** put a kicker or eyebrow above a page or section title, and don't set a section title in uppercase — the serif carries it.
- **Don't** fill the active range chip or active nav-tab-on-Finance with a color block; selection is an ink outline / rust text.
- **Don't** apply the de-carded treatment to Tasks, Projects, or Calendar until each is rebuilt — they legitimately still use the legacy card + shadow model under the new tokens. Finance and Dashboard are both rebuilt.
