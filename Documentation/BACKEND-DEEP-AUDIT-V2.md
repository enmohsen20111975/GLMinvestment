# 🚨 تقرير التدقيق المعماري العميق — Backend Audit Report V2

> **التاريخ:** 2026-10-28 | **المدقق:** Backend Audit (deep mode) | **الفرع:** `main`
> **النطاق:** `vps-service/` + `scripts/` + `data_engine/`
> **المنهجية:** فحص آلي شامل (grep + AST analysis) + مقارنة implementations

---

## الملخص التنفيذي

النظام **شغال في الإنتاج** لكنه مبني على أساس هش. الـ DAL وهمية، الـ canonical indicators مفروكة، وهناك **21,000+ سطر كود ميت** شارد في المستودع. 4,655 exception مطموس بصمت. 122 ملف بيتخطى البوابة المركزية. 3 جداول إنتاج عليها 10+ writers بيتنافسوا بدون coordination.

---

## 1. طبقة DAL — وهمية (CRITICAL)

### الادعاء
"db_manager + db_helpers = البوابة العازلة الوحيدة بين الكود والـ DB"

### الحقيقة
| المقياس | القيمة |
|---------|--------|
| ملفات بتستخدم DAL (db_manager / db_helpers) | 503 |
| ملفات بتفتح `sqlite3.connect` مباشرة | **122** |
| إجمالي `sqlite3.connect` مباشر | **481 مرة** |
| نسبة المخالفين | **24% من الكود بيتخطى DAL** |

**الـ db_helpers.py اللي اتعمل في المرحلة الأخيرة أصلح 9 ملفات من 122.** الباقي 113 ملف لسه بـ يفتح اتصالات مباشرة. البوابة العازلة موجودة على الورق بس.

### أسوأ المخالفين

| الملف | sqlite3.connect مباشر | التعليق الموجود |
|-------|----------------------|----------------|
| `misc_routes.py` | 28 | "ممنوع sqlite3.connect() مباشر" — السخرية |
| `trade_recorder.py` | 22 | بيستخدم _open_db + sqlite3.connect في نفس الوقت |
| `prediction_tracker.py` | 18 | import + direct |
| `prediction_optimizer.py` | 18 | import + direct |
| `backtest_engine.py` (analyzers) | 18 | import + direct |
| `intraday_storage.py` | 15 | مش بيستخدم DAL خالص |
| `portfolio_routes.py` | 15 | direct writes |
| `admin_routes.py` | 15 | import + direct |
| `daily_predictor.py` | 7 | بيفتح 3 DBs مباشرة |
| `daily_closer.py` | 6 | monkey-patch + direct |

---

## 2. Monkey-Patching خطير (CRITICAL)

`daily_closer.py` و `market_scheduler.py` بيستبدلوا `sqlite3.connect` عالميًا:

```python
_original_connect = sqlite3.connect
sqlite3.connect = _patched_connect  # ← يغير سلوك كل Python في العملية
```

**الخطر:** ده بيأثر على كل كود Python شغال في نفس العملية. أي module بيستخدم `sqlite3.connect` هياخد الـ patch بدون ما يعرف. لو الـ patch فيه bug → كل الـ DBs تتأثر بصمت.

---

## 3. المؤشرات الـ Canonical مفروكة (HIGH)

### الادعاء
"analyzers/indicators/ = SSOT (Single Source of Truth) — Rule 67"

### الحقيقة

| المؤشر | implementations في canonical | implementations خارج canonical | نسبة المخالفة |
|--------|------------------------------|-------------------------------|---------------|
| RSI | 1 (`indicators/rsi.py`) | **15+** ملف | 94% بيتخطى |
| ATR | 1 (`indicators/atr.py`) | **15+** ملف | 94% بيتخطى |
| MACD | 1 (`indicators/ma.py`) | **14+** ملف | 93% بيتخطى |
| SMA | 1 (`indicators/ma.py`) | **10+** ملف | 91% بيتخطى |

### تفصيل المخالفين

**RSI — 15+ ملف بيحسبه محليًا:**
- `historical_backfill_engine.py` — implementation محلي
- `backtest_engine.py` (engines + analyzers) — implementation محلي
- `enhanced_indicators.py` — implementation محلي (delegates حاليًا لكن الـ wrapper موجود)
- `technical.py` — wrapper (delegates لكن الـ class method موجود)
- `strict_entry_filters.py` — `_rsi()` محلي
- `multi_timeframe_engine.py` — implementation محلي
- `prediction_optimizer.py` — implementation محلي
- `live_indicator_engine.py` — implementation محلي
- `persona_screener.py` — implementation محلي
- `camp/data_analyzer.py` — implementation محلي
- + 5 scripts

**ATR — 15+ ملف بيحسبه محليًا:**
- `v68_oracle.py` — `_safe_atr()` (wrapper لكن بـ fallback 0.0 بدل None)
- `enhanced_indicators.py` — `calc_atr()` (delegates لكن الـ method موجود)
- `flow_system.py` — implementation محلي
- `prediction_optimizer.py` — implementation محلي
- `strict_entry_filters.py` — implementation محلي
- `risk_management_advanced.py` — implementation محلي
- `portfolio/multi_target_exit.py` — implementation محلي
- `portfolio/position_manager.py` — implementation محلي
- + 7 scripts

