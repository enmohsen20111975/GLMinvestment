# L2-WEEKLY-RADAR-REPORT — Implementation Report

**Task ID:** L2-WEEKLY-RADAR-REPORT
**Agent:** Backend + PDF Engineer (weekly radar report)
**Date:** 2026-09-27
**Status:** ✅ Complete

---

## Summary

Built the **Weekly Radar Report** — a PDF + PNG + JSON report for subscribers, sent every Sunday at 08:00 Cairo time via Telegram. The report contains:

1. **Stock of the Week** — highest-conviction pick (signal_count × risk/reward) with full targets + stop loss + signal strength
2. **Top 5 stocks** for the upcoming week (from `A_pre_surge` + `B_quiet_accumulation_strong` paths)
3. **Last-week performance** — entry price vs current price + return % + win rate
4. **Market regime** — DEFENSIVE/NORMAL/AGGRESSIVE with Arabic label
5. **Sector heatmap** — top 5 sectors by avg change %

---

## New files created (6 — 3,149 LOC)

| File | LOC | Purpose |
|------|-----|---------|
| `scripts/weekly_radar_report.py` | 1,289 | Python report generator (PDF + PNG + JSON + Telegram sender) |
| `src/app/api/radar/weekly-report/route.ts` | 301 | Next.js API endpoint (GET reads cache, POST regenerates) |
| `src/app/api/radar/weekly-report/pdf/route.ts` | 88 | PDF stream endpoint (application/pdf) |
| `src/components/predictions/radar/WeeklyReportTab.tsx` | 740 | React UI tab with stock of week + top 5 + perf + heatmap + subscribe CTA |
| `src/__tests__/radar/WeeklyReportTab.test.tsx` | 390 | 12 vitest tests (happy path + interactions + edge cases) |
| `vps-service/tests/test_weekly_radar_report.py` | 341 | 20 pytest tests (build_report_data, pick_top_5, targets, perf, CLI) |

Plus 1 supporting asset: `assets/fonts/NotoSansArabic.ttf` + `NotoSansArabic-Bold.ttf` (downloaded from Google Noto Fonts, ~488KB total) for Arabic text rendering in PDF + PNG.

## Modified files (4)

| File | Change |
|------|--------|
| `src/components/analysis/MarketAnalysisView.tsx` | +17 LOC: lazy-loaded WeeklyReportTab + new tab trigger + tab content |
| `vps-service/telegram/auto_post_scheduler.py` | +103 LOC: new `post_weekly_radar_report()` async function + wired into the Sunday `should_run_weekly()` branch (tries radar report first, falls back to legacy MarketDailyReport) |
| `crontab.txt` | +8 LOC: cron entry #16 — `0 6 * * 0` (Sunday 06:00 UTC = 08:00 Cairo) — runs `scripts/weekly_radar_report.py --market EGX --send-telegram` |
| `src/lib/radar-cache.ts` | No changes (reused existing readRadarCache + triggerBackgroundWarmup pattern) |

---

## Algorithm

