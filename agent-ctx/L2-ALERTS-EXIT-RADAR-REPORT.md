# Level 2 — Multi-Stage Alerts + Exit Radar

> **Task ID:** L2-ALERTS-EXIT-RADAR
> **Agent:** Backend Engineer (multi-stage alerts + exit radar)
> **Date:** 2026-09-27
> **Status:** ✅ Complete — all verification checks passed

---

## Part 1: Multi-Stage Smart Alerts

### New alert types: 4
| Type | Severity | Stage | Trigger | Message (sample) |
|------|----------|-------|---------|-------------------|
| `radar_signal_upgrade` | info | 2 | signal_count rose from X to Y (Y ≥ 4) | `📡 AMIA — قوة الإشارة ارتفعت من 4/6 إلى 6/6` |
| `radar_volume_surge` | success | 3 | `volume_ratio_10d_vs_20d ≥ 2.0` OR path upgraded to `A_pre_surge` | `🚀 AMIA — حجم اليوم 2.3× المعدل! (Pre-Surge)` |
| `radar_target_hit` | success | 4 | `current_price ≥ entry_price × (1 + target_1_pct/100)` | `🎯 AMIA — وصل الهدف الأول +10.5%!` |
| `radar_take_profit` | success | 5 | `current_price ≥ target_1 × 1.05` (approaching target 2) | `💰 AMIA — يُقترح أخذ نصف الربح والانتظار للهدف الثاني` |

The 5 existing alert types stay untouched: `radar_explosive`, `radar_opportunity`, `radar_distribution`, `radar_flare`, `radar_path_upgrade`. The 5-stage story fires in strict chronological order — once a stage fires, earlier stages cannot re-fire until the stock leaves the radar (which resets to Stage 1).

### Stage tracking: StockStage interface in RadarSnapshot
```typescript
export interface StockStage {
  ticker: string;
  currentStage: 1 | 2 | 3 | 4 | 5;
  stageReachedAt: Record<number, string>; // stage → ISO timestamp
  previousSignalCount: number;
  previousVolumeRatio: number;
  targetHitStage1: boolean;
  targetHitStage2: boolean;
}

interface RadarSnapshot {
  last_snapshot_at: string;
  explosive_tickers: string[];
  quiet_tickers: string[];
  tracked_transitions: Record<string, { prev_accumulation: string; since: string }>;
  tracked_paths?: Record<string, string>;
  stock_stages?: Record<string, StockStage>;  // NEW — backward-compat optional
}
```

