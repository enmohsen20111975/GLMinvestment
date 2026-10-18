# DATA-SOURCES.md — Source of Truth للبيانات (BRAVO-DATA-SOURCE-SPEC-001)

> **Task ID:** BRAVO-DATA-SOURCE-SPEC-001
> **Owner:** برافو (backend/quant) بالتعاون مع ألفا (frontend)
> **Status:** Canonical — أي تعديل لازم يمر بمراجعة برافو + كيمي
> **Constitution refs:** Rule 8 (ATR stop), Rule 18 (R/R ≥ 1.8), Rule 19 (position ≤ 2.5%), Rule 20 (Python = Brain), Rule 27 (NO-FAKE-DATA), Rule 73 (SINGLE-DISPLAY-SOURCE)

---

## 1. مخطط الـ DBs (7 قواعد بيانات)

### 1.1 الحالة الراهنة (2026-10-18)

| DB | المسار | الحجم | الجداول | الحالة | المصدر |
|----|--------|-------|---------|--------|--------|
| `predictions.db` | `db/predictions.db` | 281 MB | 46 | ✅ RESTORED | `data/predictions.db.zip` |
| `stocks.db` | `db/stocks.db` | 29 MB | 68 | ✅ RESTORED | `data/db_backup_..._part7.zip` |
| `auth.db` | `db/auth.db` | 356 KB | 23 | ✅ RESTORED | `data/db_backup_..._part1.zip` |
| `intraday.db` | `db/intraday.db` | — | — | 🔴 BLOCKED | محتاج VPS |
| `price_history.db` | `db/price_history.db` | — | — | 🔴 BLOCKED | محتاج VPS |
| `data_engine.db` | `db/data_engine.db` | — | — | 🔴 BLOCKED | محتاج VPS |
| `historical.db` | alias = `data_engine.db` | — | — | 🔴 BLOCKED | `HISTORICAL_DB = DATA_ENGINE_DB` |
| `news.db` | alias = `stocks.db` | — | — | ✅ COVERED | `NEWS_DB = STOCKS_DB` |

### 1.2 الـ Canonical Mapping (DBPaths)

`vps-service/utils/db_paths.py` هو **مصدر الحقيقة الوحيد** لمسارات الـ DBs:

```python
class DBPaths:
    MARKET_DB       = _resolve("MARKET_DB", "market.db")
    PREDICTIONS_DB  = _resolve("PREDICTIONS_DB", "predictions.db")
    AUTH_DB         = _resolve("AUTH_DB", "auth.db")
    CONTENT_DB      = _resolve("CONTENT_DB", "content.db")
    PRICE_HISTORY_DB = _resolve("PRICE_HISTORY_DB", "price_history.db")
    DATA_ENGINE_DB  = _resolve("DATA_ENGINE_DB", "data_engine.db")
    STOCKS_DB       = _resolve("STOCKS_DB", "stocks.db")
    INTRADAY_DB     = _resolve("INTRADAY_DB", "intraday.db")
    CRYPTO_DB       = _resolve("CRYPTO_DB", "crypto.db")

    # Aliases (consolidation — Rule 11 SSOT)
    GOLD_PRICES_DB  = DATA_ENGINE_DB  # gold_prices في data_engine.db (187K rows)
    HISTORICAL_DB   = DATA_ENGINE_DB  # historical_data
    NEWS_DB         = STOCKS_DB       # news في stocks.db
    COMMUNITY_DB    = CONTENT_DB      # community tables
```

**قاعدة صارمة:** كل كود Python لازم يستخدم `DBPaths` (ممنوع hardcoded paths). env override ليه الأولوية دايماً.

---

## 2. Schema لكل DB (الجداول الرئيسية)

### 2.1 `predictions.db` — التوقعات والتعلم (46 جدول)