**الخطر:** لو الـ canonical ATR اتعدل (مثلاً Wilder's smoothing)، الـ 15 ملف مش هيتأثروا → نتايج مختلفة لنفس السهم = تناقض في التوصيات.

### ملاحظة إيجابية
بعض الملفات (enhanced_indicators.py, technical.py, v68_oracle.py, strict_entry_filters.py) دلوقتي بـ delegates لـ canonical. ده تحسن عن قبل — لكن الـ wrappers لسه موجودة وتـ create طبقة غير ضرورية.

---

## 4. تكرار دوال Utility (HIGH)

| الدالة | عدد النسخ | الفرق بين النسخ |
|--------|-----------|-----------------|
| `_to_float` | 10 | بعضها بـ regex، بعضها بـ try/except فقط |
| `_safe_float` | 20 | 5 implementations مختلفة (بعضها بـ K/M/B، بعضها بـ None، بعضها بـ 0.0) |
| `_sma` | 10 | كلها نفس المنطق بس في أماكن مختلفة |
| `parse_volume` | 23 | بعضها بـ regex، بعضها بـ multipliers |
| `get_db` / `_connect` / `get_db_connection` | 28 | كلها بتعمل نفس الحاجة بطريقة مختلفة |

### مقارنة `_safe_float` (5 implementations مختلفة):

```python
# explosive_scanner.py — بـ K/M/B suffixes + Unicode
def _safe_float(val, default=0.0):
    s = str(val).replace('−', '-').replace('،', '').replace('\u202f', '').strip()
    m = re.match(r'^([+-]?\d+\.?\d*)\s*([KMBkmb])?$', s)

# build_stock_profiles.py — بسيط
def _safe_float(val, default=0.0):
    v = float(val)
    return v if math.isfinite(v) else default

# lightweight_server.py — بيرجع None (مش default)
def _safe_float(val):
    return float(str(val).replace('−', '-').replace('،', '').strip())

# analyses.py — بيرجع 0.0 دايماً
def _safe_float(val):
    return float(val) if val is not None else 0.0

# nightly_analysis.py — بـ regex مختلف
def _safe_float(val, default=0.0):
    m = re.match(r'^([+-]?\d+\.?\d*)', s)
    return float(m.group(1)) if m else default
```

**الخطر:** نفس السهم ممكن يطلع قيم مختلفة في شاشات مختلفة لأن كل واحدة بتستخدم `_safe_float` مختلفة.

---

## 5. ملفات شاردة (MEDIUM)

### 21,335 سطر كود ميت في orphaned scripts

| الملف | الأسطر | الحالة |
|------|--------|--------|
| `close_predictions.py` | 800 | orphaned |
| `liquidity_backtest_engine.py` | 734 | orphaned |
| `rr_fix_before_after.py` | 591 | orphaned |
| `paper_trading.py` | 568 | orphaned |
| `dual_track_generator.py` | 529 | orphaned |
| `run_backtest_v3.py` | 518 | orphaned |
| `run_backtest_v2.py` | 517 | orphaned |
| `v40_4_multi_market_backtest.py` | 495 | orphaned |
| `smart_db_backup.py` | 473 | orphaned |
| `rr_fix_before_after_v2.py` | 473 | orphaned |
| + 20 ملف تاني | ~16,000 | orphaned |

### Modules كاملة شاردة

| Module | الأسطر | مستورد من |
|--------|--------|-----------|
| `camp/` (10 ملفات) | 4,520 | `scripts/camp/run_phase0.py` بس (نفسه orphaned) |
| `glminvestment_engines/` | 2,459 | `engines/` اللي هي نفسها شاردة |

**إجمالي الكود الميت: ~28,314 سطر** (21,335 scripts + 4,520 camp + 2,459 glminvestment_engines)

---

## 6. تضارب في API Routes (MEDIUM)

| المسار | عدد المرات | المشكلة |
|--------|-----------|---------|
| `/status` | 8 | 8 endpoints مختلفة بنفس المسار |
| `/list` | 3 | 3 endpoints مختلفة |
| `/evaluate` | 3 | 3 endpoints مختلفة |
| `/trades/outcomes` | 2 | تضارب |
| `/trades/learn` | 2 | تضارب |
| `/track` | 2 | تضارب |
| `/ticker/<ticker>` | 2 | تضارب |
| `/summary` | 2 | تضارب |
| `/scan` | 2 | تضارب |

---

## 7. 4,655 Exception مطموس (HIGH)

| المقياس | القيمة |
|---------|--------|
| إجمالي except blocks | 4,751 |
| except + pass (مطموسة) | **4,655** (98%) |

**98% من الـ exceptions بيتـ catch ويتـ تجاهل بصمت.** ده يعني:
- أي bug بيتـ hide
- أي DB error بيتـ ignore
- أي network failure بتمر بدون log
- مستحيل تتبع مشكلة لما تحصل

---

## 8. writers متعددة لنفس الجدول (CRITICAL)

### predictions table — 10+ writers

| Writer | الحالة |
|--------|-------|
| `daily_predictor.py` | ✅ الكاتب الأساسي |
| `prediction_tracker.py` | ⚠️ كاتب ثاني |
| `intraday_scanner.py` | ⚠️ كاتب ثالث |
| `crypto_lab_scheduler.py` | ⚠️ كاتب رابع |
| `generate_persona_predictions.py` | ⚠️ كاتب خامس |
| `close_predictions.py` | ⚠️ orphaned بس بيـ write |
| `dual_track_generator.py` | ⚠️ orphaned بس بيـ write |
| + 3 migration scripts | ⚠️ one-time |

### stocks table — 15+ writers

| Writer | الحالة |
|--------|-------|
| `tradingview_scanner_live.py` | ✅ الكاتب الأساسي |
| `egx_fetcher.py` | ⚠️ كاتب ثاني |
| `egksco_scraper.py` | ⚠️ كاتب ثالث |
| `eodhd_fetcher.py` | ⚠️ كاتب رابع |
| `market_scheduler.py` | ⚠️ كاتب خامس |
| + 10 scripts (migrate/fix/normalize) | ⚠️ one-time |

### stock_daily_prices — 10+ writers

| Writer | الحالة |
|--------|-------|
| `tradingview_scanner_live.py` | ✅ الكاتب الأساسي |
| `daily_price_updater.py` | ⚠️ كاتب ثاني |
| `gap_filler.py` | ⚠️ كاتب ثالث |
| `eodhd_fetcher.py` | ⚠️ كاتب رابع |
| + 6 scripts | ⚠️ one-time |

**الخطر:** tضارب كتابة متزامنة = `SQLITE_BUSY` + WAL corruption + فقد بيانات.

---

## 9. SQL Injection risks (MEDIUM)

15 ملف بيستخدم `f-string` في SQL queries بدلاً من parameterized queries:

```python
cursor.execute(f"SELECT COUNT(*) FROM {table}")      # ← table من user input?
cursor.execute(f"ALTER TABLE {table_name} ADD ...")   # ← table_name من config?
cursor.execute(f"DELETE FROM {table} WHERE id IN ({placeholders})")
```

كلها في scripts (مش API routes) — الخطر أقل لكنه موجود.

---

## 10. requests.get بدون timeout (MEDIUM)

```python
requests.get('https://...')  # ← ممكن يعلق للأبد
```

في `telegram_interactive_bot.py` + `egx_investors_scraper.py`. أي request يعلق = الـ process كله يعلق.

---

## 11. Hardcoded paths (LOW)

```python
python_bin = sys.executable or '/home/meme/my_apps/GLMinvestment/.venv/bin/python3'  # misc_routes.py:1650
DB_DIR = Path("/home/meme/my_apps/GLMinvestment/db")  # repair_stock_price_history.py:5
```

لو الـ repo اتنقل → break.

---

## 12. Dead functions في master_analyzer.py (LOW)

7 دوال عامة (public) مش مستدعاة داخليًا:
- `analyze_with_learning`
- `detect_who_is_buying`
- `generate_analysis_reason`
- `get_dynamic_rsi_overbought`
- `get_dynamic_rsi_oversold`
- `get_dynamic_volume_surge_mult`
- `scan_market`

قد تكون مستدعاة خارجيًا (API routes) — يحتاج تحقق يدوي.

---

## الحكم النهائي

| الادعاء | الحقيقة |
|--------|---------|
| "DAL عازلة بين الكود والـ DB" | **كذب** — 122 ملف بيتخطاها (24%) |
| "canonical indicators = SSOT" | **كذب** — 15+ implementation لكل مؤشر (94% بيتخطى) |
| "db_helpers.py أصلح البوابة" | **مبالغة** — أصلح 9 من 122 (7.4%) |
| "النظام مترابط" | **كذب** — 28,314 سطر كود ميت + 30+ ملف شارد |
| "مافيش تكرار" | **كذب** — _safe_float في 20 ملف (5 implementations مختلفة) |
| "كل DB ليها كاتب واحد" | **كذب** — predictions: 10+ writers, stocks: 15+ writers |
| "الـ exceptions متعامل معاها" | **كذب** — 98% مطموسة بصمت |

### الأولويات للإصلاح

1. **P0:** أوقف الـ monkey-patching في `daily_closer.py` + `market_scheduler.py`
2. **P0:** حدد الـ writer الأساسي لكل جدول + امنع الباقين
3. **P1:** شيل 28,000 سطر كود ميت (orphaned scripts + camp/ + glminvestment_engines/)
4. **P1:** وحد `_safe_float` + `parse_volume` في module واحد
5. **P2:** حول الـ 122 ملف لاستخدام DAL
6. **P2:** سجل الـ 4,655 exception بدل ما تطمسها
7. **P3:** شيل الـ 15+ implementation غير canonical لـ RSI/ATR/MACD/SMA
