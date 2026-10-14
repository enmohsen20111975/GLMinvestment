# 🧬 07 — DATABASE DNA — قاموس قواعد البيانات
**آخر تحديث:** 2026-10-14 (Task B-DATA-SANITATION)
**المسؤول:** فريق Bravo (Python/DB)

---

## §1 — نظرة عامة على قواعد البيانات

| DB | الحجم | الدور | الحالة |
|----|-------|-------|--------|
| `stocks.db` | ~29MB | **SSOT الكنسي** — الأسهم + الأسعار + التوقعات + المؤشرات | ✅ نشط |
| `data_engine.db` | (إنتاج) | بيانات TradingView + Yahoo + Crypto + Metals | ✅ نشط (إنتاج) |
| `intraday.db` | ~450MB | بيانات اللحظية (intraday ticks) | ✅ نشط (إنتاج) |
| `auth.db` | ~0 | مصادقة NextAuth | ✅ نشط |
| `custom.db` | ~24KB | قاعدة مخصصة (legacy) | ⚠️ مراجعة |
| `predictions.db` | (إنتاج) | نسخة احتياطية من predictions (موجودة على VPS) | ✅ نشط (إنتاج) |

> **ملاحظة:** في الساندبوكس، `data_engine.db` و `intraday.db` و `predictions.db` قد لا تكون موجودة (تُستعاد من backup). في الإنتاج كلها نشطة.

---

## §2 — `stocks.db` — الجداول الكنسية (SSOT)

### الجداول الأساسية (4 أعمدة النظام):

| الجدول | الصفوف | الدور | مصدر التغذية |
|--------|-------|-------|-------------|
| `stocks` | 1,240 | بيانات الأسهم (ticker, name, market, sector, price, MA, RSI, S/R) | `daily_price_updater.py` + scraping |
| `stock_daily_prices` | 99,414 | الشموع اليومية (OHLCV) لكل الأسهم | `backfill_history.py` + `daily_price_updater.py` |
| `predictions` | 85 | التوقعات والصفقات (نشطة + مغلقة) | `multi_market_institutional_scan.py` + `build_audited_track_record.py` + `daily_predictor.py` |
| `market_indices` | 6 | مؤشرات الأسواق (EGX30, EGX70, TASI, etc.) | `update_market_indices.py` |

### جدول `predictions` — الأعمدة الكنسية:

| العمود | النوع | الدور |
|--------|------|-------|
| `ticker` | TEXT | رمز السهم |
| `signal` | TEXT | BUY / STRONG_BUY / ACCUMULATE / HOLD / SELL |
| `signal_type` | TEXT | `backtest_track_record` (موثق) / `institutional_scan` (نشط) |
| `prediction_date` | TEXT | تاريخ فتح الصفقة |
| `entry_price` | REAL | سعر الدخول |
| `target_price` | REAL | سعر الهدف |
| `stop_loss` | REAL | وقف الخسارة |
| `master_score` | REAL | درجة الثقة (0-95) |
| `outcome_date` | TEXT | تاريخ الإغلاق (NULL = نشطة) |
| `exit_price` | REAL | سعر الخروج |
| `actual_return` | REAL | العائد الفعلي % |
| `hit_target` | INTEGER | 1 = حقق الهدف |
| `hit_stop` | INTEGER | 1 = ضرب الوقف |
| `is_correct` | INTEGER | 1 = رابحة |
| `holding_days` | INTEGER | مدة الاحتفاظ |
| `notes` | TEXT | JSON يحوي catalyst, market, confidence, r_multiple |
| `highest_price_reached` | REAL | أعلى سعر وصلته الصفقة |
| `lowest_price_reached` | REAL | أدنى سعر وصلته الصفقة |

### جداول الدعم (نشطة):

| الجدول | الصفوف | الدور |
|--------|-------|-------|
| `market_pulse_cache` | 5,405 | كاش نبض السوق |
| `outcome_logs` | 8,544 | سجل نتائج الصفقات |
| `radar_signal_tracking` | 1,065 | تتبع إشارات الرادار |
| `real_evaluated_predictions` | 4,035 | توقعات تم تقييمها (legacy) |
| `screener_presets` | 2,175 | إعدادات Screener |
| `ticker_registry` | 1,197 | سجل الأسهم المسجلة |
| `stock_phase` | 1,238 | مراحل الأسهم |
| `screener_results` | 173 | نتائج Screener |
| `user_stock_watchlists` | 73 | قوائم مراقبة المستخدمين |
| `wealth_tracking` | 93 | تتبع الثروة |
| `analytics_events` | 856 | أحداث تحليلية |
| `investors_data` | 30 | بيانات المستثمرين |
| `portfolio_assets` | 25 | أصول المحفظة |
| `portfolios` | 9 | المحافظ |
| `user_notifications` | 181 | إشعارات المستخدمين |
| `market_regime_log` | 45 | سجل حالة السوق |
| `system_settings` | 6 | إعدادات النظام |
| `telegram_news` | 6 | أخبار تيليجرام |