| الجدول | الصفوف | الوصف | المصدر |
|--------|--------|------|--------|
| `aiPrediction` | 2,613 | توقعات V40.2 الإنتاجية | `v40_2_daily_generator.py` |
| `predictions` | 1,488 | توقعات legacy (backward compat) | `daily_predictor.py` |
| `persona_predictions` | 1,669 | توقعات الـ personas السبعة | `persona_engine.py` |
| `crypto_predictions_log` | 180,989 | سجل توقعات الكريبتو | `crypto_predictor.py` |
| `historical_trades` | 22,650 | صفقات تاريخية للـ backtest | `v38_backtest_engine.py` |
| `learned_lessons` | 19,983 | دروس متعلمة من النتائج | `learning_engine.py` |
| `live_ai_signals` | 1,636 | إشارات AI live | `live_ai_scanner.py` |
| `liquidity_signal_outcomes` | 1,308 | نتائج إشارات السيولة | `liquidity_tracker.py` |
| `exit_notifications` | 4,053 | تنبيهات الخروج | `exit_manager.py` |
| `morning_bell_signals` | — | إشارات صباحية | `morning_bell.py` |
| `stored_analyses` | — | تحليلات مخزنة | `analysis_engine.py` |
| `ExpertRecommendation` | 17 | توصيات الخبراء | `expert_engine.py` |
| `portfolio_positions` | — | مراكز المحفظة | `portfolio_manager.py` |
| `prediction_outcomes` | 0 | نتائج التوقعات (فاضي — يحتاج backfill) | `outcome_tracker.py` |

**الحقول الكنسية لـ risk_profile** (Rule 18):
```
sl, tp1, tp2, rr_ratio_tp1, rr_ratio_tp2
```
ممنوع قراءة المفاتيح القديمة `stop_loss` / `target_1` / `target_2` فقط (key-mismatch bug السابق).

### 2.2 `stocks.db` — بيانات السوق والأسهم (68 جدول)

| الجدول | الصفوف | الوصف | المصدر |
|--------|--------|------|--------|
| `stocks` | — | الميتاداتا الكنسية للأسهم | `egx_scraper.py` |
| `stock_daily_prices` | — | أسعار يومية تاريخية | `eodhd_backfill.py` |
| `investors_data` | 30 | تدفق المستثمرين (أفراد/مؤسسات × 3 جنسيات) | `egx_investors_scraper.py` |
| `market_indices` | — | مؤشرات EGX30/70/100 | `import_egx30.py` |
| `news` / `news_items` | — | الأخبار (NEWS_DB alias) | `news_scraper.py` |
| `telegram_news` | — | أخبار التليجرام | `telegram_fetcher.py` |
| `egksco_stocks` | 256 | أسهم EGX (scraper) | `egksco_scraper.py` |
| `conjunction_patterns` | 150 | أنماط اقتران المؤشرات | `conjunction_engine.py` |
| `indicator_trust_scores` | 10 | درجات ثقة المؤشرات | `learning_engine.py` |
| `gold_prices` | 3 | أسعار الذهب (legacy — canonical في data_engine) | — |
| `system_settings` | — | إعدادات النظام (SSOT للـ thresholds) | `engine_settings.py` |
| `maestro_personas` | — | إعدادات الـ personas | `persona_engine.py` |
| `radar_signal_tracking` | — | تتبع إشارات الرادار | `liquidity_radar_v2.py` |

### 2.3 `auth.db` — المصادقة والاشتراكات (23 جدول)

| الجدول | الصفوف | الوصف | المصدر |
|--------|--------|------|--------|
| `User` | 122 | المستخدمون | NextAuth.js |
| `Account` | 5 | حسابات OAuth | NextAuth.js |
| `Session` | 0 | الجلسات | NextAuth.js |
| `SubscriptionPlan` | 10 | خطط الاشتراك | `subscription_manager.py` |
| `UserSubscription` | 1 | اشتراكات المستخدمين | `subscription_manager.py` |
| `api_tokens` | 36 | توكنات API | `api_token_manager.py` |
| `task_runs` | 75 | سجل تشغيل المهام | `task_runner.py` |
| `watchlist` | — | قوائم المتابعة | `watchlist_manager.py` |

### 2.4 `intraday.db` — بيانات Intraday (BLOCKED)

- 1.1M rows (per DBPaths comment) — tick-level data
- المستخدمون: `backfill_intraday.py`, `dual_track_generator.py`, `intraday_scanner.py`
- **غير متاح في الساندبوكس** — محتاج VPS الإنتاجي

### 2.5 `price_history.db` — الأسعار التاريخية (BLOCKED)

- المستخدمون: `backtest_engine.py`, `market_regime.py`
- **غير متاح في الساندبوكس** — محتاج VPS الإنتاجي

