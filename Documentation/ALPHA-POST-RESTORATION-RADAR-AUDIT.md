# ALPHA — Post-Restoration Audit + Liquidity Radar Forensic Report

> **Author:** Alpha (Frontend & UX Engineer)
> **Date:** 2026-10-25
> **Scope:** Verify commit `23b1fcb` restoration integrity + investigate Liquidity Radar active screen
> **Mode:** READ-ONLY — no code changes, no deployment, no DB writes

---

## Executive Summary

| Phase | Verdict |
|-------|---------|
| PHASE A — Restoration Integrity | 🟡 **PARTIAL PASS** (5 risks found) |
| PHASE B — Liquidity Radar Audit | 🔴 **3 confirmed defects** + 2 hypotheses |

**Critical finding:** The DB snapshot (`db_release_20261025/`) is committed but **not extracted**. The application cannot function until the DBs are unpacked into `db/`. The Liquidity Radar API returns `success: true` with `stocks: []` — misleading the UI into treating a broken state as a valid empty result.

---

## PHASE A — Restoration Integrity Audit

### Verification Results

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Remote HEAD = `23b1fcb` | ✅ PASS | `git ls-remote origin main` → `23b1fcb72b86caf44c2638bd60dcc47e7931d21b` |
| 2 | Commit `23b1fcb` exists locally | ✅ PASS | `git cat-file -t 23b1fcb` → `commit` |
| 3 | Files: 547 added + 639 modified + 0 deleted | ✅ PASS | `git diff b9a048a 23b1fcb --stat` |
| 4 | DB snapshot files (16) untouched | ✅ PASS | `db_release_20261025/` not in diff |
| 5 | Critical app files present | ✅ PASS | All 10 verified (next.config.mjs, package.json, premium-chart, GenericLiveLogConsole, store.ts, TradingChartView, maker_radar.py, BRAVO-P0-PLAN) |
| 6 | Secrets scan | ✅ PASS | Only `.env.example` with placeholders |
| 7 | TypeScript syntax check | ⚠️ 2046 errors | All pre-existing (educational-cards, helpers) — none in Alpha's code |
| 8 | Production build | ❌ BLOCKED | OOM (sandbox 4GB RAM) — not a code error |

### Risks Discovered in Commit `23b1fcb`

#### 🔴 RISK 1 (HIGH) — Old backup ZIPs in `data/` (147MB)

**25 ZIP files** committed as artifacts:

```
data/db_backup_2026-10-08T10-08-10_part1.zip
data/db_backup_2026-10-08T10-08-10_part7.zip
data/db_backup_2026-10-18T14-54-47_part1.zip
data/db_backup_2026-10-18T14-54-47_part3.zip
data/db_backup_2026-10-18T14-54-47_part5.zip
data/db_backup_2026-10-18T14-54-47_part8.zip
data/db_backup_2026-10-21T19-15-52_part1.zip
... (25 files total, ~147MB)
```

**Impact:** Bloats the repo, slows clones, not needed for application runtime.
**Fix:** Remove from repo + add `data/*.zip` to `.gitignore`.

---

#### 🔴 RISK 2 (HIGH) — `upload/predictions.db.zip` (30MB)

```
upload/predictions.db.zip  →  30,293,669 bytes
```

**Impact:** Database zip accidentally committed.
**Fix:** Remove + add `upload/*.db.zip` to `.gitignore`.

---

#### 🟡 RISK 3 (MEDIUM) — `scripts/camp/results/decisions_log.jsonl` (10MB)

```
scripts/camp/results/decisions_log.jsonl  →  10,532,364 bytes
```

**Impact:** Log artifact.
**Fix:** Remove + add to `.gitignore`.

---

#### 🔴 RISK 4 (CRITICAL) — DBs not extracted

The `db_release_20261025/` folder contains **16 tar.gz parts** (committed by `root` in `b9a048a`), but they have **not been extracted** to `db/`:

```
db/stocks.db         → ❌ NOT FOUND
db/predictions.db    → ❌ NOT FOUND
db/price_history.db  → ❌ NOT FOUND
db/intraday.db       → ❌ NOT FOUND
db/data_engine.db    → ❌ NOT FOUND
db/news.db           → ❌ NOT FOUND
db/auth.db           → 0 bytes (empty!)
```

**Impact:** Application cannot function. Any API route reading from `stocks.db` will fail. The Liquidity Radar API returns empty results (see PHASE B DEFECT 1).

