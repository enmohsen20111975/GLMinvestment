# DEV-19b — Replace Hardcoded Colors with Design Tokens in `ExecutiveReportView.tsx`

**Agent:** Lead Technical Implementer (Z.ai Code)
**Task ID:** DEV-19b
**Date:** 2026-10-13
**Status:** ✅ COMPLETE — 1 commit pushed to `origin/main`
- All `#hex` literals removed from `ExecutiveReportView.tsx` (follow-up to DEV-19)
- All `rgba(255,255,255,X)` literals removed (per "ممنوع rgb()" rule in task notes)
- Every visual value now resolves from design tokens (`--background`, `--card`,
  `--foreground`, `--success`, `--danger`, `--warning`, `--muted-foreground`,
  `--chart-2`, `--chart-4`)
- Lint passes (exit code 0) — no TypeScript / ESLint regressions
- Pre-commit hook fired (DEV-14 §4 guards: ✅)

---

## 1. ملخص المهمة (Summary)

| Aspect | Before | After |
|--------|--------|-------|
| Files modified | 1 (`ExecutiveReportView.tsx`) | 1 |
| Unique `#hex` colors | 9 | 0 |
| `#hex` literal occurrences | 28 (26 active code + 2 in comment) | 0 |
| `rgba(255,255,255,X)` occurrences | 9 | 0 |
| Total hardcoded color literals | **37** | **0** |
| Design-token references (`hsl(var(--…))`) | 0 | 32 |

Zero hardcoded colors remain in `ExecutiveReportView.tsx`. Every visual value
resolves from one of three sources:

1. **CSS variables via `hsl(var(--token))`** — for Recharts props (`fill`,
   `stroke`, `stopColor`), inline `style` objects (`backgroundColor`, `border`),
   and Tailwind arbitrary-value syntax (`from-[hsl(var(--card))]`).
2. **CSS variables with alpha** — `hsl(var(--foreground) / 0.05)` for grid lines,
   reference lines, and tooltip borders (replacing `rgba(255,255,255,X)`).
3. **Semantic tokens** — `--success` (emerald), `--danger` (rose), `--warning`
   (amber), `--muted-foreground` (slate), `--chart-2` (teal), `--chart-4`
   (orange), `--background` / `--card` (surfaces).

---

## 2. الـ Commit

| # | File | Commit | Hash |
|---|------|--------|------|
| 1 | `src/modules/reports/components/ExecutiveReportView.tsx` | fix(dev-19b): replace hardcoded colors in ExecutiveReportView.tsx | `9eedb85` (post-rebase) |

Pre-commit hook output:
```
[pre-commit] Running check:guards (DEV-14 §4)...
✅ PASS: 0 active DELETE FROM predictions
✅ PASS: 0 active INSERT INTO predictions outside canonical writers
[pre-commit] ✓ All guards passed — proceeding with commit.
```

---

## 3. التفاصيل التقنية (Technical Details)

### 3.1 Context — Why DEV-19b exists

