# 01 — المعمارية الكاملة

> **آخر تحديث:** 2026-10-25 | **Commit:** `a3d1d8b`

---

## 1. المعمارية الرباعية

```
Caddy (:81) — Gateway
  ├── Next.js (:3000) — DISPLAY ONLY
  ├── Python (:8010) — THE BRAIN (110 analyzers)
  ├── Data Engine (:5000) — Scrapers
  ├── WS Service (:3005) — socket.io
  └── Telegram Events (:3003) — relay
```

## 2. الخدمات (10)

| # | الخدمة | المنفذ | اللغة | الدور |
|---|--------|--------|------|-------|
| 1 | Caddy | 81 | Go | Gateway + Reverse Proxy |
| 2 | Next.js | 3000 | TypeScript | Display only |
| 3 | Python Backend | 8010 | Python | THE BRAIN |
| 4 | Data Engine | 5000 | Python | جلب البيانات |
| 5 | WS Service | 3005 | Bun | socket.io |
| 6 | Telegram Events | 3003 | Bun | relay |
| 7 | Ollama | 11434 | Go | LLM محلي |
| 8 | News Agent | — | Python | أخبار |
| 9 | Telegram Poster | — | Python | نشر |
| 10 | Telegram Bot | — | Python | بوت تفاعلي |

## 3. تدفق البيانات

```
Source → Data Engine → data_engine.db → stocks.db → Python Analyzers → predictions.db → API → Next.js → User
```

## 4. قواعد البيانات (9)

| DB | الحجم | الجداول | الدور |
|----|-------|---------|-------|
| stocks.db | 22 MB | 51 | operational (read-mostly) |
| predictions.db | 277 MB | 33 | THE BRAIN STORE |
| price_history.db | 97 MB | 2 | OHLCV يومي |
| intraday.db | 170 MB | 6 | سلاسل زمنية لحظية |
| data_engine.db | 52 MB | 19 | write target للـ scrapers |
| auth.db | 0.25 MB | 14 | مستخدمون + اشتراكات |
| news.db | 6 MB | 4 | أخبار |
| metrics.db | 6 MB | 3 | مراقبة الأداء |
| crypto.db | 0.03 MB | 3 | metadata كريبتو |

## 5. المكدس التقني

| الطبقة | التقنية |
|--------|---------|
| Framework | Next.js 16.1.3 (App Router, Turbopack dev / Webpack prod) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 + shadcn/ui (New York) |
| Database | Prisma 5.22 + better-sqlite3 |
| State | Zustand + TanStack Query v5 |
| Charts | lightweight-charts v5 + Recharts |
| Auth | NextAuth.js v4 |
| Real-time | socket.io (Bun) |
| AI | Ollama (glm-fast:latest) |
| Backend | Python FastAPI + Flask |
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
