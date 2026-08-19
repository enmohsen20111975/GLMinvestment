# 📊 SYSTEM STATE — دليل الاستثمار (invist.m2y.net)
## الحالة الحالية للنظام — آخر تحديث: RR-FIX (2026-08-17) — dynamic R:R unlocked + ATR clamp + R:R≥1.5 floor

> **الغرض من الملف:** هذا هو المرجع الوحيد الشامل لحالة النظام بعد سلسلة الإصلاحات
> P0-v7 → P0-v13 → RL-FIX-3 → Task 11 → Task 12 → Task 13 → **RR-FIX (2026-08-17)**. كل تعديل، كل مسار قاعدة بيانات، كل
> عتبة، كل runbook — كله هنا. لو عندك سؤال عن "إزاي النظام شغال دلوقتي"، الجواب
> في الملف ده.
>
> **Maintained by:** Z.ai Code (المدير + المبرمج بعد استقالة المدير البشري)
>
> **القاعدة الذهبية:** أي تغيير في المحرك لازم يُضاف هنا فوراً. الملف ده هو
> الـ single source of truth.

---

## 🆕 Task 13 — MASTER DIRECTIVE (المحاور 2, 4, 5, 6, 7, 8) (2026-08-16)

> **السياق:** المالك قال "كمل وأختبر داخلياً عندك لان كل حاجة موجودة عندك" — أي تنفيذ
> بقية محاور MASTER DIRECTIVE. المحور 3 (Geometry Guards) اتعمل في Task 12. هنا نُنفّذ
> المحاور الـ 6 المتبقية. كلها Python-side عدا المحور 2 (TS gut) + المحور 8 (TS route fix).

### المحاور الـ 6 المُنفّذة:

#### المحور 2 — حذف توليد التوقعات من TypeScript ✅
- **السبب الجذري:** `generateHistoricalPredictions()` + `deriveSignal()` في `src/lib/honest-tracking/maestro.ts`
  كانوا بيولّدوا توقعات في TypeScript — ده بـ ينكسر القاعدة "العقل فى البايثون فقط".
- **الحل:** استُبدلت الدالتين بـ stubs:
  - `deriveSignal()` → stub تعيد HOLD + رسالة "[AXIS-2] تم نقل توليد التوقعات إلى البايثون"
  - `generateHistoricalPredictions()` → stub تعيد GenerateResult فارغ + errors[] فيه توجيه
    لتشغيل Python backend (`python vps-service/jobs/v40_2_daily_generator.py`)
- **الـ admin route** (`generate-historical-predictions/route.ts`): بـ يكشف علم الإيقاف
  `_isAxis2Deprecated` ويعرض رسالة واضحة بالعربي.
- **الدوال الـ read-only** (verifyPendingPredictions, extractLessons, runLearningEngine,
  computeComprehensiveStats) تُركت — هي بقرأ من DB فقط (display role مسموح).
- **النتيجة:** maestro.ts من 2190 → 1746 سطر (حذف 444 سطر من منطق TS "العقل").

#### المحور 4 — Market Breadth Hard Veto ✅
- **السبب الجذري:** السوق الهابط ما كانش بـ يمنع توصيات الشراء → خسائر في سوق bearish.
- **الحل:** `_check_market_breadth_veto()` في `institutional_decision_engine.py`:
  - EGX30 bear regime (confidence > 0.7) → veto
  - benchmark_change < -1.0% (المؤشر نزل أكتر من 1%) → veto
  - breadth_pct < 40% (أقل من 40% من الأسهم صاعدة) → veto
- **الموضع:** بعد Sell/Reduce checks، قبل Buy block → يحجب الشراء بس (لا Sell — حماية المراكز).
- **عتبات قابلة للتحكم:** `market_breadth_veto_enabled`, `market_breadth_threshold_pct`,
  `market_bearish_benchmark_drop` في engine_settings.

#### المحور 5 — Explosive Rocket Hunter + Trailing Stop ✅
- **Rocket Hunter:** `detect_explosive_rocket()` في `core_scoring_engine.py`:
  - Volume Dry-up (median last 5 < 0.5× avg 20) — "العصر"
  - VCP Contraction (3+ شموع مداها بـ يضيق)
  - Ignition Candle (صاعدة + close قرب high + volume > 1.5× avg)
  - 3-of-3 → is_rocket=True, score_boost=25 | 2-of-3 → boost=8
- **ربطه في `CoreScoringEngine.analyze()`:** بعد weighted_score، بـ يزود الـ boost (capped 100).
- **Trailing Stop:** في `daily_closer.py`:
  - تفعيل عند **≥3% ربح** (أبكر من 1R) — بـ يعطي حماية أسرع
  - وقف متحرك = HighestHigh - **2.0×ATR** (أضيق من 2.5 القديم)
  - Floor عند entry (breakeven) — محفوظ من P0-v3
  - الـ partial_1r_trailing القديم محفوظ كـ fallback للـ non-rocket trades
- **عتبات:** `rocket_score_boost` (25), `rocket_trailing_atr_mult` (2.0).

#### المحور 6 — Kill Filters (wash/distribution/dead-money) ✅
- **3 فلاتر جديدة** في `evaluate_kill_filters()` بـ `liquidity_filter.py` (علاوة على الـ 5 الموجودين):
  1. **Wash Trading Guard:** volume spike > 3× avg بدون حركة سعر < 1% → تلاعب
  2. **Distribution Trap:** حجم الهبوط > 1.5× حجم الصعود + سعر نازل > 1% → تصريف مؤسسي
  3. **Dead Money Filter:** مدى 20 يوم < 6% → سهم راكد (رأس مال محبوس)
- **6 عتبات جديدة** في engine_settings (قابلة للتحكم).

#### المحور 7 — Morning Bell Elite 3 ✅
- **إعادة بناء `_get_morning_bell_data()`** في `stored_analysis_routes.py`:
  1. **Market Veto:** `_check_morning_bell_market_veto()` بـ يقرأ regime + benchmark من DB.
     لو vetoed → Cash Mode (قائمة فاضية + رسالة "🛡️ وضع الكاش — السوق هابط").
  2. **4-evidence minimum:** بـ parse `analysis_json` → `institutional.evidence.strong_count`.
     لو < 4 → السهم بـ يتخطى.
  3. **Composite Scoring:** `0.4*maestro + 0.3*RR + 0.2*volume_ratio + 0.1*liquidity`.
     sort DESC → top 3 only.
- **SQL:** `LIMIT 3×` + جلب `analysis_json`. الـ response بـ يضم `composite_score` +
  `evidence_count` لكل سهم + `market_vetoed: bool`.
- **محفوظ:** ATH breakout (P15) + delay compensation (P16).

#### المحور 8 — verify-pending route fix ✅
- **المشكلة:** SQL كان بـ يمرّ NULL close_price + egksco-first بـ يخنق (128 صف فقط).
- **الحل (3 طبقات):**
  1. **TV-PRIMARY source order:** yahoo_clean + tradingview_live + yahoo_safetynet كـ PRIMARY
     (1M+ صف)، ثم egksco، ثم migration، ثم stock_daily_prices.
  2. **NULL/zero filter في SQL:** كل استعلام بـ يضيف `close_price IS NOT NULL AND > 0`
     + high/low filters.
  3. **DataClean guard على مستوى الصف:** بـ يفلتر أي صف بـ close خارج [entry×0.2, entry×5.0]
     أو high < low. ده يطابق Python daily_closer DataClean guard.