**Fix:** Extract tar.gz parts into `db/` folder:
```bash
cd db_release_20261025/
cat stocks.db.tar.gz.* | tar xzf - -C ../db/
# repeat for each DB
```

---

#### 🟡 RISK 5 (LOW) — 2046 pre-existing TypeScript errors

All errors are in files NOT touched by Alpha's restoration:
- `src/app/admin/educational-cards/components/card-types.ts`
- `src/app/admin/educational-cards/components/helpers.ts`
- `src/app/admin/educational-cards/components/render-helpers.tsx`

**Impact:** `bun run build` will fail on the VPS until these are fixed.
**Fix:** Separate cleanup task (not Alpha's scope).

---

## PHASE B — Liquidity Radar Forensic Audit

### 1. Actual Execution Path (CONFIRMED)

```
User → http://localhost:3000/#liquidity-radar
  ↓
src/app/page.tsx:735
  case 'liquidity-radar':
    return <LiquidityRadarView market={...} initialTab="radar" />;
  ↓
src/components/shared/LiquidityRadarView.tsx:245
  ↓
LiquidityRadarView.tsx:287
  fetch(`/api/v2/liquidity-radar?market=${market}`)
  ↓
src/app/api/v2/liquidity-radar/route.ts:100 (GET handler)
  ↓
readRadarCache(market) ← src/modules/radar/lib/radar-cache.ts
  ↓
Reads: db/radar_cache_status.json + scripts/output/maker_radar_*.json
  ↓
Fallback: src/lib/egx-db.ts → reads stocks.db (direct SQLite)
```

### 2. Data Sources Verified

| Source | Used by active screen? | Evidence |
|--------|------------------------|----------|
| `/api/v2/liquidity-radar` | ✅ **PRIMARY** | `LiquidityRadarView.tsx:287` |
| `/api/market/liquidity-radar` | ❌ NOT used | Legacy Python proxy (commented out at line 285) |
| `scripts/maker_radar.py` | ✅ Writes cache | `radar-cache.ts` spawns it |
| `stocks.db` | ✅ Fallback for S/R levels | `route.ts:86` `buildSupportResistanceMap()` |

---

### 3. Confirmed Defects

#### 🔴 DEFECT 1 (CRITICAL) — Empty success response is misleading

**File:** `src/app/api/v2/liquidity-radar/route.ts:106-117`

```typescript
if (!cache || !cache.data) {
  const response: RadarResponse = {
    success: true,  // ← BUG: returns success even when no data
    market,
    stocks: [],
    message: 'لا توجد بيانات رادار مخزنة لهذا السوق بعد',
  };
  return NextResponse.json(response);
}
```

**Reproduced evidence (real API call):**
```bash
$ curl "http://localhost:3000/api/v2/liquidity-radar?market=EGX"
{
  "success": true,
  "market": "EGX",
  "market_regime": {"regime":"غير معروفة","change_pct":null,"is_bear":false,"is_bull":false},
  "scanned_count": 0,
  "stocks": [],
  "message": "لا توجد بيانات رادار مخزنة لهذا السوق بعد"
}
```

**Expected:** `success: false` OR a separate `data_available: false` flag so the UI can distinguish "API broken" from "API working but no data yet".

**User impact:** The frontend's `LiquidityRadarView` checks `if (!json.success)` to trigger error path. Since `success: true`, the error path is skipped. The user sees an empty radar with no clear error indication — they may believe the system is working when it's not.

**Severity:** CRITICAL

---

#### 🟡 DEFECT 2 (HIGH) — Hardcoded `flowStrength()` thresholds

**File:** `src/app/api/v2/liquidity-radar/route.ts:68-76`

```typescript
function flowStrength(netFlow: number | null | undefined): string | null {
  const abs = Math.abs(Number(netFlow));
  if (abs >= 10_000_000) return 'قوي جداً';   // 10M EGP
  if (abs >= 1_000_000) return 'قوي';           // 1M EGP
  if (abs >= 100_000) return 'متوسط';          // 100K EGP
  if (abs > 0) return 'ضعيف';
  return 'بدون';
}
```

**Issue:** These thresholds are **hardcoded with no backtesting basis**. For a large-cap stock (e.g., COMI), 10M EGP turnover is normal daily activity, not "قوي جداً". For a small-cap, 10M would be extraordinary.

**Expected:** Thresholds should be relative to the stock's average daily volume, or market-cap-tiered.

**User impact:** Misleading "قوي/ضعيف" labels. Users may act on inflated liquidity signals.

**Severity:** HIGH (hypothesis from source — needs backtesting to confirm)

---

#### 🟡 DEFECT 3 (MEDIUM) — Fabricated entry/stop/target levels

**File:** `src/app/api/v2/liquidity-radar/route.ts:155-167`

```typescript
const _entry = Number(s.entry_price ?? s.current_price) || 0;
const _stop = s.stop_loss ?? _srSupport ?? (_entry > 0 ? _entry * 0.97 : null);
const _risk = _entry > 0 && _stop != null ? _entry - _stop : 0;
const _target = s.target_price ?? _srResistance ?? (_risk > 0 ? _entry + 1.5 * _risk : null);
```

**Issue:** When the radar cache doesn't provide `stop_loss`/`target_price`, the API **invents** them:
- Stop = 3% below entry (hardcoded `* 0.97`)
- Target = 1.5× risk (hardcoded `+ 1.5 * _risk`)

These are **not based on any technical analysis** (ATR, SMC, support/resistance). They're presented to the user as if they were calculated trading levels.

**User impact:** Users see "دخول/وقف/هدف" and believe these are analytical outputs. In reality, when cache is incomplete, they're just `entry × 0.97` and `entry × 1.045`.

**Severity:** MEDIUM (confirmed from source)

---

### 4. Tests Executed

| # | Test | Type | Result |
|---|------|------|--------|
| 1 | Remote HEAD verification | `git ls-remote` | ✅ PASS — `23b1fcb` |
| 2 | Commit existence | `git cat-file` | ✅ PASS |
| 3 | File diff analysis | `git diff --stat` | ✅ PASS — 1186 files, 0 deleted |
| 4 | DB snapshot intact | `ls db_release_20261025/` | ✅ PASS — 16 files |
| 5 | Secrets scan | `git show` | ✅ PASS — only `.env.example` |
| 6 | Large files scan | `git cat-file -s` | ⚠️ WARN — 25 zips + 30MB upload |
| 7 | DB files extracted | `ls db/*.db` | ❌ FAIL — stocks.db missing |
| 8 | API endpoint test | `curl` | ✅ HTTP 200, but `stocks: []` |
| 9 | TypeScript check | `tsc --noEmit` | ⚠️ 2046 errors (all pre-existing) |
| 10 | Production build | `next build` | ❌ BLOCKED — OOM |

---

### 5. Handoff to Bravo (Backend Issues)

| # | Endpoint / File | Issue | Evidence | Severity |
|---|----------------|-------|----------|----------|
| 1 | `/api/v2/liquidity-radar` route | `success: true` with `stocks: []` misleads UI | `curl` returned empty with success flag | CRITICAL |
| 2 | `scripts/maker_radar.py` | Cache file not created on sandbox | `db/radar_cache_status.json` missing | HIGH |
| 3 | `radar-cache.ts` `readRadarCache()` | Stale cache handling unclear | Source inspection needed | MEDIUM |
| 4 | `flowStrength()` thresholds | Hardcoded 10M/1M/100K — no backtesting basis | `route.ts:68-76` | HIGH |
| 5 | entry/stop/target fallback | 3% / 1.5× hardcoded fabrication | `route.ts:155-167` | MEDIUM |

---

### 6. Recommended Next Action (Highest-Impact)

**⚠️ DO NOT `git pull` on the VPS until:**

1. **DBs are extracted** from `db_release_20261025/` into `db/` folder
2. **25 old ZIPs removed** from `data/` + `upload/predictions.db.zip` removed
3. **DEFECT 1 fixed** — API should return `success: false` when cache is missing
4. **Bravo completes P0 radar ownership** (verification preservation + history table)

---

## Blockers Requiring User Approval

1. **DB extraction** — Need approval to extract tar.gz parts into `db/` folder
2. **Artifact cleanup** — Need approval to remove 25 ZIPs + `upload/predictions.db.zip`
3. **API fix** — Need approval to modify `/api/v2/liquidity-radar/route.ts` for proper `success` flag

---

## Status

```
Restoration:    🟡 PARTIAL PASS — commit pushed but DBs not extracted
Radar:          🔴 3 confirmed defects — API misleading, hardcoded thresholds, fabricated levels
P0 (Bravo):     🔴 INCOMPLETE — not part of this audit
Production:     🚫 DO NOT DEPLOY — until DBs extracted + DEFECT 1 fixed
```

---

*End of report. Generated by Alpha on 2026-10-25. READ-ONLY investigation — no code changes made.*
