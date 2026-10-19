# MERGE-LIST-CARDS + TELEGRAM-LINK — main agent

**Task ID**: `MERGE-LIST-CARDS` + `TELEGRAM-LINK`
**Branch**: `main` (single commit, pushed)
**Owner directive (Task B)**: "الكارت الموحد يكون هو بتاع التليجرام بتاع
البوت الى فية تحليل السهم وبياناته" — the unified infographic card must be
the one delivered by the Telegram bot publish flow.

---

## TASK A — Merge StockLeagueImageCard + TopTradesImageCard

### What was merged

| File | Before (LOC) | After (LOC) | Role after merge |
|---|---|---|---|
| `src/components/market/StockLeagueImageCard.tsx` | 326 | 519 | Canonical — added `mode?: 'league' \| 'trades'` + `trades?` + `monthName?` props + `TradesCardInner` |
| `src/components/market/TopTradesImageCard.tsx` | 208 | 42 | Thin re-export wrapper — delegates to StockLeagueImageCard with `mode='trades'` |
| **TOTAL** | **534** | **561** | **One canonical implementation, one wrapper** |

Note: total LOC went up slightly because the canonical file now embeds BOTH
the league layout AND the trades layout (two `forwardRef` inner components:
`LeagueCardInner` + `TradesCardInner`). The tradeoff is that there's now ONE
file owning the PNG-export pattern (forwardRef + html-to-image +
`ImageCardExport` wrapper + Telegram caption building + branding footer +
disclaimer). The wrapper file is a true re-export — no logic duplication.

### StockLeagueImageCard.tsx (canonical) — new public API

```ts
export interface LeagueEntry { /* unchanged — rank, ticker, name_ar, profit_pct, current_price, exit_price?, entry_price?, holding_days?, signal?, outcome_date? */ }
export interface TopTrade      { /* unchanged — ticker, name_ar, entry_price, exit_price, profit_pct, holding_days, signal?, outcome_date? */ }
export type   ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi_annual' | 'yearly';

export interface StockLeagueImageCardProps {
  mode?: 'league' | 'trades';   // default 'league'
  month?: string;               // league mode: YYYY-MM (legacy)
  period?: ReportPeriod;        // league mode: dynamic period (REPORTS-HUB-039)
  trades?: TopTrade[];          // trades mode: caller-provided trades list (no fetch)
  monthName?: string;           // trades mode: month name for header (defaults to current month)
}
```

Dispatch logic in the outer `StockLeagueImageCard`:
- `mode='trades'` → uses `tradesList = trades || []`, skips the `useEffect`
  fetch entirely (early-returns `setLoading(false)`), renders
  `<TradesCardInner>` with title "أفضل صفقات الشهر" + entry→exit rows.
- `mode='league'` (default) → existing behavior: fetches
  `/api/predictions/league-report?period=` OR `/api/predictions/monthly-league?month=`,
  renders `<LeagueCardInner>` with crown/medal/award rank badges.

Both modes share the same `ImageCardExport` wrapper (PNG download + Telegram
publish buttons), same branding footer, same disclaimer.

### TopTradesImageCard.tsx (re-export wrapper)

- Keeps the `TopTrade` interface re-exported (via `export { type TopTrade } from`)
  so `import { type TopTrade } from '@/components/market/TopTradesImageCard'`
  still resolves.
- Keeps the `TopTradesImageCardProps` interface exported with identical shape
  (`{ trades: TopTrade[]; monthName?: string }`).
- The `TopTradesImageCard` function component renders:
  ```tsx
  <StockLeagueImageCard mode="trades" trades={trades} monthName={monthName} />
  ```

### Backward compatibility — verified importers

| Importer | Before | After |
|---|---|---|
| `src/app/admin/honest-predictions/page.tsx` | `import { TopTradesImageCard, type TopTrade }` + `<TopTradesImageCard trades={topTrades} />` | unchanged import + same JSX call → resolves to wrapper → delegates to canonical |
| `src/app/admin/reports/page.tsx` | `import { StockLeagueImageCard, type ReportPeriod }` + `<StockLeagueImageCard period={selectedPeriod} />` | unchanged — canonical default `mode='league'` is backward-compatible |
| `src/app/admin/honest-predictions/page.tsx` | `<StockLeagueImageCard />` (alongside TopTrades) | unchanged — same canonical component, league mode default |

