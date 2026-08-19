# P42-FRONTEND-1 — Frontend Developer Subagent

## Task
Add two new UI cards (🔮 Candle Probability + 🧬 Stock DNA) to
`src/components/analysis/SingleStockAnalysisView.tsx` to display the new
`candle_probabilities` and `stock_dna` payloads returned by
`GET /api/v2/chart/full-analysis?ticker=X`.

## Work Log
1. Read `/home/z/my-project/worklog.md` (last 150 lines) — confirmed prior tasks
   P38–P41 + Flutter API audit work; nothing related to these specific cards.
2. Read the full `SingleStockAnalysisView.tsx` (937 lines) in chunks to
   understand:
   - The `FullAnalysisResponse` interface (lines 68–176).
   - The `fetchData()` hook hitting `/api/v2/chart/full-analysis` (or crypto
     variant) — confirmed the JSON is stored verbatim in `data` state, so any
     new backend field auto-flows into the UI without extra plumbing.
   - The card grid layout: `Row 1` = always-visible Confluence + Trade Plan
     (lines 787–901), `Row 2` = advanced-mode-only 4-card grid
     (lines 903–928). Decided to insert a new "Row 1.5" between them for the
     two new AI insight cards so they show in both simple and advanced modes.
   - Existing styling patterns: shadcn `Card`/`CardHeader`/`CardContent` +
     `Badge` are already imported; the file uses Tailwind utility classes with
     emerald/rose/amber palette (no indigo/blue for new UI per project rules).
3. Added three new TypeScript interfaces (`CandleProbabilities`, `MonthStat`,
   `StockDNA`) right above `FullAnalysisResponse` (lines 68–127 of the new
   file) matching the exact Python output shape from the task brief.
4. Added two new optional fields to `FullAnalysisResponse`:
   ```ts
   candle_probabilities?: CandleProbabilities | null;
   stock_dna?: StockDNA | null;
   ```
5. Implemented **Card 1 — 🔮 توقع الشمعة الجاية** (lines ~908–1063):
   - Big up (green) vs down (red) percentage display side-by-side.
   - Split horizontal bar (green/red widths) visualizing up vs down.
   - Bias line colored dynamically with `bias_color` from the API.
   - Breakout probability panels: break-high (0/+1/+2%) and break-low
     (0/-1/-2%), each with the previous high/low anchor price.
   - Target prices grid (+1%/+2%/-1%/-2%).
   - Footer: `prev_candle` (color-tinted) + `confidence` + `sample_size` +
     total 🟢/🔴 counts.
   - Header badge uses `bias_emoji + bias` with `bias_color` background.
   - All values guarded with `?.` and `?? '—'` so missing numbers never
     crash render.
6. Implemented **Card 2 — 🧬 بصمة السهم** (lines ~1065–1242):
   - Header with stock name + `summary` highlighted subtitle + personality
     badge (amber, with `personality_type_en` tooltip).
   - 4-stat grid: التذبذب / العائد السنوي (color-tinted for +/- or null) /
     أفضل يوم (green) / أضعف يوم (red).
   - Typical range block: min/max + horizontal position bar with current
     price marker pinned at `position_pct` from the right (RTL-aware).
   - Best months as green badges with `+X.X%`, worst months as red badges
     with `X.X%`.
   - Behavioral tags as outline pill badges prefixed with `#`.
   - Optional dividend timing line.
   - Full narrative in a `whitespace-pre-line` block with `max-h-60` and
     vertical scroll for long texts.
   - Footer: sector + sample_months + confidence.
7. Both cards are wrapped in `{(data.candle_probabilities || data.stock_dna) && (...)}`,
   so the row container itself only renders when at least one payload exists.
   Each card additionally self-guards on its own field. The outer grid uses
   `grid-cols-1 lg:grid-cols-2` so the cards stack on mobile and sit
   side-by-side on desktop. `dir="rtl"` is set on the row container for
   correct Arabic flow.
8. Verified:
   - `cd /home/z/my-project && bun run lint` → exit code 0, zero errors,
     zero warnings.
   - dev.log shows the dev server running normally with no compile errors
     after the edit (page compiled and served `GET / 200`).
   - Existing cards (Confluence, Trade Plan, SMC, Technical, Fusion,
     Fundamental) and all the existing handlers (screenshot, quick-add
     alert, maximize, refresh, timeframe selector, indicator toggles) are
     untouched and intact.

## Stage Summary
- File modified: `/home/z/my-project/src/components/analysis/SingleStockAnalysisView.tsx`
  - Added 3 TypeScript interfaces at lines 68–127 (`CandleProbabilities`,
    `MonthStat`, `StockDNA`).
  - Added 2 new optional fields to `FullAnalysisResponse` at lines 237–239.
  - Added new "Row 1.5" section at lines 903–1244 containing the two new
    shadcn `Card` components (~340 lines of new JSX).
  - Final file length: 1344 lines (was 937).
- No backend changes (backend already returns both fields per the brief).
- No new packages installed — reuses existing `Card`, `CardContent`,
  `CardHeader`, `Badge`, and the `cn()` helper already imported at the top
  of the file.
- Color discipline: only emerald/rose/amber/amber palette used for the new
  cards (no indigo or blue added). Dynamic colors come from the API's
  `bias_color` field. Pre-existing `indigo-500` usage in the SMC card
  (advanced mode) was left intact to avoid breaking existing visual style.
- Fully responsive: `grid-cols-1 lg:grid-cols-2` outer grid, inner grids use
  `grid-cols-2 sm:grid-cols-4` for the stats, all text uses Tailwind
  responsive text sizes.
- Graceful null handling: every numeric value is accessed via optional
  chaining and falls back to `—` or `0` so missing/null fields render a
  placeholder instead of throwing.
