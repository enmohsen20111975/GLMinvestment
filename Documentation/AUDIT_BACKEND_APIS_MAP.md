# 🔍 الجرد التشريحي للباك إند — Backend APIs Map

**تاريخ الجرد:** 13 أكتوبر 2026
**المكلف:** كبير مهندسي الكوانت والباك إند (Team Bravo)
**المرجع:** Documentation/MASTER_STRATEGIC_PLAN.md
**القاعدة:** ممنوع تعديل أي كود — جرد توثيقي فقط.

---

## 1. قواعد البيانات المتاحة

| قاعدة البيانات | الحجم | عدد الجداول | الحالة |
|---|---|---|---|
| `db/stocks.db` | 28.6 MB | 68 جدول | ✅ حي (المصدر الرئيسي) |
| `db/predictions.db` | غير متاح في الساندبوكس | — | ⚠️ غير موجود (إنتاج فقط) |
| `db/intraday.db` | غير متاح في الساندبوكس | — | ⚠️ غير موجود (إنتاج فقط) |
| `db/data_engine.db` | غير متاح في الساندبوكس | — | ⚠️ غير موجود (إنتاج فقط) |

---

## 2. جداول stocks.db (68 جدول)

### جداول حية (37 جدول)

| الجدول | الصفوف | الحالة |
|---|---|---|
| `stocks` | 1,240 | ✅ حي |
| `stock_daily_prices` | 97,218 | ✅ حي (المصدر الكنسي للأسعار) |
| `price_history` | 97,218 | ⚠️ مكرر (نفس stock_daily_prices) |
| `radar_signal_tracking` | 1,021 | ✅ حي |
| `real_evaluated_predictions` | 4,035 | ✅ حي |
| `predictions` | 0 | ⚠️ فارغ (المصدر الكنسي في predictions.db) |
| `market_indices` | 5 | ✅ حي |
| `market_pulse_cache` | 5,405 | ✅ حي |
| `market_regime_log` | 43 | ✅ حي |
| `screener_presets` | 2,175 | ✅ حي |
| `screener_results` | 173 | ✅ حي |
| `outcome_logs` | 8,544 | ✅ حي |
| `stock_phase` | 1,238 | ✅ حي |
| `stock_adaptive_profiles` | 69 | ✅ حي |
| `ticker_registry` | 1,197 | ✅ حي |
| `portfolio_assets` | 25 | ✅ حي |
| `portfolios` | 9 | ✅ حي |
| `user_stock_watchlists` | 73 | ✅ حي |
| `user_notifications` | 120 | ✅ حي |
| `analytics_events` | 810 | ✅ حي |
| `cached_analysis` | 23 | ✅ حي |
| `conjunction_patterns` | 150 | ✅ حي |
| `egksco_stocks` | 256 | ✅ حي |
| `egksco_sync_status` | 735 | ✅ حي |
| `egksco_price_history` | 0 | ❌ فارغ (لم يحدث) |
| `ExpertRecommendation` | 48 | ✅ حي |
| `gold_prices` | 3 | ✅ حي |
| `indicator_trust_scores` | 10 | ✅ حي |
| `investors_data` | 30 | ✅ حي |
| `macro_indicators` | 3 | ✅ حي |
| `stocks_backup` | 345 | ⚠️ نسخة احتياطية |
| `system_settings` | 1 | ✅ حي |
| `telegram_news` | 6 | ✅ حي |
| `tuned_predictions_summary` | 1 | ✅ حي |
| `user_sessions` | 2 | ✅ حي |
| `wealth_tracking` | 90 | ✅ حي |
| `sqlite_sequence` | 25 | ✅ حي |

### جداول فارغة/ميتة (31 جدول)

`alert_history`, `alert_settings`, `context_logs`, `daily_analytics_summary`, `error_logs`, `feature_usage`, `financial_obligations`, `financial_transactions`, `gold_alerts`, `indicator_weights`, `learned_lessons`, `maestro_personas` (معطل 410 Gone), `morning_reports`, `news`, `news_items`, `obligation_payments`, `page_views`, `paper_trades`, `pending_settlements`, `prediction_logs`, `price_alerts`, `regime_indicator_weights`, `scraping_status`, `signal_logs`, `telegram_images`, `telegram_messages`, `telegram_recommendations`, `ticker_performance`, `tracked_channels`, `trading_lessons`, `trading_rules`, `user_financial_settings`.

---

## 3. الجداول المشبوهة / المكررة

### 3.1 التوقعات

| الجدول | DB | الصفوف | الحالة |
|---|---|---|---|
| `predictions` | predictions.db | (إنتاج) | ✅ **المصدر الكنسي** |
| `predictions` | stocks.db | 0 | ⚠️ فارغ — لا يستخدم |
| `aiPrediction` | — | — | ❌ محذوف نهائيًا — ممنوع الاستعلام |
| `predictions_history` | — | — | ❌ غير موجود |
| `real_evaluated_predictions` | stocks.db | 4,035 | ✅ سجل تاريخي للباك-تست |

### 3.2 الأسعار

| الجدول | DB | الصفوف | الحالة |
|---|---|---|---|
| `stock_daily_prices` | stocks.db | 97,218 | ✅ **المصدر الكنسي** (Rule 46) |
| `price_history` | stocks.db | 97,218 | ⚠️ مكرر — يجب إهماله |
| `egksco_price_history` | stocks.db | 0 | ❌ فارغ — لم يحدث |