### 2.6 `data_engine.db` — بيانات الـ data-engine (BLOCKED)

- يشمل: `gold_prices` (187K rows), `historical_data`, `fundamentals`
- المستخدمون: `backtest_engine.py`, `repair_data_engine.py`, `market_regime.py`
- Aliases: `GOLD_PRICES_DB`, `HISTORICAL_DB`
- **غير متاح في الساندبوكس** — محتاج VPS الإنتاجي

---

## 3. Python Endpoints ومصادر بياناتها

### 3.1 الخدمة الرئيسية: `vps-service/lightweight_server.py` (port 8010)

الـ Flask app الرئيسي. كل الـ endpoints بتقرأ من الـ DBs عبر `DBPaths`.

| Endpoint | Method | المصدر | الـ DB |
|----------|--------|--------|--------|
| `/api/market-pulse` | GET | مؤشرات السوق + top movers | `stocks.db` |
| `/api/market-overview` | GET | نظرة عامة السوق | `stocks.db` |
| `/api/flow/summary` | GET | ملخص التدفقات | `stocks.db` (flow_system) |
| `/api/flow/<ticker>` | GET | تدفق سهم واحد | `stocks.db` (flow_system) |
| `/api/flow/top` | GET | أعلى التدفقات | `stocks.db` |
| `/api/flow/heatmap` | GET | خريطة حرارية | `stocks.db` |
| `/api/explosive/scan` | GET | مسح الانفجارات الحجمية | `stocks.db` |
| `/api/explosive/hunt` | GET | صيد الانفجارات | `stocks.db` |
| `/api/live/sniper-scan` | GET | مسح القناص | `stocks.db` + `intraday.db` |
| `/api/exit/notifications` | GET | تنبيهات الخروج | `predictions.db` |
| `/api/expert-recommendations/active` | GET | توصيات الخبراء | `predictions.db` |
| `/api/crypto/live` | GET | أسعار الكريبتو live | `crypto.db` + API |
| `/api/crypto/flow/<symbol>` | GET | تدفق كريبتو | `crypto.db` |
| `/api/ai/live/scan` | GET | مسح AI live | `predictions.db` |
| `/api/health` | GET | صحة النظام | كل الـ DBs |

### 3.2 الـ Blueprints المنفصلة

| Blueprint | الملف | الـ endpoints الرئيسية |
|-----------|------|------------------------|
| `canonical_flow_bp` | `api/canonical_flow.py` | `/api/liquidity/buckets` (Rule 67 الكنسي) |
| `risk_bp` | `api/risk_routes.py` | `/api/risk/evaluate` (legacy) |
| `v2_bp` | `api/v2_routes.py` | `/api/v2/*` (توقعات + رادار) |
| `chart_bp` | `api/chart_routes.py` | `/api/chart/*` (Bear Trend Hard Cap) |
| `persona_bp` | `api/persona_routes.py` | `/api/persona/*` |
| `regime_bp` | `api/regime_routes.py` | `/api/regime/market` |
| `public_bp` | `api/public_routes.py` | `/api/market/overview` |
| `unified_v2_bp` | `api/unified_v2_routes.py` | `/api/unified/*` |

### 3.3 الـ Canonical Signal Endpoint (Rule 73)

```
GET /api/stocks/[ticker]/unified
  → vps-service/utils/canonical_signal.py
  → predictions.db (V40.2 aiPrediction)
```

**ده المصدر الوحيد** لـ: `signal`, `master_score`, `entry_price`, `target_1/2/3`, `stop_loss`, `rr_ratio`, `regime_confidence`, `analysis_text`.

---

## 4. Fallback Strategy الموحّدة

### 4.1 المبدأ: سياسة الفراغ (Rule 27)

لو الـ DB مفيهوش بيانات → **NULL** (مش fabrication).

```python
# ✅ CORRECT (Rule 27)
if not prediction:
    return {'entry_price': None, 'stop_loss': None, 'target_price': None}

# ❌ FORBIDDEN ( fabrication — مخالف Rule 27)
if not prediction:
    target = entry * 1.10   # ممنوع
    stop = entry * 0.92     # ممنوع
```

### 4.2 تسلسل الـ fallback للـ DBs