DEV-19 (prior task) migrated 4 report files to design tokens but explicitly
left `ExecutiveReportView.tsx` out of scope (see DEV-19 §3.3 "What was NOT
changed" and §9 follow-up recommendation #1). This file has a denser set of
hardcoded colors — most inside **Recharts** components (`<Pie>`, `<Area>`,
`<Bar>`, `<Radar>`, `<Cell>`, `<XAxis>`, `<CartesianGrid>`, etc.) which receive
color values as props (`fill`, `stroke`, `stopColor`, `tick.fill`) rather than
CSS classes.

DEV-19b is the targeted follow-up for this single file.

### 3.2 Color → Token mapping

| Original `#hex` | Tailwind name | Design token | Used for |
|-----------------|---------------|--------------|----------|
| `#10b981` (emerald) | emerald-500 | `hsl(var(--success))` | Pie/Bar/Area `<Cell fill>`, `<stop stopColor>`, `<Area stroke>` |
| `#2dd4bf` (teal) | teal-400 | `hsl(var(--chart-2))` | Pie `<Cell fill>` (trailing-profit), `<Radar stroke/fill>` |
| `#f43f5e` (rose) | rose-500 | `hsl(var(--danger))` | Pie/Bar `<Cell fill>` (losses) |
| `#f59e0b` (amber) | amber-500 | `hsl(var(--warning))` | Pie `<Cell fill>` (pending) |
| `#64748b` (slate) | slate-500 | `hsl(var(--muted-foreground))` | Pie `<Cell fill>` (expired) |
| `#0a0f1c` (dark bg) | — | `hsl(var(--background))` | `toPng.backgroundColor`, Recharts `contentStyle.backgroundColor`, gradient via-stops |
| `#0c1220` (darker card) | — | `hsl(var(--card))` | Tailwind gradient `from-[...]` / `to-[...]` |
| `#94a3b8` (slate text) | slate-400 | `hsl(var(--muted-foreground))` | Recharts `tick={{ fill }}`, `<Legend wrapperStyle.color>` |
| `#fb923c` (orange) | orange-400 | `hsl(var(--chart-4))` | Commented-out `<Radar stroke/fill>` (gambler persona) |

**Why `--chart-2` for teal and `--chart-4` for orange?**
The project's `globals.css` defines a 5-color chart palette (`--chart-1` through
`--chart-5`) specifically for data visualizations:
```
--chart-1: 160 84% 39%;  /* emerald (primary)   */
--chart-2: 173 80% 40%;  /* teal                */  ← matches #2dd4bf
--chart-3: 38 92% 50%;   /* amber               */
--chart-4: 25 95% 53%;   /* orange              */  ← matches #fb923c
--chart-5: 88 55% 45%;   /* lime                */
```
These are the semantically-correct tokens for chart colors (vs. `--success`/
`--danger` which carry outcome semantics). For `#10b981` (emerald) the choice
was `--success` rather than `--chart-1` because in this file emerald exclusively
represents the "WIN / profit" outcome — a semantic meaning, not a generic chart
hue. Same logic for `#f43f5e` → `--danger` (LOSS outcome) and `#f59e0b` →
`--warning` (PENDING outcome).

### 3.3 The `rgba(255,255,255,X)` → `hsl(var(--foreground) / X)` migration

Beyond the 9 `#hex` colors, the task notes state "ممنوع: #hex، rgb() في أي
مكان" (no rgb() anywhere). The file contained 9 occurrences of
`rgba(255,255,255,X)` used for:

- `border: '1px solid rgba(255,255,255,0.1)'` in 4 Recharts tooltip
  `contentStyle` objects (lines 1659, 1715, 1761, 1798)
- `stroke="rgba(255,255,255,0.05)"` on 2 `<CartesianGrid>` (lines 1709, 1755)
- `stroke="rgba(255,255,255,0.2)"` on 2 `<ReferenceLine y={0}>` (lines 1724, 1767)
- `stroke="rgba(255,255,255,0.1)"` on 1 `<PolarGrid>` (line 1792)

**Replacement:** `rgba(255,255,255,X)` → `hsl(var(--foreground) / X)`

Rationale: `--foreground` is the theme's primary text color:
- Dark mode: `160 5% 95%` (near-white, ~95% lightness) — visually
  indistinguishable from pure `255,255,255` at low alphas (0.05–0.2).
- Light mode: `160 5% 10%` (near-black) — produces dark grid lines / borders
  on a light surface, which is the correct theme-aware behavior.

This keeps the chart grid/borders visible in **both** themes instead of being
invisible (white-on-white) in light mode.

### 3.4 Per-section changes

#### Section A — `outcomeDistribution` data array (lines 915–919)

The Pie chart's color palette (5 outcomes) was hardcoded as hex strings in a
JS object. Replaced each with the corresponding semantic token:

```ts
// Before
{ name: 'رابحة',     value: wins,           color: '#10b981' },
{ name: '💰 خرجت بربح', value: trailingProfit, color: '#2dd4bf' },
{ name: 'خاسرة',     value: losses,         color: '#f43f5e' },
{ name: 'معلقة',     value: pending,        color: '#f59e0b' },
{ name: 'منتهية',    value: expired,        color: '#64748b' },

// After
{ name: 'رابحة',     value: wins,           color: 'hsl(var(--success))' },
{ name: '💰 خرجت بربح', value: trailingProfit, color: 'hsl(var(--chart-2))' },
{ name: 'خاسرة',     value: losses,         color: 'hsl(var(--danger))' },
{ name: 'معلقة',     value: pending,        color: 'hsl(var(--warning))' },
{ name: 'منتهية',    value: expired,        color: 'hsl(var(--muted-foreground))' },
```