---

## TASK B — Link StockInfographicCard to Telegram bot publish

### Before

The `StockPublisher` admin "نشر على تيليجرام" button (`handlePublishToTelegramBot`)
sent TEXT ONLY to `/api/telegram/publish-stock` (JSON body: `{ ticker, market }`).
The route's `sendMessage` fallback kicked in — no image was ever delivered to
the Telegram channel. The owner's directive ("الكارت الموحد يكون هو بتاع
التليجرام") was not satisfied.

In parallel, `StockInfographicModal` (a separate component rendered as a
sibling in `StockDetail.tsx`) already did the right thing: captured
`StockInfographicCard` as PNG via `html-to-image` + sent multipart/form-data
to the same route (`sendPhoto`). That flow was correct but disconnected from
`StockPublisher`.

### After

`StockPublisher` now accepts an optional `infographicData` prop and, when
provided, captures the unified `StockInfographicCard` as PNG via
`html-to-image` and sends image+caption to `/api/telegram/publish-stock`
as multipart/form-data (same path the route already supports — see
`BOT-LINK-INTEGRATION` comment at top of the route).

### StockPublisher.tsx — new public API

```ts
export interface StockPublisherProps {
  data: StockPublishData;
  infographicData?: StockInfographicCardProps['data'];  // NEW
  trigger?: React.ReactNode;
  variant?: 'button' | 'icon' | 'full';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}
```

### StockPublisher.tsx — handlePublishToTelegramBot (rewritten)

Two-branch flow:

**Branch A — `infographicData` provided** (new):
1. Reset the off-screen container's inline transforms (the container is
   visually hidden at `scale(0.5)` + `left:-99999px` for layout purposes;
   we undo the transform during capture so html-to-image gets the real
   800px-wide card).
2. Expand the card's height/width to `scrollWidth`/`scrollHeight` (same
   trick `StockInfographicModal` uses) so nothing is clipped.
3. `toPng(el, { pixelRatio: 2.5, backgroundColor: '#070b13', skipFonts: false })`.
4. Convert dataURL → Blob via `fetch(dataUrl).then(r => r.blob())`.
5. Build FormData with `ticker`, `name_ar`, `market`, `caption`, `image`.
6. POST to `/api/telegram/publish-stock` via `adminFetch` (no `Content-Type`
   header — let the browser set the multipart boundary).
7. Toast reports `sent_as_photo` status from the route's response so the
   admin knows whether Telegram accepted the photo or fell back to text.

**Branch B — `infographicData` omitted** (backward-compat fallback):
- Same JSON body as before: `{ ticker, market, caption }`. The route's
  existing JSON path handles it (`sendMessage` only, no image).

If the capture throws or returns `null` (e.g., the off-screen ref isn't
mounted yet), the code falls through to Branch B and shows a toast:
"فشل التقاط صورة الكارت الموحد — سيتم إرسال النص فقط".

### StockPublisher.tsx — off-screen StockInfographicCard mount

Inside the `DialogContent` (rendered only when `infographicData` is truthy):

```tsx
{infographicData && (
  <div aria-hidden style={{
    position: 'absolute', left: '-99999px', top: 0,
    width: '800px', pointerEvents: 'none', opacity: 1,
  }}>
    <div style={{ transform: 'scale(0.5)', transformOrigin: 'top left', width: '800px' }}>
      <StockInfographicCard data={infographicData} cardRef={infographicCardRef} />
    </div>
  </div>
)}
```

Why off-screen instead of `display:none`: `html-to-image` needs the DOM node
to be live and laid out (with real dimensions) to capture it. `display:none`
yields a 0×0 image. The `position: absolute; left: -99999px` keeps the node
live but off-screen so the user never sees it. The `scale(0.5)` further
compresses the layout footprint without affecting the capture (we reset
`transform: 'none'` during capture).

### StockDetail.tsx — wiring

`src/modules/stock-analysis/components/StockDetail.tsx` already had both
`buildStockPublishDataFromStock(...)` and `buildStockInfographicDataFromStock(...)`
helpers. The `StockPublisher` call site was updated to pass both:

