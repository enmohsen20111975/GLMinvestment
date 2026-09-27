# PHASE 0 — TRUTH LAYER GATE REPORT
# Generated: 2026-08-19
# Dataset: data/active_databases_20260817_full.zip
# MD5: 0947bdf6c2eff1a75ff8af6c3e576ed8 ✅

====================================
GLMINVESTMENT MASTER AUDIT — PHASE 0
====================================

GATE STATUS: **FAIL** (7 blockers — 2 critical, 5 KPI alignment)

---

## 0.1 — Dataset Verification: ✅ PASS

| field | value |
|-------|-------|
| path | data/active_databases_20260817_full.zip |
| size | 77,021,220 bytes |
| md5_computed | 0947bdf6c2eff1a75ff8af6c3e576ed8 |
| md5_expected | 0947bdf6c2eff1a75ff8af6c3e576ed8 |
| md5_match | ✅ TRUE |
| extraction | 18 DBs extracted to db/ |
| integrity_check | all PRAGMA integrity_check = ok |

---

## 0.2 — Data Provenance: ⚠️ NEEDS_OWNER

| DB | size | tables | integrity | disk==ZIP | status |
|----|------|--------|-----------|-----------|--------|
| predictions.db | 4.9MB | 27 | ok | ✅ | PASS |
| stocks.db | 12.4MB | 56 | ok | ❌ DRIFT | NEEDS_OWNER |
| price_history.db | 60.6MB | 2 | ok | ✅ | PASS |
| data_engine.db | 92.3MB | 23 | ok | ✅ | PASS |
| historical.db | 45.8MB | 3 | ok | ✅ | PASS |
| learned.db | 12KB | 2 | ok | ✅ | PASS |
| news.db | 13.6MB | 3 | ok | ✅ | PASS |

### Issue: stocks.db byte-drift
- on-disk MD5: b0ac24534db82fe72c4c800397b9bd04
- ZIP MD5:      33a86bcae687c379a447286a48a4fbb0
- **5 rows changed** (Arabic name_ar cleanup — cosmetic, آ→ا)
- **Decision**: Re-extract from ZIP to restore canonical state (FIXING NOW)

### Empty tables (data_missing):
- data_engine.egx_fundamentals: 0 rows
- learned.learned_lessons: 0 rows (learning loop not writing)
- news.news_api_keys: 0 rows

### Stale tables:
- prediction_logs: last 2025-02-20 (1.5 years stale)
- historical.daily_prices: only 110 rows (3-day window)

---

## 0.3 — Duplicate Audit: ⚠️ FAIL (structural) / PASS (real data)

### predictions (n_raw=153):
| key | duplicate_keys | % | severity |
|-----|---------------|---|----------|
| (ticker, date, persona, entry) | 2 | 2.61% | PASS (warning) |
| (ticker, date, entry) | 2 | 2.61% | PASS (warning) |
| morning_bell=1 (ticker, date) | 0 | 0% | PASS |

**Pattern**: morning_bell pipeline re-emitted 2 predictions that already existed (ids 21317/21318 ↔ 21408/21409 on 2026-04-08).

### persona_predictions (n_raw=1052):
| key | duplicate_keys | % | severity |
|-----|---------------|---|----------|
| (ticker, date, persona, entry) | 430 | 81.75% | FAIL (structural) |
| (ticker, date, persona_type, entry) | 0 | 0% | PASS (canonical) |

**Root cause**: `persona` column is constant 'balanced' (degenerate) — real discriminator is `persona_type` (gambler=564, investor=488). Using canonical key → 0 duplicates.

### prediction_logs (n_raw=80): 0 duplicates ✅

### Cross-table: 1 shared key (predictions ↔ persona_predictions)

---

## 0.4 — Channel Separation: ✅ PASS (with schema warning)

### predictions:
- Channel separator: `morning_bell` flag (0=balanced, 1=morning_bell)
- balanced: 114 | morning_bell: 39
- **overlap_count = 0** ✅

### persona_predictions:
- Channel separator: `persona_type` (gambler=564, investor=488)
- `persona` column uniformly 'balanced' (doesn't match persona_type) — schema warning

### KPI per channel (BACKTEST-FULL-001 formula):
| channel | n | WR | PF | Exp | max_loss | max_win |
|---------|-----|-----|-----|------|----------|---------|
| balanced | 109 | 55.05% | 1.71 | +1.97% | -7.59% | +50.0% |
| morning_bell | 39 | 46.15% | 1.04 | +0.13% | -7.23% | +11.21% |
| gambler | 0 | — | — | — | — | (all PENDING) |
| investor | 0 | — | — | — | — | (all PENDING) |

---

## 0.5 — KPI Provenance: ❌ FAIL (8/15 KPIs fail)

### Gold Standard (3 PASS):
1. ✅ admin/platform-performance — dedup + HARD cap + channel separation + exclusion_breakdown
2. ✅ scripts/backtest_full.py — same pipeline
3. ✅ deal-advisor/[ticker] — single-ticker, not WR/PF

### Failed KPIs (8 FAIL):
| # | KPI | source | critical issue |
|---|-----|--------|----------------|
| 3 | honest-tracking/stats | Node API | no dedup, ±100 cap, mixed channels |
| 4 | credibility | Node API | no dedup, no channel separation |
| 7 | hunter_pick stats | Python API | no HARD cap, no exclusion_breakdown |
| 8 | enhanced_tracker | Python | reads from legacy aiPrediction, no cap |
| 9 | live-monitor/ledger | Node API | string-match win_rate, LIMIT 50 |
| 11 | analyst/predictions | Node API | no HARD cap on pnl_pct |
| 12 | admin/execute_backtest | Python | **CRITICAL: random.uniform() — FAKE** |
| 13 | kimi/backtest | Python | **CRITICAL: avg_loss POSITIVE** |

### 7 BLOCKERS:
1. **P0 CRITICAL**: admin/execute_backtest returns random.uniform() — fake KPIs behind admin auth
2. **P0 CRITICAL**: kimi_backtest avg_loss is positive (violates sign rule)
3. **P0**: honest-tracking/stats mixes channels, wrong cap (±100 not ±50)
4. **P0**: credibility no dedup, no channel separation
5. **P1**: live-monitor/ledger string-match win_rate
6. **P1**: enhanced_prediction_tracker reads from wrong table (aiPrediction)
7. **P1**: hunter_pick_tracking no HARD cap

---

## GATE DECISION

| Gate | Status | Evidence |
|------|--------|----------|
| Dataset Integrity | ✅ PASS | MD5 match |
| MD5 | ✅ PASS | 0947bdf6... confirmed |
| Provenance | ⚠️ NEEDS_OWNER | stocks.db drift (fixing) |
| Duplicates | ⚠️ FAIL (structural) | persona degenerate column |
| Channel Separation | ✅ PASS | morning_bell + persona_type clean |
| KPI Provenance | ❌ FAIL | 8/15 KPIs don't meet standard |

**NEXT_PHASE_ALLOWED: NO**

---

## FIX PLAN (within PHASE 0)

### Fix 1: Re-extract stocks.db from ZIP (restore canonical)
### Fix 2: Remove/replace fake random.uniform() backtest (CRITICAL)
### Fix 3: Fix kimi_backtest avg_loss sign (CRITICAL)
### Fix 4-7: Document as NEEDS_OWNER (larger alignment needed)