```
1. predictions.db (aiPrediction) — المصدر الكنسي للتوقعات
2. stocks.db (stocks + stock_daily_prices) — الميتاداتا + الأسعار
3. data_engine.db (fundamentals + gold_prices) — BLOCKED في الساندبوكس
4. intraday.db (tick data) — BLOCKED في الساندبوكس
```

### 4.3 لو DB كامل مش متاح

- الـ endpoint بيرجّع `{'success': false, 'error': 'db_unavailable', 'db': '<name>'}`
- ممنوع silent fallback لـ DB تاني بدون توضيح في الـ response
- الـ frontend بيعرض "— بيانات غير متاحة" (مش أرقام مفبركة)

### 4.4 ATR Stop Fallback (Rule 8)

```python
# flow_system.py:_compute_atr_stop_target
if ATR missing:
    stop_dist = 6.0  # fallback آمن داخل [5%, 9%]
else:
    stop_dist = clamp(ATR_pct × 1.5, [5.0, 9.0])
```

### 4.5 R/R Floor (Rule 18)

```python
# evaluate_risk()
if R/R < 1.8:
    signal = "CASH_WAIT"
    confidence = 0.0
    killed = True
```

---

## 5. العقد بين الـ Frontend و الـ Backend

### 5.1 Rule 20: Python = Brain، Node = Display

- **كل المنطق الحسابي في Python.** Next.js بـ يعرض فقط.
- ممنوع `if/for/compute/aggregate` في `route.ts` لغير auth/subscription/paywall.
- ممنوع فحص SQLite مباشرة من Node (3 endpoints تاريخية = violation).

### 5.2 الـ Proxy الافتراضي

```typescript
// src/app/api/*/route.ts
const PYTHON_BACKEND = process.env.PYTHON_BACKEND || 'http://localhost:8010';
const response = await fetch(`${PYTHON_BACKEND}${pathname}?${qs}`);
return NextResponse.json(await response.json());
```

### 5.3 الحقول الممنوع حسابها client-side (Rule 73)

```
signal, master_score, entry_price, target_1/2/3, stop_loss,
rr_ratio, regime_confidence, analysis_text, who_is_buying_state,
hmm_regime_ar, analysis_reason
```

لو الـ canonical endpoint رجّع NULL → اعرض "—" (ممنوع `× 0.95`, `× 1.05`, إلخ).

### 5.4 الحقول المسموح بقراءتها من DBs متعددة

- OHLC chart data (أسعار)
- المؤشرات الرياضية الـ pure (RSI, MACD, ATR — data، لا decision)
- ميتاداتا السهم (sector, name, is_egx30)

### 5.5 شكل الـ response الكنسي

```json
{
  "success": true,
  "source": "predictions.db.aiPrediction",
  "data": { ... },
  "meta": {
    "rr_floor": 1.8,
    "max_position_size": 0.025
  }
}
```

لو `success: false`:
```json
{
  "success": false,
  "error": "db_unavailable",
  "error_ar": "قاعدة البيانات غير متاحة",
  "db": "data_engine.db"
}
```

---

## 6. مسؤوليات الفرق

### 6.1 برافو (backend/quant)
- الحفاظ على `DBPaths.py` كـ SSOT
- الحفاظ على الـ schemas + migrations
- الحفاظ على الـ Python endpoints + fallback strategy
- تحديث هذا الـ spec عند أي تغيير schema

### 6.2 ألفا (frontend)
- قراءة كل decision data من `/api/stocks/[ticker]/unified` (Rule 73)
- ممنوع حساب `entry/stop/target/rr` client-side
- عرض "—" لو NULL (ممنوع fabrication)
- الـ proxy لـ Python backend (ممنوع SQLite مباشرة من Node)

### 6.3 كيمي (جودة)
- مراجعة هذا الـ spec عند أي PR يمس DBs
- التحقق من تطبيق Rule 27 (no fabrication)
- التحقق من تطبيق Rule 73 (single display source)

---

## 7. التحديثات

| التاريخ | الـ Task ID | التغيير |
|---------|-------------|---------|
| 2026-10-18 | BRAVO-DATA-SOURCE-SPEC-001 | إنشاء الـ spec (3/7 DBs restored، 3 BLOCKED) |

---

**الخلاصة:** هذا الـ spec هو الـ source of truth. أي تعارض بينه وبين كود → الكود غلط. أي تعديل لازم يمر بمراجعة برافو + كيمي + ألفا.