---

## 4. مسارات الـ API الرئيسية

### 4.1 lightweight_server.py (42 endpoint)

| المسار | HTTP | DB | الحالة |
|---|---|---|---|
| `/api/market-pulse` | GET | stocks.db | ✅ حي |
| `/api/live-monitor` | GET | stocks.db | ✅ حي |
| `/api/flow/*` | GET (4) | stocks.db | ✅ حي |
| `/api/explosive/*` | GET (4) | stocks.db | ✅ حي |
| `/api/exit/notifications` | GET | stocks.db | ✅ حي |
| `/api/live/sniper-scan` | GET | stocks.db | ✅ حي |
| `/api/expert-recommendations/active` | GET | stocks.db | ✅ حي |
| `/api/evidence-scorecard` | GET | stocks.db | ✅ حي (جديد T-05) |
| `/api/stock-profile/<ticker>` | GET | stocks.db | ✅ حي |
| `/api/market-overview` | GET | stocks.db | ✅ حي |
| `/api/smc/analyze/<ticker>` | GET | stocks.db | ✅ حي |
| `/api/health` | GET | stocks.db | ✅ حي |
| `/api/crypto/*` | GET/POST (14) | data_engine.db | ⚠️ DB غير متاح |
| `/api/ai/*` | GET/POST (3) | stocks.db | ✅ حي |

### 4.2 باقي ملفات API (200+ endpoint)

| الملف | endpoints | DB | الحالة |
|---|---|---|---|
| `admin_routes.py` | 74 | stocks.db | ✅ حي |
| `portfolio_routes.py` | 54 | stocks.db | ✅ حي |
| `telegram_routes.py` | 54 | stocks.db | ✅ حي |
| `chart_routes.py` | 4 | stocks.db | ✅ حي |
| `stock_analysis_routes.py` | 1 | stocks.db | ✅ حي |
| `v2_routes.py` | 12 | stocks.db | ✅ حي |
| `unified_v2_routes.py` | 7 | stocks.db | ✅ حي |
| `maestro_routes.py` | 13 | — | ❌ معطل (410 Gone) |
| باقي الملفات (20+) | ~80 | stocks.db | ✅ حي |

### 4.3 Next.js API Routes

| المسار | الملف | DB | الحالة |
|---|---|---|---|
| `/api/v2/chart/full-analysis` | route.ts | stocks.db | ✅ حي |
| `/api/rescue/analyze` | route.ts | stocks.db (Python) | ✅ حي |
| `/api/predictions/eid` | route.ts | stocks.db | ✅ حي |
| `/api/maker-radar/*` | (8 routes) | stocks.db | ✅ حي |

---

## 5. السكريبتات الدورية (Cron Jobs)

| الوقت | السكريبت | الجدول المحدث | الحالة |
|---|---|---|---|
| `0 3 * * 0-4` | `daily_predictor.py --today-only` | predictions.db | ✅ |
| `30 13 * * 0-4` | `daily_predictor.py --yesterday-only` | predictions.db | ✅ |
| `*/5 8-12 * * 0-4` | `intraday_scanner.py` | intraday.db | ✅ |
| `0 14 * * 0-4` | `daily_closer.py` | predictions.db | ✅ |
| `0 7,13 * * 0-4` | `daily_price_updater.py` | stock_daily_prices | ✅ |
| `*/5 8-14 * * 0-4` | `maker_radar.py --market EGX` | radar_signal_tracking | ✅ |
| `*/5 * * * *` | `maker_radar.py --market CRYPTO` | radar_signal_tracking | ✅ 24/7 |
| `0 */4 * * *` | `daily_predictor.py --market CRYPTO` | predictions.db | ✅ 24/7 |
| `50 2 * * 0-4` | `market_regime_engine.py` | market_regime_log | ✅ |
| `0 2 * * *` | `signal-tracker/verify` (curl) | radar_signal_tracking | ✅ |

---

## 6. الخلاصة التنفيذية

### المصادر الكنسية

| النوع | المصدر الكنسي | مصادر ميتة/مكررة |
|---|---|---|
| الأسعار اليومية | `stocks.db.stock_daily_prices` | `price_history` (مكرر), `egksco_price_history` (فارغ) |
| التوقعات | `predictions.db.predictions` | `stocks.db.predictions` (فارغ), `aiPrediction` (محذوف) |
| إشارات الرادار | `stocks.db.radar_signal_tracking` | — |
| التقييمات التاريخية | `stocks.db.real_evaluated_predictions` | — |

### تنبيهات حرجة

1. `predictions` في stocks.db فارغ — المصدر الكنسي في predictions.db فقط.
2. `aiPrediction` محذوف نهائيًا — ممنوع الاستعلام منه.
3. `price_history` مكرر (97,218 = نفس stock_daily_prices) — توحيد على stock_daily_prices.
4. `egksco_price_history` فارغ — لم يحدث.
5. `maestro_routes.py` معطل (410 Gone) — 13 endpoint غير نشطة.
6. 31 جدول فارغ في stocks.db.

*تم هذا الجرد بدون تعديل أي كود تنفيذي — توثيق فقط.*