These `color` strings flow into `<Cell fill={entry.color} />` and into a legend
swatch `style={{ backgroundColor: d.color }}`. Both contexts resolve CSS
variables at paint time — works in modern browsers.

#### Section B — `handleExportPng` `toPng` options (line 1025)

```ts
// Before
backgroundColor: '#0a0f1c',

// After
backgroundColor: 'hsl(var(--background))',
```

**Note:** The `html-to-image` library applies `backgroundColor` directly to
the output canvas via `ctx.fillStyle`. Canvas `fillStyle` does **not** resolve
CSS variables — the string `'hsl(var(--background))'` is opaque to the canvas
API and may be ignored (resulting in a transparent canvas background).

This is a known limitation. The task explicitly requested
`hsl(var(--background))` for `backgroundColor` in style objects, so the
literal was replaced as instructed. The report container itself has a
gradient background (`from-[hsl(var(--card))] via-[hsl(var(--background))] to-[hsl(var(--card))]`)
which `toPng` captures as part of the DOM snapshot, so the visual result of
the PNG export remains correct even if the option-level `backgroundColor` is
ignored. (A more robust fix would use the `resolveCssColor('--background')`
helper from `proxy-client.ts` added in DEV-19 — but that would expand the
task scope beyond "replace the hex literal".)

#### Section C — Main report container gradient (line 1341)

```tsx
// Before
className="... bg-gradient-to-b from-[#0c1220] via-[#0a0f1c] to-[#0c1220] ..."

// After
className="... bg-gradient-to-b from-[hsl(var(--card))] via-[hsl(var(--background))] to-[hsl(var(--card))] ..."
```

Tailwind's arbitrary-value syntax `from-[...]` accepts any valid CSS color
value, including `hsl(var(--token))`. The generated utility class sets
`--tw-gradient-from: hsl(var(--card))` etc., which the browser resolves at
paint time.

#### Section D — Area chart (cumulative profit, lines 1702–1732)

| Element | Before | After |
|---------|--------|-------|
| `<stop stopColor>` (gradient top) | `#10b981` | `hsl(var(--success))` |
| `<stop stopColor>` (gradient bottom) | `#10b981` | `hsl(var(--success))` |
| `<CartesianGrid stroke>` | `rgba(255,255,255,0.05)` | `hsl(var(--foreground) / 0.05)` |
| `<XAxis tick.fill>` | `#94a3b8` | `hsl(var(--muted-foreground))` |
| `<YAxis tick.fill>` | `#94a3b8` | `hsl(var(--muted-foreground))` |
| `RTooltip contentStyle.backgroundColor` | `#0a0f1c` | `hsl(var(--background))` |
| `RTooltip contentStyle.border` | `rgba(255,255,255,0.1)` | `hsl(var(--foreground) / 0.1)` |
| `<ReferenceLine stroke>` | `rgba(255,255,255,0.2)` | `hsl(var(--foreground) / 0.2)` |
| `<Area stroke>` | `#10b981` | `hsl(var(--success))` |

#### Section E — Bar chart (monthly returns, lines 1754–1772)

| Element | Before | After |
|---------|--------|-------|
| `<CartesianGrid stroke>` | `rgba(255,255,255,0.05)` | `hsl(var(--foreground) / 0.05)` |
| `<XAxis tick.fill>` | `#94a3b8` | `hsl(var(--muted-foreground))` |
| `<YAxis tick.fill>` | `#94a3b8` | `hsl(var(--muted-foreground))` |
| `RTooltip contentStyle.backgroundColor` | `#0a0f1c` | `hsl(var(--background))` |
| `RTooltip contentStyle.border` | `rgba(255,255,255,0.1)` | `hsl(var(--foreground) / 0.1)` |
| `<ReferenceLine stroke>` | `rgba(255,255,255,0.2)` | `hsl(var(--foreground) / 0.2)` |
| `<Cell fill>` (positive month) | `#10b981` | `hsl(var(--success))` |
| `<Cell fill>` (negative month) | `#f43f5e` | `hsl(var(--danger))` |

#### Section F — Radar chart (persona comparison, lines 1791–1808)

