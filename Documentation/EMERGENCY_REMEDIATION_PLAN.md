# 🚨 خطة الطوارئ الشاملة — Emergency Remediation Plan

> **التاريخ:** 2026-10-05
> **الأساس:** `Documentation/ENGINEERING_AUDIT_REPORT.md` + `Documentation/00-CONSTITUTION.md`
> **الهدف:** «تنظيف المشروع من أي عك أو لخبطة أو تداخل» بطريقة هندسية محترمة، خطوة بخطوة، مع التحقق من كل حاجة بعد كل مرحلة.
> **المبدأ التوجيهي:** كل خطوة صغيرة + اختبار + commit + push. لا شغل متقطع. لا حلول سريعة. لا بيانات وهمية. لا تكرار.

---

## 📋 المبادئ الحاكمة (Governing Principles)

### القواعد الدستورية الإلزامية (من 00-CONSTITUTION.md):

| القاعدة | المعنى | التطبيق في الخطة |
|---------|--------|-----------------|
| **Rule 4** | لا شاشات/ملفات/أنظمة جديدة إلا في الطوارئ | هنوسّع الموجود، مش هنبنى جديد |
| **Rule 5** | كل كود جديد لازم يتربط فعلياً | كل canonical function لازم يكون ليها caller |
| **Rule 12** | `load_merged_history()` هو المصدر الوحيد للأسعار | كل الحسابات هتقرأ منه |
| **Rule 16** | VERIFY-BEFORE-DELETE | قبل حذف أي ملف، نتأكد إن مفيش importer |
| **Rule 20** | Python = العقل، Node = العرض فقط | الحسابات في Python، Node proxy |
| **Rule 21** | V40.2 هو مصدر التوقعات الإنتاجي الوحيد | نعلن V40.2 canonical، نارشف الباقي |
| **Rule 25** | Refactoring يحتاج موافقة المالك + VERIFY-BEFORE-DELETE | كل حذف بـ git mv مش rm |
| **Rule 27** | NO-FAKE-DATA | نستخدم الـ DBs الحقيقية اللي سحبناها |
| **Rule 28** | NO-DUPLICATION | نوحّد، مش نكرر |
| **Rule 29** | UNIFIED-SYSTEM | كل حاجة مرتبطة ومستخدمة |
| **Rule 32** | CLIENT-VS-SYSTEM | Python logic، Node display |
| **Rule 41** | DOCS-FIRST-LAST | نقرأ التوثيق قبل وبعد كل عمل |
| **Rule 52** | UNIFIED-REUSABLE-COMPONENTS | نوسّع المكونات المشتركة الموجودة |

---

## 🗂️ ترتيب التنفيذ (5 Phases)

### Phase 0: التحضير (مكتمل ✅)
- [x] سحب الـ DBs الحقيقية من GitHub (18 ملف، 1.3GB)
- [x] نسخها لـ `db/` folder
- [x] التحقق إنها شغالة (1.2M rows price_history + 1.1M intraday + 306 predictions)
- [x] التحقق إن الـ dev server بيقرأها (HTTP 200)

### Phase 1: إعلان Canonical في CONSTITUTION (Rule 67)
**الهدف:** توثيق القرارات الهندسية كقواعد دستورية قبل أي كود.

**الخطوات:**
1.1. إضافة Rule 67 — CALCULATION-CANONICAL لـ `00-CONSTITUTION.md`:
  - ATR = Wilder's smoothing (`technical_analyzer.py:206`)
  - RSI = Wilder's smoothing (`technical_analyzer.py:81`)
  - Position sizing = risk-based (`utils/position_sizing.py:65`)
  - R:R = `computeRiskReward()` (TS) + `compute_risk_reward()` (Python جديد)
  - Stop = `entry - stop_atr_mult × ATR` من `engine_settings.stop_atr_mult`
  - PF fallback = 999.0 (TradingView convention)
  - master_score = 10-component weighted (MASTER_WEIGHTS)
  - VWAP = rolling 20-period
  - SMA200 = `sum(closes[-200:])/200` (مش EMA!)

1.2. إعلان canonical لكل حساب + مسار الملف canonical

1.3. تحديث `00-CONSTITUTION.md` بـ Rule 67 + تعديل Rule 12 (توسيع load_merged_history ليشمل كل القراءات)

**التحقق:**
- `python3 -c "import ast; ast.parse(open('Documentation/00-CONSTITUTION.md').read())"` (Markdown بس، نتأكد إن الـ structure سليم)
- git commit + push