### الملفات المُعدّلة (7):
| الملف | المحور | التغيير |
|------|--------|---------|
| `src/lib/honest-tracking/maestro.ts` | 2 | deriveSignal + generateHistoricalPredictions → stubs (-444 سطر) |
| `src/app/api/admin/generate-historical-predictions/route.ts` | 2 | كشف AXIS-2 + رسالة توجيه |
| `src/app/api/predictions/honest-tracking/verify-pending/route.ts` | 8 | TV-PRIMARY sources + NULL filter + DataClean guard |
| `vps-service/analyzers/institutional_decision_engine.py` | 4 | _check_market_breadth_veto() + ربطه قبل Buy block |
| `vps-service/analyzers/core_scoring_engine.py` | 5 | detect_explosive_rocket() + ربط score boost |
| `vps-service/jobs/daily_closer.py` | 5 | rocket trailing (3% + 2.0×ATR) |
| `vps-service/analyzers/liquidity_filter.py` | 6 | 3 kill filters جديدة (wash/distribution/dead-money) |
| `vps-service/api/stored_analysis_routes.py` | 7 | Morning Bell Elite 3 (veto + 4 evidence + composite) |

### معايير القبول (Acceptance Criteria من MASTER DIRECTIVE):
- 🎯 **PF ≥ 1.5** — بـ يتحقق بعد تشغيل 3-month backtest على الإنتاج (محتاج بيانات طازجة)
- 🎯 **Win rate ≥ 50%** — بـ يتحقق بعد تشغيل الـ generator على الإنتاج
- 🎯 **Positive P&L on 3-month backtest** — بـ يتحقق بعد الباكتست
- ✅ **0 كود توليد توقعات في TypeScript** (المحور 2)
- ✅ **Veto + Kill filters + Rocket + Trailing كلها Python-side**
- 🔴 **محتاج تشغيل على الإنتاج:** `git pull` + `pm2 restart python-backend data-engine nextjs`
  + تشغيل `daily_price_updater.py` (لبيانات طازجة) + `v40_2_daily_generator.py` (لتوقعات جديدة)
  + `daily_closer.py` (للتحقق من 0 إغلاقات كاذبة)

---

## 🆕 RR-FIX — Dynamic R:R Unlocked + ATR Clamp + R:R≥1.5 Floor (2026-08-17)

> **السياق:** قياس PERSONA-UNIFY-A على أرشيف قديم أظهر PF=0.254 (R:R مقلوب). على الأرشيف الحقيقي الجديد `active_databases_20260817_full.zip` (153 توقع، 148 مغلق) اتضح أن **كل الصفقات لها R:R = 1.5 بالظبط** — مش ديناميكي. السبب: bug عدم تطابق مفاتيح بين `institutional_decision_engine` و `v38_backtest_engine`.

### السبب الجذري (key-mismatch bug)
- `institutional_decision_engine.py` L1218-1246 يرجّع: `sl`, `tp1`, `tp2`, `rr_ratio_tp1`, `rr_ratio_tp2`
- `v38_backtest_engine.py` L1356-1360 (pre-fix) كان يقرأ: `stop_loss`, `target_1`, `target_2` (مفاتيح غير موجودة)
- → fallback دائم → `sl = entry - ATR*1.5`, `tp1 = entry + ATR*1.5*1.5` → **R:R ثابت 1.5** (148/148 صفقة في الأرشيف)
- الإصلاح: قراءة المفاتيح الصحيحة `sl`/`tp1`/`tp2` (backward-compat fallback للقرارات القديمة).

### الإصلاحات (3 تغييرات، بدون لمس DB)
1. **`vps-service/engines/v38_backtest_engine.py` L~1356-1396:**
   - قراءة `risk_profile.get('sl', risk_profile.get('stop_loss', ...))` (canonical + backward-compat)
   - ATR stop clamp `[3%, 9%]` via `get_setting('atr_stop_min_pct'/'atr_stop_max_pct')` — CONSTITUTION Rule 8
   - إعادة اشتقاق tp1/tp2 من stop المعدّل للحفاظ على R:R (`rr_ratio_tp1`/`rr_ratio_tp2`)
2. **`vps-service/jobs/v40_2_daily_generator.py` L~314-326:**
   - بوابة R:R ≥ `get_setting('dynamic_rr_normal', default=1.5)` — ترفض الصفقات دون العتبة قبل DB insert
3. **`institutional_decision_engine.py`:** بدون تغيير — المنطق الديناميكي (1.5/2.0 via `outperforming_market` + ATR-percentile stops) كان صحيحًا، كان يُتجاهل.

### الأرقام (إعادة محاكاة عادلة، 148 صفقة مغلقة، archive 20260817)
| Metric | BEFORE-RESIM (fair) | AFTER-A (dynamic 1.5/2.0) | Δ |
|---|---:|---:|---:|
| Win Rate | 43.24% | 43.24% | 0 |
| Profit Factor | 1.398 | **1.453** | +0.055 |
| Expectancy / trade | +1.35% | **+1.54%** | +0.189% |
| Total Return | 200.5% | **228.3%** | +27.8pp |
| Max Loss | -7.59% | -7.59% | 0 (Hard Loss Ceiling سليم) |
| ATR clamp fired | — | 0 trades | وقائي مش نشط |

- 95.27% من الصفقات تأخذ R:R=2.0 (outperforming-market path).
- النظام **رابح** على الأرشيف الحقيقي الحالي.
- القياس الكامل: `Documentation/SYSTEM_HOW_IT_THINKS.md` §5 (R:R logic — قصة الإصلاح الكاملة)

### Fundamentals (شُخّص، لم يُصلح تلقائيًا)
- `egx_fundamentals` = 0 صف — الـ fetcher موجود (`egx_fundamental_fetcher.py`) لكن **غير مجدول** في crontab.txt.
- `tab_*` = 858-866 صف، لكن `symbol` فيه أسماء عربية مش tickers → فجوة mapping.
- `fundamental_score = 50.0` placeholder لكل الـ 153 توقع.
- **الخطوة التالية:** جدولة الـ fetcher أسبوعيًا + إصلاح symbol→ticker map + backfill + إعادة قياس.

### أوامر مزامنة الإنتاج (READ-ONLY)
```bash
ssh root@<vps> && cd /root/GLMinvestment && git pull origin main
# (optional) /root/GLMinvestment/.venv/bin/python vps-service/jobs/v40_2_daily_generator.py --today-only
# (verify) sqlite3 db/predictions.db "SELECT ticker, ROUND((target_price-entry_price)/(entry_price-stop_loss),3) FROM predictions WHERE prediction_date=date('now') AND signal IN ('BUY','STRONG_BUY') LIMIT 5;"
```
- ❌ لا تحذف التوقعات الموجودة (forward-only).
- ❌ لا تُعد تشغيل maestro_backfill (يدمّر audit trail).
- ❌ لا تُفعّل fundamentals cron قبل إصلاح tab_*→ticker mapping.