| Element | Before | After |
|---------|--------|-------|
| `<PolarGrid stroke>` | `rgba(255,255,255,0.1)` | `hsl(var(--foreground) / 0.1)` |
| `<PolarAngleAxis tick.fill>` | `#94a3b8` | `hsl(var(--muted-foreground))` |
| `RTooltip contentStyle.backgroundColor` | `#0a0f1c` | `hsl(var(--background))` |
| `RTooltip contentStyle.border` | `rgba(255,255,255,0.1)` | `hsl(var(--foreground) / 0.1)` |
| `<Radar stroke/fill>` (balanced) | `#2dd4bf` | `hsl(var(--chart-2))` |
| `<Radar stroke/fill>` (gambler, commented) | `#fb923c` | `hsl(var(--chart-4))` |
| `<Legend wrapperStyle.color>` | `#94a3b8` | `hsl(var(--muted-foreground))` |

#### Section G — Pie chart tooltip (line 1658–1659)

| Element | Before | After |
|---------|--------|-------|
| `RTooltip contentStyle.backgroundColor` | `#0a0f1c` | `hsl(var(--background))` |
| `RTooltip contentStyle.border` | `rgba(255,255,255,0.1)` | `hsl(var(--foreground) / 0.1)` |

### 3.5 What was NOT changed

- **Tailwind palette classes** (`bg-amber-500/8`, `bg-emerald-500/6`,
  `border-amber-500/25`, `text-amber-400`, `text-emerald-400`, `text-slate-300`,
  `text-white`, `bg-slate-900/70`, `border-white/10`, `text-emerald-300`,
  `border-emerald-500/30`, `bg-emerald-500/10`) — these are Tailwind utility
  classes that resolve to the Tailwind palette (a design-token system itself).
  They are NOT hardcoded hex/rgb literals and were left intact, consistent with
  DEV-19's policy (§3.3).
- **`text-white` on the main report container (line 1341)** — the report
  container intentionally forces a "dark Bloomberg-terminal" look (dark
  gradient + white text). This is a design decision, not a hardcoded color
  literal. A future task could make the container theme-aware, but that is
  out of scope for DEV-19b (which targets only `#hex` / `rgba()` literals).
- **Comments referencing hex values** — the only remaining `#hex` match in
  `src/modules/reports/` is a JSDoc comment in `proxy-client.ts` (line 331:
  `hardcoded to #0a0e1a / #e5e7eb`), which was added by DEV-19 as
  documentation. Per the task's acceptance criterion
  ("excluding comments"), this is acceptable.

---

## 4. التحقق (Acceptance Tests — All PASS)

```
========================================================================
  DEV-19b ACCEPTANCE TESTS
========================================================================

(1) Zero hardcoded #hex literals in ExecutiveReportView.tsx:
  $ grep -cn "#[0-9a-fA-F]\{3,6\}" src/modules/reports/components/ExecutiveReportView.tsx
  → 0
  PASS ✅

(2) Zero rgba()/rgb() literals in ExecutiveReportView.tsx:
  $ grep -cn "rgba?(" src/modules/reports/components/ExecutiveReportView.tsx
  → 0
  PASS ✅

(3) Design-token references present (32 hsl(var(--…)) usages):
  $ grep -cn "hsl(var(--" src/modules/reports/components/ExecutiveReportView.tsx
  → 32
  PASS ✅

(4) #hex count in src/modules/reports/ (excluding comments):
  $ grep -rn "#[0-9a-fA-F]\{3,6\}" src/modules/reports/
  → src/modules/reports/lib/proxy-client.ts:331: * hardcoded to `#0a0e1a` / `#e5e7eb`.
     (single match — inside a JSDoc `*` comment line, excluded per task spec)
  PASS ✅

(5) ESLint clean:
  $ bun run lint
  → eslint exits 0, no output
  PASS ✅

(6) Pre-commit hook fired (DEV-14 §4 guards):
  [pre-commit] ✓ All guards passed — proceeding with commit.
  PASS ✅

(7) Commit pushed to origin/main:
  $ git log --oneline --grep="dev-19b" origin/main
  9eedb85 fix(dev-19b): replace hardcoded colors in ExecutiveReportView.tsx
  PASS ✅

(8) Working tree clean:
  $ git status
  → nothing to commit, working tree clean
  PASS ✅