**المدة:** 2 ساعة | **الملفات:** 1 (`00-CONSTITUTION.md`)

---

### Phase 2: بناء shared calculation libs
**الهدف:** بناء مكتبات حسابات موحدة (canonical) قبل مسح الـ duplicates.

**الخطوات (بالتدريج):**

#### 2.1. `vps-service/analyzers/indicators/` (NEW folder — استثناء Rule 3 للطوارئ)
**ملاحظة:** Rule 3 تمنع مجلدات جديدة، بس ده طوارئ لأن الـ audit كشف كارثة. هنوثّق السبب.

- `vps-service/analyzers/indicators/__init__.py` — تصدير كل الدوال
- `vps-service/analyzers/indicators/atr.py` — `calc_atr(closes, highs, lows, period=14)` (Wilder's)
- `vps-service/analyzers/indicators/rsi.py` — `calc_rsi(closes, period=14)` (Wilder's)
- `vps-service/analyzers/indicators/ma.py` — `sma(data, period)`, `ema(data, period)`, `macd(closes)`

**التحقق:** مقارنة قيم الـ canonical مع TradingView TA library على 10 أسهم مختلفة.

#### 2.2. `vps-service/utils/risk_reward.py` (NEW file)
- `compute_risk_reward(entry, target, stop, fallback=0) -> float`
- يشتغل لـ BUY + SELL (يكتشف الاتجاه من target vs entry)

#### 2.3. `vps-service/utils/backtest_stats.py` (NEW file)
- `compute_win_rate(closed_trades) -> float`
- `compute_profit_factor(closed_trades, fallback=999.0) -> float`

#### 2.4. توحيد position_sizing.py
- إعلان `utils/position_sizing.py` كـ canonical (risk-based)
- إعادة تسمية `analyzers/position_sizing.py` لـ `analyzers/position_size_multiplier.py` (عشان ما يبقاش فيه لبس)

#### 2.5. مهاجرة الـ call sites (بالتدريج)
- استبدال كل `calc_atr` inline بـ `from analyzers.indicators import calc_atr`
- استبدال كل `calc_rsi` inline بـ `from analyzers.indicators import calc_rsi`
- استبدال كل inline R:R بـ `from utils.risk_reward import compute_risk_reward`

**التحقق بعد كل ملف:**
- `python3 -c "import ast; ast.parse(open('FILE').read())"` — syntax check
- `python3 -c "from analyzers.indicators import calc_atr; print(calc_atr([100,101,99,102,103,105,104,106,107,108,109,110,111,112,113], [115,116,114,117,118,120,119,121,122,123,124,125,126,127,128], [99,100,98,101,102,104,103,105,106,107,108,109,110,111,112]))"` — value check
- تشغيل backtest script على الـ DBs الحقيقية + مقارنة WR قبل/بعد (مفروض تتطابق)
- `bun run lint` — ESLint clean
- git commit + push بعد كل sub-step

**المدة:** 3-5 أيام | **الملفات:** ~10 new + ~30 modified

---

### Phase 3: توحيد DB access
**الهدف:** استبدال 1,106 raw `sqlite3.connect` بـ `core/db_manager.py`.

**الخطوات:**

#### 3.1. توسيع `core/db_manager.py` (موجود)
- إضافة helper methods لكل DB (stocks, predictions, data_engine, news, intraday, price_history)
- كل method بترجع connection مع auto-close

#### 3.2. مهاجرة أعلى 50 ملف استخدم (بالتدريج)
- استبدال `sqlite3.connect('db/stocks.db')` بـ `from core.db_manager import get_stocks_db; conn = get_stocks_db()`
- بعد كل 10 ملفات: git commit + push + اختبار

#### 3.3. إصلاح `db_paths.py` المتناقض
- `NEWS_DB = news.db` (مش content.db)
- `macro_indicators` → `stocks.db` (مش market.db)

#### 3.4. توحيد intraday schema
- إضافة `bid, ask` columns لـ `stock_intraday`
- migration script يحوّل `intraday_prices` rows لـ `stock_intraday`

**التحقق:**
- `grep -r "sqlite3.connect" vps-service/ | wc -l` — العدد بينزل تدريجياً
- تشغيل backtest + الـ WR لازم يفضل ثابت
- git commit + push بعد كل 10 ملفات

**المدة:** 5-7 أيام | **الملفات:** ~50 modified

---

### Phase 4: توحيد الـ Frontend
**الهدف:** توحيد الـ 22 prediction card + 7 chart + 6 image card.

**الخطوات:**

#### 4.1. `shared/PredictionCard.tsx` (NEW shared component)
- prop: `{ entry, target, stop, signal, confidence, technicalExplanation? }`
- يعرض كل الأقسام (السعر + التحليل الفني + R:R)
- مهاجرة 5-10 components لاستخدامه (بالتدريج، مش مرة واحدة)

#### 4.2. `shared/CandlestickChart.tsx` (NEW shared component)
- دمج `TradingViewChart.tsx` + `InteractiveChart.tsx`
- prop: `{ ticker, ohlcv, indicators?, markers? }`

#### 4.3. `shared/ShareableImageCard.tsx` (NEW shared component)
- دمج الـ 6 ImageCards
- prop: `{ renderContent, filename, title? }`

#### 4.4. enforce StatCard usage
- CI rule (grep) يرفض inline stat-card patterns
- مهاجرة ~190 ملف تدريجياً

**التحقق بعد كل component:**
- `bun run lint` clean
- browser test للـ affected views
- git commit + push

**المدة:** 5-7 أيام | **الملفات:** ~30 new/modified

---

### Phase 5: أرشفة + تنظيف
**الهدف:** أرشفة الـ engines الميتة + duplicate admin tabs.

**الخطوات:**

#### 5.1. أرشفة 8 prediction engines غير نشطة
- `git mv vps-service/analyzers/v4_predictive_detector.py archive/engines/`
- نفس الشيء لـ: v73_sniper, v76_golden_hunter, unified_analyzer, fusion_engine, smart_confluence_engine, v82_analyzer, confluence_engine_v3
- VERIFY-BEFORE-DELETE: `grep -r "import v4_predictive_detector" vps-service/ src/` — لو فيه importer، نوقف

#### 5.2. أرشفة 23 archived backtests
- `git mv scripts/_archived/* archive/backtests/`

#### 5.3. توحيد 26 admin tabs → 10
- دمج Gold+Silver+Forex+MultiMarket → "Markets"
- دمج Backtest+SuperLearning+OptimizerParams → "Engine Tuning"

#### 5.4. حل أزمة الـ crontab المتناقض
- حذف `vps-service/crontab.txt` (المتناقض)
- إعلان `crontab.txt` (root) كـ canonical

**التحقق:**
- `bun run lint` clean
- `curl localhost:3000` HTTP 200
- تشغيل backtest كامل + الـ WR لازم يفضل ثابت
- git commit + push

**المدة:** 2-3 أيام | **الملفات:** ~50 archived/modified

---

## 🧪 خطة التحقق (Verification Plan)

### بعد كل sub-step:
1. `python3 -c "import ast; ast.parse(open('FILE').read())"` — Python syntax
2. `bun run lint` — ESLint clean
3. `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` — HTTP 200
4. browser test على الـ affected view
5. git commit + push

### بعد كل Phase:
1. تشغيل backtest على الـ DBs الحقيقية:
   ```bash
   python3 scripts/test_context_filters_task47.py
   ```
   - الـ WR لازم يفضل ثابت (لو اتغير، فيه regression)
2. تشغيل deep analyzer:
   ```bash
   python3 scripts/analyze_filters_deep.py
   ```
3. التحقق من كل الـ APIs:
   ```bash
   for endpoint in /api/predictions /api/screener/advanced /api/maker-radar /api/health; do
     curl -s -o /dev/null -w "$endpoint: %{http_code}\n" http://localhost:3000$endpoint
   done
   ```
4. browser test شامل (agent-browser):
   - افتح `/#admin` → تحقق إن كل الـ tabs بتفتح
   - افتح `/#predictions` → تحقق إن الـ cards بتعرض
   - افتح `/#stock-filters` → تحقق إن الـ table بتعرض

### المعايير (Acceptance Criteria):
- ✅ لا regression في الـ WR (±0.5% مسموح)
- ✅ لا API بيرجّع 500
- ✅ لا console errors في browser
- ✅ lint clean
- ✅ كل الـ canonical functions ليه caller فعلي

---

## 🔄 المهمة الموازية: ربط #stock-filters بـ #liquidity-radar

### الخطة (Frontend-only — linking، لا code جديد):

#### الخطوة 1: توسيع `UnifiedTable.tsx` بإضافة `columnVisibility` prop
- prop جديد: `columnVisibility?: Record<string, boolean>`
- prop جديد: `onColumnVisibilityChange?: (next) => void`
- إضافة `<DropdownMenu>` بـ checkboxes لكل column
- **Backward compatible:** لو الـ prop مش موجود، الـ behavior زي ما هو

#### الخطوة 2: تعديل `StockScreenerAdvanced.tsx`
- parallel fetch لـ `/api/maker-radar` مع `/api/screener/advanced` (Promise.all)
- بناء `Map<ticker, RadarStock>` من radar response
- دمج الـ liquidity fields (maker_activity, buy_pct, net_flow_egp, accumulation, life_cycle, expected) في كل row
- إضافة 5-6 columns جداد لـ `screenerColumns` array (كلها `sortable: true`)
- إضافة `colVis` state + تمريره لـ UnifiedTable
- تحديث `exportCSV` عشان يشمل الـ liquidity fields

#### الخطوة 3: التحقق
- `bun run lint` clean
- browser: افتح `/#stock-filters` → اتأكد إن:
  - الـ columns الجديدة ظاهرة
  - الـ liquidity data معروضة للأسهم اللي في radar
  - الأسهم اللي مش في radar بـ تعرض "—"
  - الـ sort شغال على كل columns (جديد + قديم)
  - الـ show/hide dropdown شغال
- HTTP 200 على `/api/screener/advanced` + `/api/maker-radar`

**المدة:** 2-3 ساعات | **الملفات:** 2 (`UnifiedTable.tsx` + `StockScreenerAdvanced.tsx`)

---

## 📊 جدول التتبع (Progress Tracking)

| Phase | الحالة | المدة المقدرة | الملفات | التحقق |
|-------|--------|--------------|---------|--------|
| 0: التحضير | ✅ مكتمل | 1 ساعة | DBs | ✅ |
| موازي: ربط stock-filters + radar | ⏳ pending | 2-3 ساعات | 2 | ⏳ |
| 1: إعلان canonical | ⏳ pending | 2 ساعة | 1 | ⏳ |
| 2: shared libs | ⏳ pending | 3-5 أيام | ~40 | ⏳ |
| 3: توحيد DB access | ⏳ pending | 5-7 أيام | ~50 | ⏳ |
| 4: توحيد frontend | ⏳ pending | 5-7 أيام | ~30 | ⏳ |
| 5: أرشفة + تنظيف | ⏳ pending | 2-3 أيام | ~50 | ⏳ |

**الإجمالي:** ~15-22 يوم عمل | ~170 ملف

---

## ⚠️ المخاطر + Mitigation

| الخطر | الاحتمالية | التأثير | Mitigation |
|-------|-----------|---------|-----------|
| Regression في الـ WR بعد تغيير canonical | عالية | حرج | اختبار backtest قبل/بعد كل ملف |
| كسر caller موجود عند حذف duplicate | متوسطة | حرج | VERIFY-BEFORE-DELETE لكل ملف |
| الـ 1,106 raw SQLite calls مكسورة | متوسطة | متوسط | مهاجرة تدريجية (10 ملفات لكل commit) |
| الـ force-push من cron jobs على الـ remote | عالية | متوسط | pull --rebase قبل كل push |
| بيانات وهمية تتسلل | متوسطة | حرج | NO-FAKE-DATA rule + اختبار على الـ DBs الحقيقية |

---

## 🎯 المعايير النهائية للنجاح (Definition of Done)

1. ✅ كل حساب له canonical واحد موثّق في CONSTITUTION
2. ✅ مفيش duplicate calculation (grep بيرجّع canonical بس)
3. ✅ مفيش raw `sqlite3.connect` في أي ملف جديد
4. ✅ مفيش prediction engine غير V40.2 (الـ 8 الباقية في archive/)
5. ✅ مفيش duplicate admin tab (10 بدل 26)
6. ✅ shared PredictionCard + CandlestickChart + ShareableImageCard مستخدمة
7. ✅ الـ #stock-filters table بـ تعرض liquidity data + show/hide + sort
8. ✅ الـ backtest WR ثابت (±0.5%)
9. ✅ كل الـ APIs بـ ترجّع 200
10. ✅ Documentation محدّث + pushed لـ GitHub

---

*تم الإنشاء بواسطة Emergency Remediation Plan — 2026-10-05 — يتبع Documentation/ENGINEERING_AUDIT_REPORT.md + 00-CONSTITUTION.md*