---

## 🆕 Task 12 — CANONICAL-SYMBOLS + GEOMETRY-GUARD (2026-08-16)

> **السياق:** المالك اشتكى: "رموز الأسهم غلط 100% والأسم مش باين" + قدّم جدول TradingView
> المرجعي (289 سهم: رمز + اسم عربي + قطاع) كحل. كمان طلب إضافة قاعدة المسارات النسبية
> للدستور + متابعة محرك البيانات + تطبيق MASTER DIRECTIVE (المحاور الثمانية).

### الإصلاحات (3 محاور):

#### 1️⃣ كارثة الأسماء/الرموز — حُلّت ✅
- **السبب الجذري:** `honest-tracking/list/route.ts` السطر 413 كان `stock_name_ar: r.ticker`
  (يحط الرمز مكان الاسم!). والرموز نفسها كانت مشوّهة (ISIN codes + أسماء مدمجة + لاحقات).
- **الحل:** بنينا جدول مرجعي موحّد (289 سهم من TradingView) في ملفين:
  - Python: `vps-service/data/egx_stocks_complete.py` → `EGX_CANONICAL_TV` (278) + `EGX_ISIN_NAMES` (11) + `normalize_symbol()`
  - TypeScript: `src/lib/stock-names.ts` → `EGX_CANONICAL_TV` + `EGX_ISIN_NAMES` + `normalizeEgxSymbol()`
- **الدالة `normalizeEgxSymbol(raw)` تحل 4 أنواع:**
  1. ISIN code (`EGS30AJ1C016-EGP`) → يحل الاسم العربي
  2. اسم مدمج (`ACFRAlexandria...D`) → يستخرج الرمز (`ACFR`)
  3. لاحقة (`COMI.CA`, `COMI-EGP`) → يشيلها (`COMI`)
  4. رمز نظيف → يرجّعه + يجيب الاسم
- **الربط:** المسار `list/route.ts` بـ يستدعي `normalizeEgxSymbol(r.ticker)` →
  `stock_symbol` (رمز نظيف) + `stock_name_ar` (اسم عربي) + `sector` (fallback).
- **تم التحقق حيّ:** 5 توقعات رجعت بأسماء عربية صحيحة (ايبيكو/كريدي أجريكول/فوديكو/مدينة نصر للاسكان).

#### 2️⃣ القاعدة 17 — RELATIVE-PATHS-ONLY ✅
- أُضيفت لـ `Documentation/00-CONSTITUTION.md`: كل المسارات في الكود نسبية.
- **السبب:** المشروع يعمل على 3 بيئات (إنتاج `/root/GLMinvestment/` + محلى `/home/meme/...` + ساندبوكس `/home/z/...`).
- المسار المطلق = كود ينكسر في بيئتين. ده سبب كارثة cron السابقة.

#### 3️⃣ MASTER DIRECTIVE المحور 3 — Geometry Guard ✅
- **السبب الجذري لـ win rate 35.4%:** صفقات BUY كان الـ target تحتيهم → ما بـ توصلش للربح أبدًا.
- **الحل:** `enforce_geometry_guard()` في `prediction_tracker.py`:
  - للـ BUY/STRONG_BUY: لو `target <= entry*1.02` → auto-fix لـ `entry*1.05`
  - لو `stop >= entry*0.98` → auto-fix لـ `entry*0.95`
  - `assert target > entry` + `assert stop < entry` كضمان أخير
- **مُفعّل في `record_prediction()`:** قبل الـ W-validation (آخر خط قبل INSERT).
- **استراتيجية AUTO-FIX (مش REJECT):** عشان المحرك يفضل يطلع توصيات بدل ما يرفض كل حاجة.
- **تم التحقق:** 10 اختبارات كلها نجحت (BUY معكوس → fix، HOLD/SELL → يتجاهل، entry=0 → يتجاهل).

### مراقبة محرك البيانات 🔍
- **الساندبوكس:** به `predictions.db` فقط (651 توقع، أحدثها 2026-08-09 — متوقف 7 أيام).
  لا يوجد `price_history.db` / `stocks.db` / `intraday.db` في الساندبوكس (DBs الإنتاج فقط).
- **توزيع الحالة:** 400 LOSS / 219 WIN / 24 EXPIRED / 8 PENDING → win rate = 35.4% (مطابق مستوى الأزمة).
- **التوصية:** محرك البيانات (الـ generator) محتاج تشغيل على الإنتاج — الساندبوكس ما عندهوش بيانات أسعار.
- **تدفق البيانات (مرجع):**
  1. Scrapers (`egx_fetcher`, `daily_price_updater`) → `price_history.db` (candles)
  2. `intraday_aggregator` → `price_history.db`
  3. `load_price_history()` في `data/prices.py` = القارئ الأوحد
  4. Analyzers (`master_analyzer`, `maestro_orchestrator`) → `predictions.db.stored_analyses`
  5. `PredictionTracker.record_prediction()` → `predictions.db.predictions` (الآن مع geometry guard)
  6. `daily_closer.py` → يحدّث outcome/return → `learned_lessons`

### الملفات المُعدّلة (5):
| الملف | التغيير |
|------|---------|
| `Documentation/00-CONSTITUTION.md` | القاعدة 17 (RELATIVE-PATHS-ONLY) |
| `vps-service/data/egx_stocks_complete.py` | EGX_CANONICAL_TV (278) + EGX_ISIN_NAMES (11) + normalize_symbol() |
| `src/lib/stock-names.ts` | EGX_CANONICAL_TV + EGX_ISIN_NAMES + normalizeEgxSymbol() |
| `src/app/api/predictions/honest-tracking/list/route.ts` | ربط normalizeEgxSymbol لـ stock_symbol + stock_name_ar + sector |
| `vps-service/analyzers/prediction_tracker.py` | enforce_geometry_guard() + ربطه في record_prediction |

### الأوامر المطلوبة على الإنتاج (VPS):
```bash
cd /root/GLMinvestment && git pull origin main
pm2 restart python-backend data-engine nextjs
# تحقق من الـ geometry guard في الـ logs:
grep "GEOMETRY-GUARD\|GEOMETRY-REJECT" logs/python-backend.log | tail -20
# تحقق من الأسماء في الـ API:
curl -s "http://localhost:3000/api/predictions/honest-tracking/list?limit=5&qualityMode=all" | python3 -m json.tool | grep -E "stock_symbol|stock_name_ar"
```

---

## Task 11 — TV-PRIMARY Data Pipeline (2026-08-16) — commit 1cd6a67

> **السياق:** المالك طلب "خلى المصدر الرئيسى هو TradingView وبعد كدة لو فشل أستعمل EGXPilot"
> + استخدام EGXPilot كمرجع لأسماء/رموز الأسهم (لأن كل مصدر بـ يكتب الأسماء بشكل مختلف).

### التغييرات (4 ملفات):