```tsx
<StockPublisher
  data={buildStockPublishDataFromStock(stock, deepAnalysis)}
  infographicData={buildStockInfographicDataFromStock(stock, deepAnalysis, footprintData)}
  variant="button"
  size="sm"
/>
```

The sibling `StockInfographicModal` is unchanged — it remains the
user-facing entry point for downloading the infographic as a standalone PNG
or copying it to the clipboard.

### Telegram route — verified (no change needed)

`src/app/api/telegram/publish-stock/route.ts` already supports BOTH:
- `multipart/form-data` with `image` Blob → `sendPhoto` with caption.
- JSON with base64 `image` string → converts to Blob → `sendPhoto`.
- JSON without `image` → `sendMessage` (text-only fallback).

The route also writes back the audit trail to `predictions.db`
(`was_published = 1`, `telegram_message_id`, `published_at`) for every
prediction matching `(ticker, today)`.

### StockInfographicModal — already correct (verified, no change needed)

The existing `StockInfographicModal.handleTelegramPublish` flow was already
doing exactly the right thing (capture → Blob → FormData → POST). My change
in `StockPublisher` mirrors its capture logic verbatim so behavior is
identical regardless of which entry point the admin uses.

---

## Issues encountered

1. **StockInfographicCard uses `cardRef` as a regular prop, not a forwardRef.**
   The component signature is `({ data, cardRef }: StockInfographicCardProps)`,
   not `forwardRef<HTMLDivElement, Props>`. This means I had to pass
   `cardRef={infographicCardRef}` as a normal prop rather than the React
   `ref` attribute. Confirmed by reading line 405 + line 449 (`ref={cardRef}`
   inside the component body).

2. **Capturing an off-screen scaled element.** The off-screen container
   scales the 800px card down to `scale(0.5)` for layout reasons (otherwise
   the absolute-positioned 800px-wide div would create a horizontal
   scrollbar). During capture, we must reset `transform: 'none'` AND
   explicitly set `width`/`height` to `scrollWidth`/`scrollHeight` so
   html-to-image renders at the natural 800px width. I copied this trick
   verbatim from `StockInfographicModal.captureCard`.

3. **No new files.** Per Rule 4, both tasks were accomplished by editing
   existing files only.

---

## Rules compliance

- ✅ Rule 4 (no new files) — only edited existing files
- ✅ Rule 16 (don't delete files — make them re-export) — `TopTradesImageCard.tsx`
  is now a 42-LOC re-export wrapper, not deleted
- ✅ Rule 28 (eliminate duplication) — one canonical StockLeagueImageCard
  owns the league+trades pattern; `handlePublishToTelegramBot` in
  StockPublisher now reuses the same StockInfographicCard + html-to-image
  flow that StockInfographicModal already uses (no second PNG pipeline)
- ✅ Read each file BEFORE editing (Read tool, then Edit/Write)
- ✅ Lint passes (`bun run lint` exit 0)
- ✅ HTTP 200 on `/`, `/admin/honest-predictions`, `/admin/reports`
- ✅ Push workflow per file: `git stash && git pull --rebase origin main && git stash pop`

---

## Notes for the next agent

- The `StockLeagueImageCard` canonical file is now ~520 LOC because it
  hosts two `forwardRef` inner components (`LeagueCardInner` +
  `TradesCardInner`). If you add a third list-card variant, add a third
  `XxxCardInner` here and a new mode value — don't create a new file.
- The off-screen StockInfographicCard mount inside StockPublisher renders
  whenever `infographicData` is truthy AND the dialog is open. If you want
  it mounted always (so the admin button works without opening the dialog
  first), move it outside the `<Dialog>` — but you'd also need to move the
  `infographicCardRef` ref to a top-level container.
- The `caption` sent to Telegram is now `publishText` (the rich Arabic
  formatted text from `generatePublishText(data)`). This includes
  recommendation + trading plan + liquidity + technical levels + the
  OFFICIAL_LINKS_BLOCK at the bottom — so the Telegram message has both
  the image AND the full text analysis.
- The route returns `sent_as_photo: boolean` in its JSON response; the
  toast now reports this so the admin immediately sees whether the photo
  was accepted or whether Telegram fell back to text-only.