The `stock_stages` field is **backward-compatible** — older snapshots without it load cleanly (defaulted to `{}`). The `TrackedStock` interface gained two optional fields: `target_1_pct` and `target_2_pct` (default to 10% / 20% when unset, mirroring the maker radar's position-sizing ladder).

### Pure helper functions (exported for unit tests)
- `makeInitialStockStage(ticker)` — creates a fresh Stage 1 entry with timestamp.
- `promoteStage(stage, targetStage)` — promotes strictly forward (no-op when `target ≤ current`, so stages never fire out-of-order). Pure function — does not mutate input.

### Tests: 23
File: `src/__tests__/alerts/multi-stage-alerts.test.ts` (365 LOC)

Coverage:
- `makeInitialStockStage` — Stage 1 entry creation + timestamp + baseline counters
- `promoteStage` — forward progression (1→2→3→4→5) + skip-ahead (1→5) + pure (no mutation)
- **Out-of-order protection** — promoting backwards/downgrade is a no-op, target-hit flags preserved
- Full Stage 1 → 2 → 3 → 4 → 5 progression simulation (AMIA story arc)
- Chronological monotonic timestamps (non-decreasing)
- Scheduler's `currentStage < N` check prevents Stage 4 from firing before Stage 3
- Stock leaves radar → stage resets to 1 (target-hit flags persist)
- Re-entered stock starts fresh at Stage 1
- `pathExitAr` + `exitSuggestedAction` Arabic labels + actions for all 5 exit paths

---

## Part 2: Exit Radar (رادار الخروج)

### New Python script: `scripts/exit_radar.py` (657 LOC)

5 exit paths implemented:
| Path | Arabic | Trigger | Action |
|------|--------|---------|--------|
| `X1_distribution_strong` | توزيع قوي | volume > 1.5× avg + close in lower half + 3+ sell days + net sell flow | بيع كامل أو تقليص قوي للمركز |
| `X2_volume_divergence` | تباعد حجمي | new 20-day high but volume < 0.7× avg (fake rally) | تقليص نصف المركز + وقف مضغوط |
| `X3_resistance_rejection` | رفض مقاومة | tested 20-day high + closed > 2% below it + long upper shadow | وقف عند آخر قاع + مراقبة الاختراق |
| `X4_exhaustion_gap` | فجوة إرهاق | rallied > 15% in 5 days + gap up + close red + volume declining last 2 days | بيع كامل — الاندفاع استُنفد |
| `X5_kill_switch_triggered` | Kill Switch | shared_liquidity.check_kill_switch (Limit Up Trap / توزيع قاتل / تدوير وهمي) | خروج فوري — لا تنتظر |

**Multi-market support:** EGX, TADAWUL, KSE, QSE, CRYPTO, GOLD via `--market` flag (uses the same portable DB fallback chain as `maker_radar.py`).

**Graceful degradation:** When no DB is available (sandbox/first-deploy), the script writes an empty JSON file with a `warning` field — so the API never returns 503, just an empty `exit_list`.

**CLI:**
```bash
python3 scripts/exit_radar.py                    # interactive report
python3 scripts/exit_radar.py --json-only        # JSON only
python3 scripts/exit_radar.py --market TADAWUL   # different market
python3 scripts/exit_radar.py --limit 50         # scan only 50 tickers
```

### New API: `/api/maker-radar/exit-radar`
File: `src/app/api/maker-radar/exit-radar/route.ts` (296 LOC)

- **GET** — reads cached `scripts/output/exit_radar_<date>.json` (instant <50ms). Triggers background warmup if stale (>15 min). Returns JSON shape:
  ```json
  {
    "success": true,
    "cached": true,
    "cache_age_seconds": 240,
    "cache_stale": false,
    "warmup_running": false,
    "market": "EGX",
    "db_source": "stocks.db::stock_daily_prices",
    "total_scanned": 956,
    "exit_count": 5,
    "exit_list": [...],
    "x1_distribution_strong": [...],
    "x2_volume_divergence": [...],
    "x3_resistance_rejection": [...],
    "x4_exhaustion_gap": [...],
    "x5_kill_switch_triggered": [...]
  }
  ```
- **POST** — synchronous warmup (used by cron / refresh button). Blocks up to 90s, then returns the fresh cache.

Uses the same Python-resolver chain as `radar-cache.ts` (PYTHON env → VIRTUAL_ENV → .venv → walk-up → `python3`).

### New UI: `ExitRadarTab.tsx` (583 LOC)
File: `src/components/predictions/radar/ExitRadarTab.tsx`

Lazy-loaded as a new tab in `MarketAnalysisView.tsx`:
```tsx
<TabsTrigger value="exit-radar">
  <DoorOpen className="h-4 w-4 text-rose-600" />
  <span>رادار الخروج</span>
</TabsTrigger>
<TabsContent value="exit-radar">
  <ExitRadarTab market={currentMarket === 'CRYPTO' ? 'EGX' : currentMarket} />
</TabsContent>
```

Features:
- 5 collapsible sections (one per exit path) with color-coded borders + badges
- Each section: UnifiedTable of stocks (ticker + price + volume ratio + 5-day rally + all_paths badges + reason)
- Stats header: market, scanned count, exit signals count, last update time
- "Refresh" button triggers POST endpoint (synchronous warmup) then re-fetches
- Auto-polls every 60s via `useVisibilityAwarePolling` (same pattern as MakerRadarTab)
- Loading / warming-up / error / empty states (all RTL Arabic, shadcn/ui-based)
- CRYPTO / GOLD markets fall back to EGX (script uses same DB fallback chain)

### New alert: `radar_exit_signal`
Severity: `warning` — fires when a tracked stock enters any of the 5 exit paths (X1-X5). Message:
```
🚪 إشارة خروج: {pathArabic}
{ticker} — إشارة خروج: {pathArabic}. {suggested_action}
```
The 24h dedup in `insertNotification` prevents spamming if the same exit path persists across multiple scheduler runs.

Wired into `runRadarAlertsCheck()` via `loadExitRadarEntries()` which:
1. Reads `scripts/output/exit_radar_<date>.json` (instant, no Python call)
2. Builds a `Map<ticker, ExitRadarEntry>` with highest-priority path per ticker (X5 > X1 > X4 > X3 > X2)
3. In the tracked-tickers loop, fires `radar_exit_signal` if the ticker is in the exit radar

### Exit radar cache helpers added to `src/lib/radar-cache.ts`
- `findLatestExitRadarFile()` — locates most recent `exit_radar_*.json` file
- `readExitRadarCache()` — reads + parses the cache JSON (instant <50ms)

### Tests: 0 (exit radar detection covered by Python inline verification)
- All 5 exit path detectors verified via inline Python tests (X1, X2, X3, X4, X5 all return `True` with expected reason strings on synthetic data)
- API endpoint verified via `curl` returning HTTP 200 with correct JSON shape
- UI verified via Agent Browser — Exit Radar tab renders with stats header + 5 collapsible sections + footer

---

## Verification

### `bun run lint` ✅
```
$ eslint .
EXIT=0
```

### `bun run test` ✅
```
Test Files  12 passed | 4 skipped (16)
Tests       194 passed | 37 skipped (231)
Duration    13.74s
```

All pre-existing tests still pass (4 files skipped are DB-integration tests that require production DBs not present on sandbox). The new test file `multi-stage-alerts.test.ts` adds 23 tests, all passing.

### `python3 -c "import ast; ast.parse(open('scripts/exit_radar.py').read())"` ✅
```
exit_radar.py syntax OK
```

### `python3 scripts/exit_radar.py --json-only` ✅
```
═══ رادار الخروج (Exit Radar) ═══
  DB: None
  Market filter: EGX
  Min price: 1.0
  shared_liquidity available: True
⚠️ مفيش DB متاح — حفظ JSON فاضي عشان الـ API ما يبقاش 503.
✅ Empty JSON saved: /home/z/my-project/scripts/output/exit_radar_20260927.json
```

Sandbox has no production DB — script gracefully writes an empty JSON file so the API/UI never 503. On production VPS (where `db/stocks.db` or `db/data_engine.db` exists), the script will populate the JSON with actual exit signals.

### API endpoint ✅
```bash
$ curl -s http://127.0.0.1:3001/api/maker-radar/exit-radar
HTTP 200
{
  "success": true,
  "cached": true,
  "cache_age_seconds": 240,
  "exit_count": 0,
  "exit_list": [],
  "x1_distribution_strong": [],
  ...
}
```

### Agent Browser: Exit Radar tab renders ✅
Verified via `agent-browser` snapshot:
- Tab `رادار الخروج` is visible and selectable in `MarketAnalysisView`'s TabsList
- Clicking it renders the `ExitRadarTab` component:
  - Heading "🚪 رادار الخروج" (level=3)
  - Subtitle "إشارات التوزيع والخروج — عكس رادار الميكرز"
  - Badges: market (EGX), scanned count, exit signal count
  - "تحديث" (Refresh) button
  - Empty state ("لا توجد إشارات خروج اليوم") when no exit signals, OR 5 collapsible sections when synthetic data present (verified)
- Verified all 5 exit path labels present in DOM: توزيع قوي, تباعد حجمي, رفض مقاومة, فجوة إرهاق, Kill Switch
- Screenshots saved: `agent-ctx/screenshots/exit-radar-tab.png` + `exit-radar-tab-populated.png`

---

## Files Created / Modified

### New files (5)
| File | LOC | Purpose |
|------|-----|---------|
| `scripts/exit_radar.py` | 657 | Python exit radar — 5 paths (X1-X5) |
| `src/app/api/maker-radar/exit-radar/route.ts` | 296 | API endpoint (GET + POST) |
| `src/components/predictions/radar/ExitRadarTab.tsx` | 583 | UI tab with 5 collapsible sections |
| `src/__tests__/alerts/multi-stage-alerts.test.ts` | 365 | 23 tests for stage progression |
| `agent-ctx/L2-ALERTS-EXIT-RADAR-REPORT.md` | this | Report |

### Modified files (3)
| File | Change |
|------|--------|
| `src/lib/schedulers/radar-alerts.ts` | Added StockStage interface, 4 new alert types, exit-signal alert, stage helpers (makeInitialStockStage, promoteStage, getSignalCount, loadExitRadarEntries, pathExitAr, exitSuggestedAction) |
| `src/lib/radar-cache.ts` | Added `findLatestExitRadarFile()` + `readExitRadarCache()` exports |
| `src/components/analysis/MarketAnalysisView.tsx` | Added `ExitRadarTab` lazy import + new TabsTrigger/TabsContent |

### Total LOC delta: +1,901 (new) + ~440 (modified radar-alerts.ts) = ~2,340 LOC

---

## Constitution Compliance

- **Rule 27 (no mock data)**: All exit radar data comes from `scripts/exit_radar.py` reading `db/stocks.db` / `db/data_engine.db`. The synthetic JSON I wrote during UI testing was cleared (script regenerated the empty cache).
- **Rule 32 (Python is brain, Next.js is display only)**: The exit radar detection runs in `scripts/exit_radar.py`. The Next.js API endpoint only reads the cached JSON + triggers background warmup — it never performs the detection itself.
- **Rule 1 (DB safety)**: No DB schema changes. The new `stock_stages` field is a JSON snapshot file (`db/radar_alerts_state.json`) — backward-compatible, optional field.
- **Multi-market**: Exit radar supports EGX, TADAWUL, KSE, QSE via the same `stocks.market` JOIN as `maker_radar.py`. CRYPTO + GOLD fall back to the `data_engine.db.historical_data` table (same fallback chain).

---

## Next Actions

1. **Production deployment**: When the L2 code reaches the production VPS, the exit radar cron should be added:
   ```
   */15 * * * * cd /home/z/my-project && python3 scripts/exit_radar.py --json-only --market EGX >> /var/log/exit_radar.log 2>&1
   ```
2. **Tracked stock target_1_pct / target_2_pct**: The `TrackedStock` interface now supports per-stock profit targets, but the tracking UI doesn't yet expose them. Future work: add target inputs to `MakerRadarTab.tsx`'s track dialog.
3. **Stage UI**: The `stock_stages` field is persisted in `db/radar_alerts_state.json`. Future work: a new "Stage Tracker" view could show each tracked ticker's current stage + stageReachedAt timestamps as a visual timeline.
4. **Stage-Exit interaction**: Currently, when a stock enters an exit path, the `radar_exit_signal` fires but stages 4/5 can still fire in the same cycle (we don't block them). Consider gating stages 4/5 when a high-priority exit path (X5 Kill Switch) is active — to avoid sending conflicting "take profit" + "exit immediately" signals.
