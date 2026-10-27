# C1: Code Path Map — Radar Signal Lifecycle
> **Task:** RADAR-CLOSURE-01 / Phase C1 | **Branch:** fix/radar-forensic-minimal

## Signal Creation
- `scripts/maker_radar.py:795-815` — INSERT into radar_signal_tracking (entry_price, status, data_quality, staleness_days)
- `scripts/maker_radar.py:806` — `initial_status = 'stale_data' if staleness_days > 3 else 'pending'`

## Outcome Writers (3 paths)
| Writer | File:Line | WHERE | market filter? | status filter? |
|---|---|---|---|---|
| A | verify_radar_signals.py:225 | `status='pending'` | NO (FIXED C2) | YES |
| B | radar_accuracy_report.py:218 | `signal_date>=cutoff` | NO | NO (ALL signals) |
| C | verify/route.ts (TS) | `status='pending'` | NO | YES |

**Writer B is the source of 259 stale_data+outcome_7d signals** (processes ALL, no status filter).

## Market Tag Writers
| Writer | Line | Specifies market? |
|---|---|---|
| eodhd_fetcher.py | 195 | ❌ NO (DEFAULT 'US') |
| daily_price_updater.py | 165 | ❌ NO (DEFAULT 'US') |
| price_unification.py | 98 | ✅ YES |
| gap_filler.py | 151 | ✅ YES |

## stale_data Writers
| Writer | Line | Trigger |
|---|---|---|
| maker_radar.py | 806 | staleness_days > 3 at INSERT |
| backfill_stale_radar_signals.py | 179 | age > 7 days retroactive |

## Execution Order
1. maker_radar.py → creates signals
2. eodhd_fetcher.py → updates stock_daily_prices (introduces US-tagged rows)
3. backfill_stale_radar_signals.py → retroactive stale_data marking
4. verify_radar_signals.py → processes pending only, writes outcomes + verified_at
5. radar_accuracy_report.py --write → processes ALL, overwrites outcomes (no verified_at)

## Queries Needing Market Filter (C2 fix scope)
- verify_radar_signals.py:59 `_fetch_n_sessions_from_sources` — FIXED
- verify_radar_signals.py:206 price_history fallback — FIXED
- generate_unified_audit.py:122 `fetch_nth_session_unified_or_ph` — FIXED
- radar_accuracy_report.py:104 `build_price_index` — NOT FIXED (out of scope, owner approval)
- maker_radar.py entry_price lookup — NOT FIXED (out of scope)
- verify/route.ts fetchPricesAfter — NOT FIXED (out of scope)