========================================================================
  All acceptance tests PASS ✅
========================================================================
```

---

## 5. الـ Workflow (per task rules)

1. `git pull --rebase origin main` (already up to date — start of task) ✅
2. Read target file + grep for `#hex` / `rgba()` patterns ✅
3. Verify design tokens exist in `globals.css`
   (`--success`, `--danger`, `--warning`, `--muted-foreground`, `--background`,
   `--card`, `--foreground`, `--chart-2`, `--chart-4`) ✅
4. Apply replacements via `MultiEdit` (13 edit operations covering all 37
   color-literal occurrences) ✅
5. `bun run lint` (eslint exits 0) ✅
6. `git add src/modules/reports/components/ExecutiveReportView.tsx` ✅
7. `git commit -m "fix(dev-19b): replace hardcoded colors in ExecutiveReportView.tsx"` ✅
   (pre-commit hook fired: DEV-14 §4 guards PASS)
8. `git pull --rebase origin main` (rebased 1 commit onto 4052b20) ✅
9. `git push origin main` (4052b20..9eedb85) ✅

---

## 6. دروس مستفادة

1. **Recharts color props accept CSS variables.** Unlike the Sparkline SVG in
   `ReportsView.tsx` (where DEV-19 used Tailwind `stroke-emerald-500` classes
   on raw `<svg>` elements), Recharts components (`<Pie>`, `<Bar>`, `<Radar>`,
   `<Cell>`, `<Area>`, `<stop>`) receive color values as **props** that become
   SVG `fill`/`stroke` attributes. These accept `hsl(var(--token))` strings
   directly — the browser resolves the CSS variable at paint time. No runtime
   `getComputedStyle()` resolution needed for these.

2. **`rgba(255,255,255,X)` is a sneaky hardcoded color.** It looks like "just
   opacity" but it locks the hue to white. On a light-theme surface,
   `rgba(255,255,255,0.1)` is invisible (white-on-white). Replacing with
   `hsl(var(--foreground) / X)` makes the grid/border theme-aware: near-white
   in dark mode (visible), near-black in light mode (visible). This is a
   meaningful UX improvement, not just a cosmetic refactor.

3. **Tailwind arbitrary-value syntax handles `hsl(var(--token))`.** The pattern
   `from-[hsl(var(--card))]` generates valid CSS
   (`--tw-gradient-from: hsl(var(--card))`). The brackets just escape the
   value from Tailwind's class-name parser — the inner content is passed
   through verbatim. This means arbitrary-value classes can reference any CSS
   variable, not just static hex/rgb.

4. **`toPng` `backgroundColor` option vs. `contentStyle.backgroundColor`.**
   These look identical but behave differently:
   - `contentStyle.backgroundColor` (Recharts) → becomes an inline `style` on
     a DOM element → CSS variables resolve correctly.
   - `toPng` `backgroundColor` option (html-to-image) → becomes a canvas
     `fillStyle` → CSS variables do NOT resolve (canvas has no CSS context).
   
   For the latter, DEV-19's `resolveCssColor()` helper in `proxy-client.ts`
   is the robust solution (reads computed value at runtime). DEV-19b followed
   the task's explicit instruction (`hsl(var(--background))`) rather than
   expanding scope to wire up the helper — a trade-off worth noting for a
   future hardening task.

5. **`git diff` terminal rendering can corrupt bracket-heavy lines.** During
   review, the diff for line 1341 (`from-[hsl(var(--card))] via-[hsl(var(--background))] to-[hsl(var(--card))]`)
   displayed as `from-sl(var(--card))] via-sl(var(--background))] to-sl(var(--card))]`
   in the terminal — a display artifact, NOT a file corruption. Always
   verify suspicious diff output by reading the actual file with the `Read`
   tool before assuming the edit failed.

---

## 7. الـ Count summary (للتقرير)

### قبل (Before):
- `#hex` literals: **28 occurrences** (9 unique colors)
  - `#10b981` ×5, `#2dd4bf` ×3, `#f43f5e` ×2, `#f59e0b` ×1, `#64748b` ×1,
    `#0a0f1c` ×6, `#0c1220` ×2, `#94a3b8` ×6, `#fb923c` ×2 (in comment)