1. **Read radar cache** — `scripts/output/maker_radar_<date>.json` (instant <50ms, no Python re-run)
2. **Read tracking file** — `db/maker_radar_tracking.json` (last week's tracked stocks)
3. **For each tracked stock**: get `entry_price` + `entry_date` from tracking JSON, fetch `current_price` from the radar DB (portable fallback chain — data_engine.db / stocks.db / etc.)
4. **Compute return %** + classify as win (≥+1.5%) / loss (≤-1.5%) / flat / no_data
5. **Pick top 5** — filter `A_pre_surge` + `B_quiet_accumulation_strong`, sort by signal_count desc → volume_ratio desc → price_stability desc, dedupe by ticker
6. **Pick Stock of the Week** — highest `signal_count × 2 + risk_reward` (T1% / |SL%|)
7. **Compute targets/stop** per path (pre_surge: +16%/+30%/-5%, quiet_strong: +10%/+20%/-5%)
8. **Read market regime** — from `stocks.db.system_settings` key `current_regime_<MARKET>` (mirrors `/api/market/regime` logic — Constitution §32: Python reads SQLite, Next.js displays)
9. **Read sector heatmap** — top 5 sectors by avg `change_percent` from `stocks.db.stocks` (mirrors `/api/market/sectors/intelligence` logic)
10. **Generate PDF** via ReportLab + NotoSansArabic font + arabic_reshaper + python-bidi (RTL shaping)
11. **Generate PNG** via matplotlib + font fallback chain (Noto Sans Arabic → DejaVu Sans) for Latin ticker symbols
12. **Send to Telegram** (optional `--send-telegram` flag) — sendPhoto with the PNG + caption, then sendMessage with the full text summary (split into 4000-char chunks for Telegram's 4096 limit)

## CLI

```bash
python3 scripts/weekly_radar_report.py                           # full: PDF + PNG + JSON
python3 scripts/weekly_radar_report.py --market EGX              # specific market
python3 scripts/weekly_radar_report.py --dry-run                  # print to stdout, no files
python3 scripts/weekly_radar_report.py --json-only                # skip PDF/PNG
python3 scripts/weekly_radar_report.py --send-telegram            # post to Telegram channel
python3 scripts/weekly_radar_report.py --stdout                   # JSON to stdout (for cron)
```

---

## API endpoints

### `GET /api/radar/weekly-report?market=EGX`
Returns the latest weekly report JSON (instant <50ms, cached). Triggers background regeneration if cache is stale (>6 hours).

Response shape:
```json
{
  "success": true,
  "cached": true,
  "cache_age_seconds": 120,
  "cache_stale": false,
  "warmup_running": false,
  "cache_generated_at": "2026-09-27T08:00:00.000Z",
  "market": "EGX",
  "report": {
    "generated_at": "...",
    "market": "EGX",
    "week_number": 40,
    "year": 2026,
    "week_start": "2026-10-04",
    "week_end": "2026-10-10",
    "week_start_ar": "4 أكتوبر 2026",
    "week_end_ar": "10 أكتوبر 2026",
    "market_regime": { "regime": "DEFENSIVE", "regime_ar": "دِفاعي (شد اللجام)", ... },
    "stock_of_week": { "ticker": "AMIA", "current_price": 12.50, "target_1": 14.50, ... },
    "top_5": [ { "ticker": "AMIA", ... }, ... ],
    "last_week_performance": { "stocks": [...], "avg_return_pct": 4.7, "win_rate_pct": 80 },
    "sector_heatmap": [ { "sector": "Finance", "avg_change_pct": 0.5, ... }, ... ],
    "radar_cache_found": true,
    "tracking_count": 5
  }
}
```

### `GET /api/radar/weekly-report/pdf?market=EGX`
Streams the latest PDF directly with `Content-Type: application/pdf` for inline display in the browser.

### `POST /api/radar/weekly-report?market=EGX`
Triggers synchronous regeneration (PDF + PNG + JSON). Blocks up to 90s. Used by the Sunday cron + the "Regenerate" button in the UI.

---

## Constitution compliance

- **Rule 27 (no mock data):** ✅ The script reads real radar cache + real tracking JSON + real regime/sectors from SQLite. Empty-state messages are user-facing, not mock data.
- **Rule 32 (Python is the brain):** ✅ `scripts/weekly_radar_report.py` is the brain. The Next.js API endpoint ONLY reads cached JSON (instant <50ms) + triggers background regeneration via `python3 scripts/weekly_radar_report.py`. The component never re-implements any analysis logic.
- **Rule 1 (DB safety):** ✅ No schema changes. Only reads `system_settings` + `market_regime_log` + `stocks` tables (readonly).

---

## Arabic font setup

No Arabic font was available on the sandbox (`/usr/share/fonts/` lacks NotoSansArabic, Amiri, etc.). Solution:
1. Downloaded `NotoSansArabic-Regular.ttf` + `NotoSansArabic-Bold.ttf` from the Google Noto Fonts GitHub repo (~488KB total) into `assets/fonts/`
2. Registered them with ReportLab via `pdfmetrics.registerFont(TTFont(...))`
3. Used `arabic_reshaper` + `python-bidi` (installed via `pip install arabic_reshaper python-bidi`) for RTL shaping
4. For matplotlib PNG, set `rcParams['font.family'] = ['Noto Sans Arabic', 'DejaVu Sans']` as a fallback chain — Noto Sans Arabic handles Arabic letters, DejaVu Sans handles Latin ticker symbols (AMIA, COMI, etc.) + emoji fallback

Result: both PDF and PNG render Arabic text correctly with proper letter shaping + RTL order.

---

## Verification results

### Lint
```
$ bun run lint
$ eslint .
exit: 0  ✅
```

### Tests
```
$ bunx vitest run src/__tests__/radar/WeeklyReportTab.test.tsx
✓ src/__tests__/radar/WeeklyReportTab.test.tsx (12 tests) 440ms
Tests  12 passed (12)  ✅

$ bunx vitest run src/__tests__/radar/ src/__tests__/alerts/
✓ 5 test files, 85 tests passed (85)  ✅

$ python3 -m pytest vps-service/tests/test_weekly_radar_report.py -v
======================= 20 passed, 21 warnings in 2.14s ========================  ✅

$ bun run test (full suite)
Tests  13 failed | 233 passed | 10 skipped (256 total)
(L2-SIGNAL-TIMELINE baseline: 13 failed | 221 passed — the 13 failures are all
pre-existing DB-integration tests that need a populated SQLite DB which the
sandbox doesn't have. Delta from my work: +12 new passing tests, 0 new failures.)
```

### Dry-run
```
$ python3 scripts/weekly_radar_report.py --dry-run
═══ التقرير الأسبوعي للرادار ═══
  Market: EGX
  DB: (none)
  DB source: None
======================================================================
📊 <b>التقرير الأسبوعي للرادار — الأسبوع 40، 2026</b>
📅 4 أكتوبر 2026 — 10 أكتوبر 2026
🏛️ حالة السوق: <b>NORMAL</b> (عادي)
...
Top 5 count: 0
Last-week perf stocks: 0
Sectors: 0
Regime: NORMAL  ✅
```

### Real generation
```
$ python3 scripts/weekly_radar_report.py
✅ JSON saved: scripts/output/weekly_radar_report_20260927.json  (1,070 bytes)
✅ PDF saved: scripts/output/weekly_radar_report_20260927.pdf    (27,656 bytes)
✅ PNG saved: scripts/output/weekly_radar_report_20260927.png    (102,693 bytes)  ✅
```

### API endpoint
```
$ curl http://localhost:3001/api/radar/weekly-report?market=EGX
HTTP 200  ✅
{
  "success": true,
  "cached": true,
  "cache_age_seconds": 642,
  "cache_stale": false,
  "warmup_running": false,
  "report": { "week_number": 40, "year": 2026, ... }
}

$ curl -o /tmp/test.pdf http://localhost:3001/api/radar/weekly-report/pdf?market=EGX
HTTP 200 | Content-Type: application/pdf | Size: 27,656 bytes  ✅

$ curl -X POST http://localhost:3001/api/radar/weekly-report?market=EGX
{
  "success": true,
  "duration_ms": 2027,
  "files": { "json": "...", "pdf": "...", "png": "..." }
}  ✅
```

### Agent Browser
- ✅ Navigated to `http://localhost:3001/#recommendations`
- ✅ Opened "متابعة التوقعات" → tab list shows 11 tabs including "التقرير الأسبوعي"
- ✅ Clicked "التقرير الأسبوعي" tab → renders with: header + week number + date range + regime badge + Refresh + Download PDF buttons + Subscribe CTA + 3 official links (Telegram/Website/Android)
- ✅ Empty state messages render correctly ("لا يوجد سهم مميز هذا الأسبوع", "لا توجد أسهم في الكاش", "لا توجد أسهم متابَعة من الأسبوع الماضي")
- ✅ Populated state verified with synthetic radar cache + tracking file: AMIA as Stock of the Week with T1=14.50 (+16%), T2=16.25 (+30%), SL=11.88 (-5%), signal strength 6/6 ⭐⭐⭐⭐⭐
- ✅ Download PDF button opens new tab to `/api/radar/weekly-report/pdf?market=EGX` and the PDF renders inline
- ✅ Screenshots saved: `agent-ctx/screenshots/weekly-report-tab.png` (empty state) + `weekly-report-tab-populated.png` (with test data)

### Cron job
Added to `crontab.txt`:
```cron
# ─── 16. Weekly Radar Report — تقرير أسبوعي كل يوم أحد صباحاً ───
0 6 * * 0 cd /root/GLMinvestment && /root/GLMinvestment/.venv/bin/python3 scripts/weekly_radar_report.py --market EGX --send-telegram >> /tmp/weekly_report.log 2>&1
```

### Telegram auto-poster
Added `post_weekly_radar_report()` async function in `vps-service/telegram/auto_post_scheduler.py` and wired it into the Sunday `should_run_weekly()` branch — tries the radar report first, falls back to the legacy MarketDailyReport-based weekly post if the radar report fails.

---

## Design decisions

1. **Python is the brain (Rule 32)** — The Next.js API endpoint ONLY reads cached JSON (instant <50ms) and triggers background regeneration via `python3 scripts/weekly_radar_report.py --json-only`. The component never re-implements any analysis logic. This mirrors the `radar-cache.ts` + `exit_radar.py` pattern from L2-ALERTS-EXIT-RADAR.

2. **Reuse the radar cache, don't re-run the radar** — `load_radar_cache()` reads the latest `scripts/output/maker_radar_<date>.json`. No duplicate scan. The weekly report is a thin aggregator on top of the daily radar cache.

3. **Graceful degradation** — Empty radar cache → empty `top_5` + `stock_of_week: null`. Empty tracking JSON → empty `last_week_performance.stocks`. No DB → regime defaults to NORMAL + empty sector heatmap. The component shows friendly Arabic empty-state messages.

4. **PDF + PNG + JSON** — The PDF is the formal archive (for email/website embedding), the PNG is for Telegram (inline preview), and the JSON is for the API + Flutter app. All three are generated by a single Python script run.

5. **Arabic font fallback chain** — NotoSansArabic for Arabic letters, DejaVu Sans for Latin ticker symbols. matplotlib's `rcParams['font.family'] = [...]` list applies the fallback automatically when a glyph is missing.

6. **Stale threshold 6 hours** — The weekly report is generated weekly, but we allow regeneration if the cache is older than 6 hours (covers the case where the user clicks the tab mid-week and the Sunday cron has already run).

7. **Telegram message splitting** — Telegram's `sendMessage` limit is 4096 chars. The full text summary is split into 4000-char chunks and sent as multiple messages. The PNG is sent first via `sendPhoto` with a short caption (≤1024 chars).

8. **Backward compatibility** — The legacy `post_weekly_report()` (using `MarketDailyReport`) is preserved as a fallback. If `post_weekly_radar_report()` fails (e.g., script missing, no DB), the scheduler automatically falls back to the legacy weekly post.