| الملف | التغيير | الهدف |
|------|---------|------|
| `data/egx_fetcher.py` | TradingView PRIMARY، EGXPilot reference+fallback | بيانات TV الغنية (RSI/SMA) + أسماء EGXPilot الموثوقة |
| `scripts/daily_price_updater.py` | source='tradingview_live' + Pollution Guard | منع تلوث price_history.db بـ placeholder prices |
| `jobs/daily_closer.py` | geometric is_buy في 3 مسارات جديدة (dynamic/explosive/partial) | HOLD bug fix شامل (الإنتاج كان فيه 2، صاروا 5) |
| `data/gap_filler.py` | lazy yfinance import | graceful degradation لما yfinance مش متاح |

### استراتيجية Per-Ticker Fallback (الجديدة):
1. اجلب EGXPilot دائمًا (reference للأسماء/الرموز/sector/eps)
2. لكل ticker: جرّب TradingView أولًا (أسعار + مؤشرات فنية)
3. لو TV فشل لـ ticker → استخدم EGXPilot للسعر
4. ادمج: سعر TV + اسم EGXPilot

### Pollution Guard (الجديد في daily_price_updater):
- close <= 0 → skip
- high > close×5 → skip (ticker pollution / split)
- low < close×0.2 → skip (placeholder price مثلًا low=15.0 لـ GETO entry=297)
- high < low → skip (invalid OHLC)
- بـ log `pollution_skipped=N` للمراقبة

### HOLD Bug Fix — التغطية الكاملة (5 مسارات):
الإنتاج (commit 2ac7cae) كان فيه 2:
1. ✅ live-price fallback path (line ~1639)
2. ✅ mean-reversion path (line ~1849)

Task 11 ضافت 3 جدد:
3. ✅ dynamic exit gate (line ~1795)
4. ✅ explosive trend-follow gate (line ~1818)
5. ✅ partial 1R gate (line ~1839)

المنطق: `is_buy = target_price > entry_price` (geometric، مش signal name)
ده بـ يـ يعالج HOLD/STRONG_BUY/BUY بنفس الطريقة لو ليهم نفس هندسة target.

---

---

## 📑 المحتويات