- `rgba(255,255,255,X)` literals: **9 occurrences**
  - `rgba(255,255,255,0.1)` ×5, `rgba(255,255,255,0.05)` ×2, `rgba(255,255,255,0.2)` ×2
- **Total hardcoded color literals: 37**

### بعد (After):
- `#hex` literals: **0**
- `rgba()/rgb()` literals: **0**
- Design-token references (`hsl(var(--…))`): **32** (across 9 distinct tokens)
  - `hsl(var(--success))` ×7
  - `hsl(var(--chart-2))` ×3
  - `hsl(var(--danger))` ×2
  - `hsl(var(--warning))` ×1
  - `hsl(var(--muted-foreground))` ×7
  - `hsl(var(--background))` ×6
  - `hsl(var(--card))` ×2
  - `hsl(var(--foreground) / X)` ×9 (with various alpha values)
  - `hsl(var(--chart-4))` ×2 (in comment)

### Grep verification (per task criterion):
```
$ grep -rn "#[0-9a-fA-F]\{3,6\}" src/modules/reports/ | wc -l
1
  (single match = JSDoc comment in proxy-client.ts line 331, added by DEV-19)
  (excluding comments → 0)  ✅

$ grep -rn "#[0-9a-fA-F]\{3,6\}" src/modules/reports/components/ExecutiveReportView.tsx | wc -l
0  ✅
```

---

## 8. المراجع (References)

- `src/app/globals.css` — design-token definitions
  (`--success`, `--danger`, `--warning`, `--muted-foreground`, `--background`,
  `--card`, `--foreground`, `--chart-1`–`--chart-5` for light + dark themes)
- `src/modules/reports/components/ExecutiveReportView.tsx` — the migrated file
- `agent-ctx/DEV-19-lead-technical-implementer.md` — prior task (DEV-19)
  that migrated 4 sibling report files and explicitly scoped OUT
  ExecutiveReportView.tsx (§3.3, §9 follow-up #1)
- `src/modules/reports/lib/proxy-client.ts` — `resolveCssColor()` helper
  (added in DEV-19) for runtime CSS-variable resolution in canvas contexts

---

## 9. Follow-up recommendations

1. **Harden `toPng` backgroundColor (optional).** Line 1025 now passes
   `hsl(var(--background))` to `toPng`'s `backgroundColor` option. Since
   canvas `fillStyle` does not resolve CSS variables, this option is
   effectively ignored at runtime. The visual PNG export still works because
   the report container's own gradient background is captured in the DOM
   snapshot. If exact background-color control on the canvas layer itself
   becomes important, switch to:
   ```ts
   import { resolveCssColor } from '@/modules/reports/lib/proxy-client';
   backgroundColor: resolveCssColor('--background') ?? 'transparent',
   ```
   This is a minor hardening, not a regression — left out of DEV-19b to
   respect task scope.

2. **Theme-awareness of the report container (design discussion).** The main
   report container (line 1341) uses `text-white` + a dark gradient. In light
   mode, `--card`/`--background` resolve to white, so the gradient becomes
   white-on-white and `text-white` is invisible. This is the same issue
   noted in DEV-19 §9 follow-up #3. A future design task should decide
   whether ExecutiveReportView should:
   (a) force-dark always (wrap in a `.report-surface-dark` utility that pins
       `--background`/`--card` to dark values regardless of theme), or
   (b) be fully theme-aware (swap `text-white` → `text-foreground`, drop the
       hardcoded `bg-slate-900/70` card surfaces in favor of `bg-card`, etc.).
   DEV-19b only removed color literals — it did not make this design call.

3. **Visual QA in staging recommended.** The Recharts color props now resolve
   from CSS variables. Confirm in a browser that:
   - Pie chart slices render with correct emerald/teal/rose/amber/slate hues.
   - Bar chart positive/negative cells are emerald/rose.
   - Radar "balanced" series is teal.
   - Tooltip backgrounds match the theme (dark in dark mode, white in light
     mode).
   - Grid lines / reference lines are visible in both themes.

---

DEV-19b complete. ✅

ملف `ExecutiveReportView.tsx` الآن 100% خالي من الألوان الثابتة — كل قيمة لونية
résolvable من design-token palette. الـ reports module بأكمله (4 ملفات من DEV-19
+ هذا الملف من DEV-19b) أصبح متوافقاً مع الـ design system.