### جداول مؤرشفة (16 جدول — `_archived_*`):

تم نقلها لأرشيف بـ `_archived_` prefix (Task B-PURGE-2). هذه الجداول ميتة ولا تُستخدم:
- `_archived_ExpertRecommendation_20261014`
- `_archived_cached_analysis_20261014`
- `_archived_conjunction_patterns_20261014`
- `_archived_egksco_*` (3 جداول)
- `_archived_indicator_*` (3 جداول)
- `_archived_maestro_personas_20261014`
- `_archived_prediction_logs_20261014`
- `_archived_real_evaluated_predictions_20261014`
- `_archived_regime_indicator_weights_20261014`
- `_archived_stock_adaptive_profiles_20261014`
- `_archived_stock_phase_20261014`
- `_archived_stocks_backup_20261014`
- `_archived_tuned_predictions_summary_20261014`

---

## §3 — `data_engine.db` — جداول البيانات الخارجية

> **في الإنتاج فقط.** يحتوي على:

| الجدول | الدور | مصدر التغذية |
|--------|-------|-------------|
| `historical_data` | شموع تاريخية للأسواق العالمية (US, Crypto, Metals) | `data_engine/main.py` |
| `crypto_prices` | أسعار العملات الرقمية | Crypto API |
| `gold_prices` | أسعار الذهب | Metals API |
| `tab_balance_sheet` | الميزانيات العمومية | TradingView scraper |
| `tab_cash_flow` | التدفقات النقدية | TradingView scraper |
| `tab_dividends` | التوزيعات | TradingView scraper |
| `tab_income_statement` | قوائم الدخل | TradingView scraper |
| `tab_key_metrics` | المؤشرات المالية | TradingView scraper |

> **ملاحظة:** جداول `*_pre_repair_*` مؤقتة ويجب حذفها + VACUUM دوري.

---

## §4 — `intraday.db` — بيانات اللحظية

| الجدول | الدور |
|--------|-------|
| `intraday_ticks` | بيانات اللحظية (كل 5 دقائق) لجلسة التداول |
| `session_preserved` | حفظ حالة الجلسة بين التحديثات |

**الحجم:** ~450MB (يُضغط دوريًا بـ WAL checkpoint)

---

## §5 — سياسة النسخ الاحتياطي

| النوع | المسار | السياسة |
|-------|-------|---------|
| Hot backup (نشط) | `db/backups/` | آخر 3 نسخ uncompressed (سريع الاستعادة) |
| Cold archive (بارد) | `db/backups/cold_archive/` | كل النسخ القديمة مضغوطة `.gz` (يوفر 75% مساحة) |

### أمر الضغط:
```bash
gzip -c db/backups/stocks_db_before_*.db > db/backups/cold_archive/stocks_db_before_*.db.gz
rm db/backups/stocks_db_before_*.db
```

---

## §6 — خدمة Python Backend (Port 8010)

| الخاصية | القيمة |
|---------|--------|
| المسار | `vps-service/main.py` (FastAPI) |
| Port | 8010 |
| PM2 name | `python-backend` |
| interpreter | `.venv/bin/python` |
| ecosystem | `ecosystem.config.js` |

### الأوامر:
```bash
# تشغيل
pm2 start ecosystem.config.js --only python-backend

# إعادة تشغيل
pm2 restart python-backend

# سجل
pm2 logs python-backend --lines 50

# حالة
pm2 status python-backend
```

### Endpoints حرجة (تتطلب Python يعمل):
- `/api/v2/commercial-feed` — Commercial Feed الموحد
- `/api/v2/liquidity-radar` — رادار السيولة
- `/api/maker-radar` — رادار الميكرز
- `/api/v2/recommend` — التوصيات
- `/api/stocks/[ticker]/unified` — تحليل موحد للسهم

---

## §7 — VACUUM (صيانة دورية)

```bash
# VACUUM stocks.db (استرجاع مساحة)
python3 -c "import sqlite3; sqlite3.connect('db/stocks.db').execute('VACUUM')"

# VACUUM data_engine.db (على الإنتاج)
python3 -c "import sqlite3; sqlite3.connect('db/data_engine.db').execute('VACUUM')"
```

**النتيجة الأخيرة:** VACUUM stocks.db = 28.3MB → 26.3MB (saved 2.0MB)

---

*تم إنشاء هذه الوثيقة بواسطة Task `B-DATA-SANITATION` — 2026-10-14.*