1. [الحالة الحالية (Snapshot)](#1-الحالة-الحالية-snapshot)
2. [سجل الإصلاحات P0-v7 → P0-v13](#2-سجل-الإصلاحات-p0-v7--p0-v13)
3. [مسارات قواعد البيانات (Database Paths)](#3-مسارات-قواعد-البيانات-database-paths)
4. [معمارية المحرك (Engine Architecture)](#4-معمارية-المحرك-engine-architecture)
5. [نظام الـ 3 شخصيات (3-Persona System)](#5-نظام-الـ-3-شخصيات-3-persona-system)
6. [العتبات الحالية (Current Thresholds)](#6-العتبات-الحالية-current-thresholds)
7. [الـ Runbooks](#7-الـ-runbooks)
8. [الـ Golden Rules (1-46)](#8-الـ-golden-rules-1-46)
9. [النقاط المفتوحة / الخطوات القادمة](#9-النقاط-المفتوحة--الخطوات-القادمة)

---

## 1. الحالة الحالية (Snapshot)

| المؤشر | القيمة | ملاحظات |
|--------|--------|---------|
| **آخر إصدار** | RL-FIX-3 | intraday aggregator: the missing pipeline (intraday → daily bars) |
| **تاريخ آخر تحديث** | 2026-08-09 | |
| **عدد الأسهم الممسوحة** | 536 (production) / 551 (real VPS) | EGX |
| **الـ 3 شخصيات** | ✅ شغالة في الإنتاج | gambler + balanced + conservative |
| **Explosive Hunter** | ✅ شغّال (171 سهم انفجاري) | bad-data exclusion مفعّل |
| **Freshness Badge** | ✅ على الـ dashboard | auto-refresh كل 60 ثانية |
| **Manual Engine Trigger** | ✅ `run_full_analysis.py` | 3 personas × كل الأسهم |
| **Cron (إغلاق يومي)** | ✅ 14:35 Cairo (12:35 UTC) | daily_closer.py |
| **Win Rate (backtest)** | 47.4% | على 1,362 صفقة حقيقية |
| **Profit Factor (backtest)** | 1.29 | |
| **Explosive WR (backtest)** | 62.5% | 96 صفقة انفجارية |

### التغطية الحالية للأسهم الانفجارية (على الداتا الحقيقية)

| Persona | قبل P0-v13 | بعد P0-v13 | التحسن |
|---------|:----------:|:----------:|:------:|
| المضارب (gambler) | 171 | 171 | — (كان شغال) |
| المتوازن (balanced) | 29 | **92** | **+217%** |
| المحافظ (conservative) | **0** | **44** | **من صفر!** |

> **الخلاصة:** قبل P0-v13، المحافظ كان بـ يلتقط **صفر** سهم انفجاري. ده اللي
> كان بـ يـخلي المالك يحس "الفرص ماطلعتش" — الفرص كانت بتطلع للمضارب بس.

---

## 2. سجل الإصلاحات P0-v7 → RL-FIX-3

### RL-FIX-3 — Intraday aggregator: the missing pipeline (2026-08-09)
- **السياق:** المالك لاحظ إن price_history متجمد رغم إن محرك البيانات شغال. التشخيص: intraday.db فيها 167k rows لـ 978 tickers لليوم، بس price_history متجمد من 2026-06-10.
- **السبب الجذري:** محرك البيانات بـ جمع intraday بس مفيش حاجة بـ يـ aggregate لـ daily. الـ PriceUpdater القديم كان بـ يعتمد على EODHD (API key متلغي) أو EGXPilot (بـ يكتب اليوم الحالي بس).
- **الإصلاح:** `vps-service/jobs/intraday_aggregator.py` (NEW) — بـ يـ read من intraday.db، بـ group بـ (ticker, date)، بـ aggregate OHLCV، بـ write لـ price_history بـ source='intraday_aggregated'. بـ backfill كل الأيام الناقصة.
- **الـ scheduler:** `run_intraday_aggregator` بـ يشتغل كل 30 دقيقة في market hours + post-market.
- **النتائج:** 978 tickers / 8,991 rows / MAX(date) 2026-06-10 → 2026-08-09.
- **التفاصيل الكاملة:** شوف `CHANGELOG.md` entry [RL-FIX-3].

### RL-FIX-2 — Root cause fix for -63% avg loss + scheduler safetynet reliability (2026-08-09)
- **السياق:** بعد RL-FIX-1، المحلي لسه بـ show avg loss -63.19%. الـ "Big losses" analysis كشف إن 5 صفقات بـ exit عند `end_of_data` بـ -88% لـ -99.78% مع T1/T2/T3 كلها False.
- **Bug B root cause (3 مشاكل متشابكة):**
  1. **Split detection بـ zero out `low`** لما السعر ينزل تحت 20% من entry → الـ trailing stop check بـ fail → -90%+ losses. الإصلاح: compare لـ prev_close + skip bar كامل.
  2. **مفيش hard max-loss cap** → الإصلاح: `HARD_MAX_LOSS_PCT = 15.0` (exit فوري عند -15%).
  3. **Stop losses واسعة جداً** (80% من entry) → T1 unreachable. الإصلاح: `STOP_LOSS_SANITY_CAP_PCT = 30.0`.
- **Bug A scheduler reliability:** retry interval 6h→1h + force-run on stale (>2 days) + safetynet في market hours كمان.
- **التحقق:** simulation test (entry=100, stop=20, crash to 10) → BEFORE: end_of_data -90%+ / AFTER: hard_stop_loss -15.0% ✅
- **الأثر المتوقع:** avg loss -63.19% → ~-10% لـ -15%.
- **التفاصيل الكاملة:** شوف `CHANGELOG.md` entry [RL-FIX-2].

### RL-FIX-1 — Multi-target backtest bugs + price_history freeze diagnosis (2026-08-09)
- **السياق:** المالك شغّل `verify_learning_improvement.py` بعد deploy الـ RL system. الإنتاج رجع 0 صفقة (2250 skip)، المحلي رجع avg loss -62.85% و VERDICT متناقض.
- **Bug B (CRITICAL):** trailing stop في `multi_target_exit.py` كان متعطّل بعد T1 بسبب guard `current_stop < entry_price` → الـ 50% الباقية بتـ lose وقف الخسارة → avg loss -62.85%. الإصلاح: شلت الـ guard.
- **Bug C:** VERDICT logic متناقض بين printed (`or`) و exit code (`avg_return` فقط). الإصلاح: وحّدته على avg_return.
- **Bug A (3 طبقات):** backtest skip-reason breakdown (4 counters + stale detection) + safetynet fail-loud (yfinance check) + scheduler error propagation (مش mark "تمت" لو error).
- **سكريبت جديد:** `scripts/diagnose_safetynet.py` لتشخيص جمود price_history.
- **⚠️ مهم:** على الإنتاج yfinance متثبّت (v1.5.2) بس price_history لسه stale → السبب الحقيقي محتاج `diagnose_safetynet.py`. المرجّح: Yahoo غيّر coverage لـ EGX أو suffix `.CA` غلط.
- **التفاصيل الكاملة:** شوف `CHANGELOG.md` entry [RL-FIX-1].

### P0-v13-OPPORTUNITY — خفض عتبات المتوازن والمحافظ + استبعاد البيانات الفاسدة
- **المشكلة:** `optimizer_params.json` كان بـ يتقرأ من 3 مسارات مختلفة → min_target_pct ما كانش بـ يتطبق.
- **الإصلاح:** توحيد المسار + conditional application.
- **Commit:** `a9c2e2d4`

### P0-v8-REAL-DATA — إصلاح DB mismatch
- **المشكلة:** الباك-تست كان بـ يقرأ من sandbox DB (6 أسهم بس) بدل real VPS DB.
- **الإصلاح:** 5-layer data fallback (VPS DB → JSON export → CSV → stocks.db → egksco_price_history).
- **النتيجة:** من 0 صفقات إلى 1,503 صفقات على داتا حقيقية.
- **Commit:** `aa091a82`

### P0-v9-VPS-REAL — استخراج قواعد بيانات المالك
- **المشكلة:** المالك رفع قواعد بيانات حقيقية بصيغة .zip (37.89MB، 17 DB) لكن git كان بـ يرفض .db files.
- **الإصلاح:** فك الضغط إلى `db/vps_real/` + توحيد الأسماء العربية للقطاعات (`_AR_SECTOR_MAP`).
- **النتيجة:** 762 ticker × 369 يوم = 274,574 صف سعر. PF=1.23، +894% return.
- **Commit:** `617f049d`

### P0-v11-EXPLOSIVE — التقاط الأسهم الانفجارية
- **المشكلة:** الـ engine كان بـ cap الربح عند +10% → الأسهم اللي بتعمل +1000% كنا بنخسرها.
- **الإصلاحات (3 fixes):**
  1. **explosive_uncap path:** momentum + vol_pct>80 → target=5×ATR (no cap) + stop=15% (wide) + trailing 30% of profit.
  2. **stop adaptive_atr bleed:** min_target_pct للـ non-momentum: 3% (was 10%) → reachable في 30 يوم.
  3. **gambler = المعلم اللي ما بيخافش:** thresholds متخفّضة (55→45 strong_buy، 35→28 buy).
- **النتيجة:** 1,362 صفقة، WR=47.4%، PF=1.29، explosive_uncap WR=62.5%.
- **Commit:** `8547807e`

### P0-v12-PROD-PORT — نقل التحسينات للإنتاج
- **المشكلة:** تحسينات P0-v11 كانت مطبّقة على الباك-تست بس، مش على الـ engine الإنتاجي. الأرقام على الـ dashboard كانت ثابتة.
- **الإصلاحات (5 fixes):**
  1. port gambler thresholds للـ production (`maestro_orchestrator.py`).
  2. conditional min_target_pct + explosive_uncap في الـ production.
  3. `optimizer_params.json`: حقول جديدة (min_target_pct_non_momentum, max_stop_pct_explosive, ...).
  4. NEW `explosive_opportunity_hunter.py` — صيّاد فرص استباقي.
  5. Freshness badge على الـ dashboard + auto-refresh 60s.
- **Commit:** `3885304b`

### P0-v13-OPPORTUNITY — خفض عتبات المتوازن والمحافظ (الحالي)
- **المشكلة:** المضارب اتعمل له port في P0-v12، بس المتوازن (buy=55) والمحافظ (buy=62) لسه بالعتبات القديمة → بـ يـ missوا 84-99% من الفرص. المحافظ كان بـ يلتقط **صفر** سهم انفجاري! + `run_full_analysis.py` مكنش موجود + bad-data pollution (FACIL +35362%).
- **الإصلاحات (4 fixes):**
  1. **lower balanced/conservative thresholds:** balanced buy 55→42، conservative buy 62→50.
  2. **bad-data/split exclusion:** momentum >200% = excluded (FACIL/GFC/KUWAITRE garbage اختفوا).
  3. **NEW `run_full_analysis.py`:** manual engine trigger — 3 personas × كل الأسهم.
  4. **3-persona comparison** في الـ hunter (مش gambler بس).
- **النتيجة على الإنتاج:** متوازن 8→66 (+725%)، محافظ 1→35 (+3400%).
- **Commit:** `b16d9727`

---

## 3. مسارات قواعد البيانات (Database Paths)

> **مهم جداً:** الـ VPS عنده قواعد بيانات حقيقية في `/root/GLMinvestment/db/`.
> الـ sandbox عنده نسخة منها في `db/vps_real/` (مستخرجة من `active_databases_max_compat.zip`).
> السكربتات بتـ prefer الـ VPS real data لو موجود، fallback للـ production.

### 3.1 القواعد الرئيسية (Production — على VPS)

| DB | المسار (VPS) | المحتوى |
|-----|-------------|---------|
| `price_history.db` | `/root/GLMinvestment/db/price_history.db` | 274,574 صف سعر × 762 ticker × 369 يوم |
| `stocks.db` | `/root/GLMinvestment/db/stocks.db` | 1,048 ticker + معلومات القطاعات + `real_evaluated_predictions` (4,035 صف) |
| `predictions.db` | `/root/GLMinvestment/db/predictions.db` | التوقعات النشطة + المغلقة + `actual_return` |

### 3.2 القواعد في الـ Sandbox (للتطوير/الباك-تست)

```
db/vps_real/                      ← مستخرجة من active_databases_max_compat.zip (GITIGNORED)
├── price_history.db              ← 58MB — 274,574 صف
├── stocks.db                     ← 11MB — 1,048 ticker
├── predictions.db                ← التوقعات
├── ... (14 DB أخرى)
```

> **ملاحظة:** `db/vps_real/` موجود في `.gitignore` — ما بـ يتـ push للـ GitHub.
> لو محتاج تعيد استخراجها: `unzip db/active_databases_max_compat.zip -d db/vps_real/`

### 3.3 الـ 5-layer Data Fallback (في الباك-تست)

السكربت `scripts/comprehensive_persona_backtest_90d.py` بـ يـ try المسارات دي بالترتيب:

```python
# Layer 1: VPS real data (sandbox)
db/vps_real/price_history.db

# Layer 2: JSON export (gitignored)
db/vps_real/price_history_export.json

# Layer 3: CSV fallback
db/egksco_stocks.csv

# Layer 4: Production stocks.db
db/stocks.db

# Layer 5: Legacy
db/egksco_price_history
```

### 3.4 استخراج البيانات من VPS → Sandbox

لو محتاج تحدّث نسخة الـ sandbox من VPS:

```bash
# على VPS — اتصدّر JSON (gitignored، آمن للـ GitHub)
cd /root/GLMinvestment
python3 scripts/export_vps_data_to_json.py

# لو محتاج الـ DBs الكاملة (zip):
cd /root/GLMinvestment/db
zip -r ../active_databases_max_compat.zip *.db
# ثم ارفع الـ zip للـ GitHub أو انقله يدوياً
```

### 3.5 قواعد بيانات إضافية

| DB | المسار | الوظيفة |
|-----|--------|---------|
| `persona_predictions` | داخل `predictions.db` | توقعات الـ 3 شخصيات (auxiliary) |
| `stored_analyses` | داخل `stocks.db` | تحليلات Maestro المخزنة |
| `aiPrediction` | داخل `prisma/db/predictions.db` | توقعات مشتقة (Next.js side) |

---

## 4. معمارية المحرك (Engine Architecture)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        invist.m2y.net (Caddy Gateway)                │
│                      (port 443 → 3000 Next.js)                       │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
           ┌───────────────┴───────────────┐
           ▼                               ▼
┌─────────────────────┐         ┌─────────────────────┐
│  Next.js (3000)     │         │  Python Backend     │
│  - Display only     │◄────────┤  (lightweight_server│
│  - shadcn/ui        │  HTTP   │   .py :8010)        │
│  - Freshness badge  │         │  - Flask API        │
│  - 3-persona tabs   │         │  - Maestro engine   │
└─────────────────────┘         └──────────┬──────────┘
                                           │
                            ┌──────────────┴──────────────┐
                            ▼                             ▼
                 ┌─────────────────────┐     ┌─────────────────────┐
                 │  MaestroOrchestrator│     │  Data-Engine (:5000)│
                 │  (maestro_orchestra │     │  - TradingView/Yahoo│
                 │   tor.py)           │     │  - Crypto/News      │
                 │  - 8-layer score    │     └─────────────────────┘
                 │  - 3 personas       │
                 │  - explosive_uncap  │
                 │  - DNA-driven       │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │  SQLite DBs         │
                 │  - predictions.db   │
                 │  - price_history.db │
                 │  - stocks.db        │
                 └─────────────────────┘
```

### نقاط الدخول (Entry Points)

| المكون | المسار | متى يشتغل |
|--------|--------|-----------|
| **Cron (إغلاق يومي)** | `vps-service/jobs/daily_closer.py` | 14:35 Cairo (12:35 UTC) Sun–Thu |
| **Cron (learning)** | `vps-service/jobs/learning_engine.py` | 14:40 Cairo الجمعة |
| **Cron (backup)** | `vps-service/scripts/daily_backup.py` | 03:00 UTC يومياً |
| **Manual trigger** | `vps-service/scripts/run_full_analysis.py` | يدوياً (NEW في P0-v13) |
| **HTTP trigger** | `POST /api/admin/trigger-analysis` | من الـ dashboard |
| **Explosive hunter** | `vps-service/scripts/explosive_opportunity_hunter.py` | يدوياً |

### الـ Maestro Engine (`maestro_orchestrator.py`)

الـ engine بيـعمل 8 طبقات تحليل لكل سهم:
1. **Macro regime** (bull/bear/range)
2. **SMA-50** (trend direction)
3. **RSI** (overbought/oversold)
4. **Volume** (accumulation/distribution)
5. **Bollinger Bands** (volatility)
6. **MACD** (momentum)
7. **Candle pattern** (reversal/continuation)
8. **Fibonacci** (support/resistance)

الـ score النهائي (0-100) بـ يتـ compare مع عتبات الـ persona → recommendation (strong_buy/buy/hold/sell).

---

## 5. نظام الـ 3 شخصيات (3-Persona System)

> **الـ insight الجوهري (P0-v13):** قبل كده، الإنتاج كان بـ يـ generate **balanced predictions بس**
> (default persona). الـ 3 شخصيات ما كانوش بـ يتـ writeوا لـ `predictions` table.
> دلوقتي `run_full_analysis.py` بـ يـ write 3 صفوف لكل ticker.

### الشخصيات

| Persona | الاسم العربي | الشخصية | عتبة buy (bull) |
|---------|-------------|---------|:----------------:|
| `gambler` | المضارب | المعلم اللي ما بيخافش — بـ يلتقط الأسهم الانفجارية بدري | 28 |
| `balanced` | المتوازن | وسطي — بـ يـ catch الفرص الجودة + يفلتر الـ noise | 42 |
| `conservative` | المحافظ | حذر — بـ يـ catch النص الأقوى + يحمي رأس المال | 50 |

### الـ Hierarchy

```
gambler (28) < balanced (42) < conservative (50)
     ↓             ↓                ↓
  early         medium           late but safer
```

كل persona بـ يـ catch الفرص، بس بـ timings مختلفة:
- **gambler:** بـ يدخل أول (buy=28) → أعلى مخاطرة، أعلى reward
- **balanced:** بـ يدخل وسط (buy=42) → توازن
- **conservative:** بـ يدخل آخر (buy=50) → أقل مخاطرة، أقل reward بس أأمن

### الـ explosive_uncap Path

لو السهم **متحرك (momentum)** + **تقلبه عالية (vol_pct > 80)**:

| المتغير | القيمة | السبب |
|---------|--------|-------|
| target | 5×ATR (no cap) | الأسهم الانفجارية بتعمل +50%/+1000% |
| stop | 15% (was 7%) | بتنزل -20% قبل ما تطير |
| forward window | 90 يوم (was 30) | capture الـ run كامل |
| trailing stop | 30% of profit | let it run أكتر |
| exit | trailing stop بس | مفيش target cap |

---

## 6. العتبات الحالية (Current Thresholds)

### `vps-service/config/optimizer_params.json`

```json
{
  "min_conviction": 65,
  "min_rr_ratio": 1.5,
  "max_stop_pct": 7.0,
  "min_target_pct": 10.0,
  "min_target_pct_non_momentum": 3.0,
  "max_stop_pct_explosive": 15.0,
  "explosive_vol_pct_threshold": 80.0,
  "explosive_target_atr_mult": 5.0,
  "skip_bear_regime": true,
  "skip_bull_regime": false,
  "use_adx_filter": true,
  "adx_threshold": 20.0,
  "use_volume_spike": true,
  "volume_spike_mult": 1.5,
  "max_holding_days": 20,
  "min_technical_confluence": 2
}
```

### Persona Thresholds (في `maestro_orchestrator.py` lines 1126-1154)

الترتيب: `(strong_buy, buy, hold, sell)`

| Persona | Regime | strong_buy | buy | hold | sell |
|---------|--------|:----------:|:---:|:----:|:----:|
| **gambler** | bull | 45 | **28** | 18 | 12 |
| gambler | bear | 50 | 32 | 22 | 15 |
| gambler | range | 42 | 25 | 16 | 10 |
| **balanced** | bull | 55 | **42** | 30 | 20 |
| balanced | bear | 58 | 45 | 32 | 22 |
| balanced | range | 52 | 40 | 28 | 18 |
| **conservative** | bull | 62 | **50** | 38 | 28 |
| conservative | bear | 68 | 55 | 42 | 32 |
| conservative | range | 58 | 48 | 36 | 26 |

### Bad-Data Exclusion (في `explosive_opportunity_hunter.py`)

```python
# أي سهم بـ يتحرك أكتر من +200% في 5 أيام أو +400% في 20 يوم = BAD_DATA
# (stock split أو data error، مش surge حقيقي)
is_bad_data = (abs(momentum_5d) > 200) or (abs(momentum_20d) > 400)
# → exclude من قائمة الانفجارية + score=20 (ما يطلعش BUY)
```

---

## 7. الـ Runbooks

### 7.1 تشغيل المحرك يدوياً (Manual Engine Run)

```bash
cd /root/GLMinvestment
git pull origin main

# شغّل الـ engine لكل الأسهم × 3 شخصيات
python3 vps-service/scripts/run_full_analysis.py --market EGX --limit 120

# لو محتاج شخصيات معينة بس:
python3 vps-service/scripts/run_full_analysis.py --personas gambler,balanced --limit 50

# لو محتاج أسهم معينة:
python3 vps-service/scripts/run_full_analysis.py --tickers COMI,SWDY,CICH
```

**الـ output المتوقع:**
```
📊 FINAL SUMMARY
   Stocks analyzed (per persona): 120
   Personas run:                  3
   Total predictions written:     ~339
   - gambler     : analyzed=113  buy=52
   - balanced    : analyzed=113  buy=45
   - conservative: analyzed=113  buy=37
✅ Done. Refresh the dashboard.
```

### 7.2 صيد الأسهم الانفجارية

```bash
cd /root/GLMinvestment
python3 vps-service/scripts/explosive_opportunity_hunter.py --top 20
```

**الـ output:** جدول بـ top-20 سهم انفجاري + تغطية كل persona + مقارنة قبل/بعد.

### 7.3 الباك-تست الشامل (90 يوم)

```bash
cd /root/GLMinvestment
python3 scripts/comprehensive_persona_backtest_90d.py --days 90 --market EGX
```

**الـ output:** `db/backtest_results/persona_90d_report.json` — WR/PF/avg PnL لكل persona.

### 7.4 تشغيل الـ Cron Jobs

```bash
cd /root/GLMinvestment
# تثبيت الـ cron (لو مش مثبت)
bash vps-service/scripts/setup_cron.sh

# فحص الـ cron
bash vps-service/scripts/check_cron.sh

# الـ cron entries:
#   14:35 Cairo (12:35 UTC) Sun-Thu → daily_closer.py
#   14:40 Cairo (12:40 UTC) Fri     → learning_engine.py
#   03:00 UTC daily                  → daily_backup.py
#   كل ساعة                          → data_heartbeat_checker.py
```

### 7.5 استخراج البيانات من VPS → Sandbox

```bash
# على VPS — تصدير JSON (آمن للـ GitHub):
cd /root/GLMinvestment
python3 scripts/export_vps_data_to_json.py

# على sandbox — استخراج الـ zip:
cd /home/z/my-project
unzip db/active_databases_max_compat.zip -d db/vps_real/
```

### 7.6 إعادة تشغيل الـ Backend

```bash
# على VPS
cd /root/GLMinvestment
# لو الـ backend شغال بـ systemd:
sudo systemctl restart glm-backend
# لو شغال بـ nohup:
pkill -f lightweight_server.py
nohup python3 vps-service/lightweight_server.py > logs/backend.log 2>&1 &
```

### 7.7 فحص الـ Dashboard Freshness

افتح `https://invist.m2y.net/#recommendations` واتأكد من:
1. ✅ Freshness badge بـ show وقت جديد (آخر تحديث: HH:MM)
2. ✅ أرقام التوقعات اتـغيرت (مفيش stagnation)
3. ✅ الـ 3 personas كلهم ظاهرين (gambler + balanced + conservative)
4. ✅ عدد الـ BUY signals زاد

لو الـ badge بـ show "stale" → الـ cron ما شغالش. شغّل `run_full_analysis.py` يدوياً.

---

## 8. الـ Golden Rules (1-46)

> قواعد متراكمة من كل الـ fixes. أي تغيير جديد لازم يحترمها.

### Data Integrity (1-10)
1. **VPS Real Data First** — أي باك-تست لازم يـ prefer `db/vps_real/` على sandbox.
2. **Arabic Sector Normalization** — `_AR_SECTOR_MAP` يحوّل القطاعات العربية لـ English.
3. **5-layer Fallback** — لو DB ضاع، fallback للـ JSON → CSV → stocks.db → legacy.
4. **Gitignore DBs** — `.db` files ما بـ تتـ push. استخدم `.zip` أو `.json`.
5. **Reproducible Backtest** — stable hash = نفس الأرقام في كل run.

### Engine Logic (11-25)
11. **Uncap Targets for Momentum** — الأسهم الانفجارية لازم target مفتوح (5×ATR).
12. **Wide Stops for Volatility** — الأسهم الانفجارية stop=15% (تنزل -20% قبل +1000%).
13. **Trailing Not Target** — exit بـ trailing stop، مش target cap (let winners run).
14. **Conditional min_target** — momentum=10% (طموح)، non-momentum=3% (مرن).
15. **Skip Dead Stocks** — ما تـ tradeش سهم `dna_type='dead'`.
16. **DNA-Driven Thresholds** — السهم المتفجر بـ ياخد discount على العتبة.
17. **Sector Veto** — القطاع الميت بـ يـ downgrade strong_buy → buy.
18. **Stock Alive Enforce** — السهم الميت بـ يـ downgrade gambler → balanced.

### Persona System (26-35)
26. **3-Persona Hierarchy** — gambler(28) < balanced(42) < conservative(50).
27. **All Personas Must Catch** — لو persona بـ يـ catch 0% من الفرص، عتبتها غلط.
28. **Gambler = المعلم اللي ما بيخافش** — thresholds متخفّضة جداً.
29. **Conservative Protects Capital** — بـ يدخل آخر بس أأمن.
30. **3-Persona Production Write** — الـ engine لازم بـ يـ write 3 rows per ticker.
31. **Explosive WR > 60%** — الـ explosive_uncap path لازم WR > 60%.
32. **Bad-Data Exclusion** — momentum >200% = split، exclude مش score.
33. **Coverage Comparison** — الـ hunter لازم بـ يـ compare قبل/بعد لكل personas.

### Operations (36-46)
36. **Explosive Stocks Need Wide Stops** — -15% not -7%.
37. **Trailing Stop Not Target Cap** — let winners run.
38. **Skip Dead Stocks** — لا تـ trade سهم ميت.
39. **Gambler = المعلم اللي ما بيخافش** — thresholds متخفّضة.
40. **Backtest-Production Parity** — أي تحسين في الباك-تست لازم يـ port فوراً.
41. **Proactive Opportunity Hunting** — scan السوق قبل ما الفرص تطير.
42. **Dashboard Freshness Transparency** — الـ dashboard لازم بـ show آخر تحديث.
43. **All Personas Must Catch Opportunities** — لو 0% coverage، الـ threshold غلط.
44. **Bad-Data Exclusion** — momentum >200% = split، exclude.
45. **Manual Engine Trigger** — لازم script يدوي للـ engine.
46. **3-Persona Production Write** — 3 rows per ticker، مش balanced بس.

---

## 9. النقاط المفتوحة / الخطوات القادمة

### ✅ مت解决的问题
- [x] 0-trade problem → 1,503 trades (P0-v8/v9)
- [x] adaptive_atr bleed → contained (P0-v11)
- [x] Explosive stocks missed → explosive_uncap WR=62.5% (P0-v11)
- [x] Backtest-production gap → ported (P0-v12)
- [x] Stale dashboard → freshness badge (P0-v12)
- [x] Conservative catching 0% → 44 stocks (P0-v13)
- [x] Bad-data pollution → excluded (P0-v13)
- [x] No manual trigger → run_full_analysis.py (P0-v13)

### 🔲 تحت المتابعة
- [ ] **Backtest بالـ thresholds الجديدة (P0-v13)** — الـ thresholds الجديدة (balanced 42، conservative 50) ما اتعملهاش backtest لسه على الباك-تست الكامل. الـ WR ممكن تنزل شوية مع زيادة الصفقات. لو حابب، شغّل `comprehensive_persona_backtest_90d.py` بعد تحديث الـ thresholds فيه.
- [ ] **Backend endpoint للـ explosive hunter** — الـ hunter script بـ يـ output JSON لـ file، بس مفيش HTTP endpoint. لو الـ Flutter app محتاجه، لازم نضيف Flask route.
- [ ] **`?persona=` filter للـ performance-dashboard** — الـ endpoint بـ يـ return كل التوقعات مع بعض. لو الـ Flutter محتاج filter per persona، لازم نضيف query param.
- [ ] **فجوة verify (116 صف)** — لما `run_full_analysis.py` بـ يـ write 339 بس الـ verify بـ يـ show 223. غالباً UPSERT behavior. محتاج query audit.
- [ ] **تدوير الـ GitHub token** — التوكن اللي اتعمل للـ Flutter push لازم يتعمله revoke بعد الاستخدام.

### 🎯 الأهداف القصيرة المدى
1. مراقبة الـ dashboard بكرة الصبح بعد فتح السوق (9:30 Cairo).
2. لو لقيت فرصة انفجارية ماالتقطهاش الـ engine → trace السبب.
3. backtest بالـ thresholds الجديدة لتأكيد الـ WR.

---

## 📞 جهات الاتصال

| الدور | المسؤول |
|-------|---------|
| **المالك** | enmohsen20111975 |
| **المدير + المبرمج** | Z.ai Code (full autonomy) |
| **الـ Repository** | https://github.com/enmohsen20111975/GLMinvestment |
| **الـ Flutter App** | https://github.com/enmohsen20111975/flutter_investment_App |
| **الـ Production** | https://invist.m2y.net |

---

*هذا الملف هو الـ single source of truth. أي تغيير في المحرك = تحديث هذا الملف فوراً.*
*آلخر تحديث: P0-v13-OPPORTUNITY (commit `b16d9727`، 2026-08-09)*

---

## 🚨 Task 15 — Hard Geometry Gate (Emergency Fix) — 2026-08-16

### الكارثة المكتشفة
تحليل الإنتاج كشف: win rate 35.4%، PF=0.248، -1616% تراكمي. التوقعات المعكوسة:
- **هندسة معكوسة**: SCTS entry=614 target=608 (الهدف أقل من الدخول!)
- **أوقاف هزلية**: MFPC entry=37.22 stop=0.37 (وقف 1% من القيمة!)
- **تلوث تجزئات**: BTFH entry=3.12 target=1392 (هدف pre-split تاريخي!)
- **R/R سالب**: CCAP entry=5.70 target=5.66 (R/R=-0.01!)
- **P&L غير متماثل**: أرباح +0.11% مقابل خسارات -15.39%

### السبب الجذري
`enforce_geometry_guard` (المحور 3) كان بـ يستخدم **AUTO-FIX** بدل **REJECT**:
- كان بـ يحوّل target/stop لـ entry×1.05 / entry×0.95 (قيم وهمية)
- مفيش lower-bound على الـ stop (stop=0.37 عبر لأنه < entry×0.98)
- مفيش upper-bound على الـ target (target=1392 عبر لأنه > entry)
- مفيش فحص R/R في الـ gate

### الإصلاح الجراحي (4 ملفات)
1. **`prediction_tracker.py`** — `enforce_geometry_guard` ات rewrote بـ HARD REJECT:
   - R1: target > entry×1.03 (ربح ≥ 3%)
   - R2: stop < entry×0.97 (وقف ≤ 3%)
   - R3: stop > entry×0.90 (وقف ≤ 10%)
   - R4: target ≤ entry×3.0 (منع تلوث التجزئة)
   - R5: R/R ≥ 1.5 (مخاطرة مجدية)
2. **`historical_predictions_v2_routes.py`** — `_insert_prediction` guard
3. **`sniper_routes.py`** — direct INSERT guard
4. **`ai_predictions_routes.py`** — direct INSERT guard

### التحقق
- 16/16 اختبار نجح (كل كوارث الإنتاج اتمسكت + الحالات الصالحة عبرت)
- end-to-end عبر `record_prediction`: BTFH/MFPC/SCTS → REJECTED, VALID → ACCEPTED
- daily_closer: 0 errors، 0 false closures
- bun run lint: نظيف

### التأثير المتوقع
- عدد التوقعات هياقل (الصفقات الزبالة هتتـ reject)
- الجودة هتطلع: كل صفقة مسجّلة بـ R/R ≥ 1.5 مضمون
- التوقعات القديمة المعكوسة لسه في DB — المستخدم يقدر يحذفها:
  ```sql
  DELETE FROM predictions WHERE target_price <= entry_price * 1.03
     OR stop_loss <= entry_price * 0.90
     OR target_price > entry_price * 3.0
     OR signal IN ('BUY','STRONG_BUY','ACCUMULATE') AND stop_loss >= entry_price;
  ```

*آلخر تحديث: Task 15 — Hard Geometry Gate (2026-08-16)*
