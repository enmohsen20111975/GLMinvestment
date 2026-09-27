# AGENTS.md — دليل سير العمل لمشروع GLMinvestment

> ملف سير العمل ده إلزامي لأي جلسة (Kilo / غيره). اقرأه قبل أي تعديل.

---

## 🚨 لو أنت Agent جديد (Grok / Gemini / غيره) — ابدأ من هنا

> **★ آخر تحديث (2026-08-17):** التوثيق اتوحد في **4 ملفات رئيسية فقط** تحت `Documentation/`.
> كل ملفات التوثيق السابقة (CURRENT_STATE, PROJECT_FULL_BLUEPRINT, API_DICTIONARY, 03-REFACTORING_REPORT، إلخ)
> دُمجت بالكامل في هذه الـ 4. اقرأها بهذا الترتيب:
>
> 1. **`Documentation/00-CONSTITUTION.md`** — الدستور والقواعد الثابتة (25 قاعدة + سير العمل + KPIs)
> 2. **`Documentation/01-PROJECT_ANATOMY.md`** — التشريح الكامل (المعمارية، المحركات، DBs، APIs، تدفق البيانات)
> 3. **`Documentation/02-SCREENS_AND_COMPONENTS.md`** — كل شاشة وكل مكوّن بحالته (نشط/ميت/مكرر) + الديون التقنية
> 4. **`Documentation/SYSTEM_HOW_IT_THINKS.md`** — كيف يحلّل النظام سهمًا ويُولّد توصية (المنطق + R:R + fundamentals)
>
> **بعد هذه الملفات**، اقرأ `SYSTEM_STATE.md` (جذر المشروع) + آخر 3 إدخالات في `CHANGELOG.md`.

**قبل أي حاجة، اقرأ `Documentation/00-CONSTITUTION.md` ثم `SYSTEM_STATE.md`.** فيه:
1. آخر state (P0-v2, commit `ed55a60c` — 2026-08-09) — schema-aware scripts + HARD toxic-row cap
2. الـ root cause اللي اتحل (الـ scripts كانت مكتوبة على `recommendation` بينما الإنتاج بـ يستخدم `signal`/`signal_type` + الـ toxic rows بتـ تمرّ من `data_quality IS NULL`)
3. الـ runbook المطلوب على VPS (backfill persona + diagnose UTOP + gap-fill price_history)
4. القيود الصريحة (`STOCK_ALIVE_ENFORCE=False` يظل، purge كامل ما يتعادش، schema-aware دائماً)
5. مسار الـ VPS الصحيح (`/root/GLMinvestment/vps-service` للـ pull/verify/trigger،
   `/root/GLMinvestment` للـ SELECT)

⚠️ **المرجع الحي هو `SYSTEM_STATE.md` (جذر المشروع) + `CHANGELOG.md`** (آخر entry في الأعلى).

⚠️ **ما تضيفش fixes production code إضافية** إلا لو الـ user طلب صراحة. الـ P0-v2 fix موجود في `ed55a60c`. محتاج بس verify على VPS.

---

## القواعد الذهبية (ممنوع كسرها)

1. **مفيش شاشات جديدة** — طوّر الموجود بس. لو محتاج تعرض حاجة، ضيفها
   تبويب/قسم/ـ badge inside مكوّن موجود، متعملش صفحة جديدة.
2. **مفيش ملفات جديدة** — طوّر الملفات الحالية. متضيفش `.tsx`/`.py` جديدة
   عشان تحل مشكلة؛ وسّع اللي موجود.
3. **مفيش كود غير مستخدم** — أي دالة/endpoint بتكتبها لازم تتربط وتتستخدم
   فعلاً (من الباك-إند للـ API للواجهة). ما تسيبش كود ميت.
4. **اربط كل حاجة** — لو ضفت منطق في الباك-إند، أكّد إنه معروض/مستخدم
   في الواجهة. لو ضفت حقل، أكّد إن الـ API بيرجّعه والـ UI بيعرضه.
5. **schema-aware دائماً** (P0-v2) — أي script/route بـ يقرأ من `predictions.db`
   لازم بـ يفحص الأعمدة بـ `PRAGMA table_info` قبل SELECT، وبـ يستخدم
   `COALESCE(signal, signal_type, recommendation)` لو محتاج الإشارة. الإنتاج
   بـ يستخدم `signal`/`signal_type` — مش `recommendation`.
6. **HARD cap على toxic returns** (P0-v2) — كل KPI query على الصفوف المغلقة
   لازم يكون فيها `AND (actual_return IS NULL OR ABS(actual_return) <= 50)`
   في WHERE نفسها — مش بس في حساب المتوسطات. ده بـ يمنع `-10814%` من تلوث
   الـ win/loss COUNT + averages معاً.
7. **ATR stop في نطاق [3%, 7%]** (P0-v3) — الـ `ATR_STOP_MIN_PCT=3.0` و
   `ATR_STOP_MAX_PCT=7.0` في `opportunity_quality.py`. الـ stop_loss لكل BUY
   جديد لازم يكون في النطاق ده (مش 1-8% القديم).
8. **Trailing stop = FLOOR at breakeven, not CAP** (P0-v3) — في `daily_closer.py`،
   بعد الـ partial exit، `trailing_stop = max(trailing_stop, entry_price)` (FLOOR)
   مش `if trailing_stop > entry: trailing_stop = entry` (CAP). الـ trailing بـ يـ ratchet
   up مع highest و ما بـ ينزلش تحت entry.
9. **EXIT_POLICY_MODE = 'partial_1r_trailing'** بقت الـ default (P0-v3). سياسة الخروج:
   50% عند 1R + breakeven + trail الباقي. لو محتاج backward compat: `EXIT_POLICY_MODE=fixed`.

## بنية المشروع

- **الباك-إند (Python):** `vps-service/`
  - المحرك المركزي للمخاطر: `vps-service/risk_management_advanced.py`
  - مسارات الـ API: `vps-service/api/risk_routes.py` (Blueprint `/api/risk`)
  - محرك التسجيل الموحد: `vps-service/analyzers/core_scoring_engine.py`
  - الإعدادات/الـ dataclass: `vps-service/config/unified_config.py`
- **الواجهة (Next.js):** `src/`
  - شاشة الحماية المركزية: `src/components/risk/RiskManagementWidget.tsx`
  - كرت التوصية: `src/components/sniper/OpportunityCard.tsx`
  - تحليل السوق (بيستهلك نتيجة الـ engine): `src/components/analysis/MarketAnalysisView.tsx`
  - دوال مشتركة: `src/lib/utils.ts` (فيه `getRRVerdict`)
  - بروكسي الـ API للـ risk: `src/app/api/risk/{position-size,stop-loss,targets}/route.ts`
    (يلغّي لـ `/api/risk/<endpoint>` على بايثون عبر `EGXPY_SERVICE_URL`).

## الأنظمة الخمسة لحماية الصفقات (موجودة ومربوطة)

مكانها: `vps-service/risk_management_advanced.py` + endpoints في `risk_routes.py`
والمقابل في الواجهة داخل `RiskManagementWidget.tsx` (تبويب "حاسبة الصفقة").

| النظام | دالة الباك-إند | endpoint | ظهور في الواجهة |
|--------|---------------|----------|------------------|
| حاسبة حجم الصفقة | `calculate_position_plan` | `/position-plan` | تبويب حاسبة الصفقة |
| لا تشتري نازل | `evaluate_buy_safety` | `/buy-safety` | تبويب حاسبة الصفقة |
| لا تبيع في القاع (Trailing) | `explain_trailing_stop` | `/trailing-explain` | تبويب حاسبة الصفقة |
| لا تحتفظ بالخسارة (Forced Exit) | `enforce_stop_loss` | `/enforce-stop` | تبويب حاسبة الصفقة |
| مؤشر R:R المرئي | `get_rr_verdict` | — | `getRRVerdict` في `utils.ts` + `OpportunityCard` |

> ملاحظة: حاسبة الصفقة في الواجهة بتحسب محلياً (robust) بنفس معادلات
> الباك-إند، والبروكسي بيربط التبويبات الأصلية (حجم/وقف/أهداف) بـ endpoints الباك-إند.

**الشرح السريع لكل نظام:**
- **حاسبة حجم الصفقة:** تحسب عدد الأسهم المسموح + أقصى خسارة من رأس المال ونسبة المخاطرة (قاعدة 2%) — تجاوب سؤال المستخدم "عايز أشتري بـ X، الوقف عند Y، أشتري كام سهم وهخسر كام".
- **لا تشتري نازل:** تمنع الشراء في نزول — لازم Higher Low ×2 + تأكيد حجم/انعكاس لو RSI<30 (مش سبب كافي لوحده).
- **لا تبيع في القاع:** الـ Trailing Stop بيتحرك لأعلى بس (مابينزلش) — عشان ما تبيعش عند أول تراجع وتروح السهم يكمل صعود.
- **لا تحتفظ بالخسارة:** الوقف ثابت ما يتغيرش لتحت؛ لو السهم نزل 8% ← إشعار إجباري "اخرج فوراً".
- **مؤشر R:R المرئي:** يلوّن R:R (أخضر ≥2 / أصفر 1.5–2 / أحمر <1.5) في كل كرت توصية عشان المستخدم يشوف "ليه الصفقة آمنة".

## نظام Momentum Accumulation (تجميع ذكي / Pre-Explosion)

الأسهم اللي بتصعد متواصل بدون pullback حقيقي (زي ELKA) — النظام القديم كان
بيبيعها بدري بسبب RSI Override. الحل متطبّق **جوه `core_scoring_engine.py`**
(من غير ملفات جديدة):

- `_detect_momentum_accumulation()` — يكشف: فوق كل المتوسطات + حجم ≥2.5× +
  RSI 55-85 + مفيش تراجع >5% في 15 يوم.
- `_apply_rsi_override()` — فيه **استثناء Momentum**: لو السهم بيتجمع
  (RSI < 85) ما يتحوّلش لـ SELL، يفضل ACCUMULATE.
- `RiskCalculator.calculate(momentum_mode=True)` — وقف **متحرك أوسع** تحت
  آخر قاع (يمنع فخ الوقف الضيق).
- النتيجة في `UnifiedSignalResult` (حقول: `momentum_accumulation`,
  `momentum_strength`, `momentum_reason`, `no_pullback`, `trailing_stop`) —

  معروضة في `MarketAnalysisView.tsx` كـ badge "تجميع ذكي: Pre-Explosion".

## الأنظمة الديناميكية الحقيقية (Phase 3 — يوليو 2026)

> الفلسفة: "اللي بيفرق بين 50% و75% مش الـ formulas — الـ speed of adaptation."

### 1. Volume-RSI Divergence 3D (`core_scoring_engine.py`)

Divergence بقت **ثلاثية الأبعاد** (price + RSI + volume):
- `_detect_rsi_divergence(prices, rsi, volumes)` → `bullish_confirmed` / `bearish_confirmed` / `bullish` / `bearish` / `none`
- `confirmed` = الحجم يأكد (bearish + vol decreasing = distribution حقيقي)
- `confirmed` بيغلب حتى الـ Momentum Accumulation
- تعديلاتThreshold: confirmed = ±8 نقاط، 2D = ±5

### 2. Market Pulse Propagation (`background_analyzer.py` + `master_analyzer.py`)

**قبل:** الـ pulse كان بيحسب ومش بيوصل (TypeError silent).
**بعد:** الدورة الكاملة:
```
market_scheduler → bg_analyzer._current_market_pulse → master_analyzer.analyze(market_pulse=...) → adaptive_weights
```
- `MasterAnalysis` فيها: `pulse_regime`, `pulse_breadth`, `pulse_risk`, `pulse_timestamp`

### 3. VWAP Proxy (`support_resistance_calculator.py`)

- `_compute_vwap_proxy(rows)`: VWAP تقريبي من (H+L+C)/3 × volume على 20 يوم
- `vwap_flow`: `accumulation` / `distribution` / `neutral`
- `flow_strength > 0.3` بيأكد أو يعارض الـ zone_type

### 4. Trailing Stop Levels (`persona_gambler.py`)

- الأهداف التلاتة = مستويات لتحريك الوقف (مش أوامر بيع جزئي)
- `stop_level_1` = breakeven | `stop_level_2` = target_1 | `stop_level_3` = target_2
- `stop_triggers_ar` = شرح عربي خطوة بخطوة

### 5. Leading Indicator Proxy (`persona_investor.py`)

- `_detect_story_change_proxy(ticker, sector)`: 3 proxies
  1. Price vs Sector Divergence (stock -15% vs sector +X%)
  2. Volume Anomaly (3x+ avg + price dropping = smart money)
  3. Support Break (price < support × 0.98)
- `story_status`: `intact` / `warning` (-5 score) / `broken` (-15 score)

### 6. Regime-Specific Optimization (`prediction_optimizer.py`)

- `_regime_specific_optimize(days=60)`: كل regime له params خاصة
- Bull: R/R 1.0+, stop 2.5× ATR, min_score 45
- Bear: R/R 1.5+, stop 1.5× ATR, min_score 60
- Range: R/R 1.2+, stop 2.0× ATR, min_score 50

### 7. Sector Gate Pre-Filter (`sniper_routes.py`)

- `check_sector_gate_pre(ticker, sector, fundamentals)`: 4 فحوصات قبل أي حساب
- لو رفضت → HOLD فوري (بيوفر وقت 10 محللات)
- Endpoint: `GET /sector-gate/<ticker>`

### 8. Immediate Learning Loop (`learning_engine.py`)

- `on_prediction_closed()` → `trigger_immediate_learning(ticker, regime)`
- Feedback loop: كل صفقة مغلقة → tweak param → quick backtest 30 يوم → كتابة فوراً في `optimizer_params.json`
- `trigger_immediate_learning()`: نقطة دخول عامة للـ daily_closer

> التوثيق الكامل لكل تعديل في `Documentation/MISSING_TASKS.md` (#23-#30).

## ملاحظات تقنية مهمة

- `RiskCalculator.calculate` هي **instance method** (مفيش `@staticmethod`) —
  لو ظهر خطأ `UnifiedConfig has no attribute get` يبقى حد حط `@staticmethod`
  بالغلط. متعملش كده.
- `core_scoring_engine` ليه `if __name__ == "__main__"` للاختبار السريع.
- الفحص: `npx tsc --noEmit -p tsconfig.json` للواجهة، و`python3 -c "import ..."`
  للباك-إند.

## بايبلاين البيانات الموحد (Unified Data Pipeline) — DATA-UNIFY-007

> **القاعدة:** `load_merged_history()` هو **المصدر الوحيد** لقراءة بيانات الأسعار في النظام.
> الشارت التفاعلي والمايسترو والـ BackgroundAnalyzer كلهم بيقرأوا من نفس الدالة.

**الملف:** `vps-service/analyzers/master_analyzer.py` (الأسطر 111–336)
**التوقيع:**
```python
def load_merged_history(ticker: str, db_path: str, limit: int = 100) -> List[Dict[str, Any]]
```

**خطوات الدالة (5 خطوات):**
1. تحميل التاريخ اليومي من `price_history.db → price_history` (with column fallback).
2. كشف نوع الأصل من `intraday.db` (stock/crypto/commodity).
3. جلب بيانات intraday الأحدث من تاريخ آخر شمعة يومية وتجميعها لشموع يومية.
4. fallback من `stocks` لو اليوم مش موجود (شمعة وهمية بالسعر اللحظي).
5. الدمج والترتيب الزمني (قديم → جديد).

**الـ Normalization المُطبَّق:**
- **فلتر egksco**: يُفضّل مصدر `egksco` (المرجع الرسمي من البورصة المصرية) على `egx_investment_migration` (البيانات الملوّثة).
- **تطبيع migration**: لو النسبة بين egksco/migration خارج `[0.5, 2.0]` → يتجاهل migration تماماً.
- **`_adjust_for_splits`** (في `chart_routes.py`): كشف القفزات في النطاق `[1.8x, 10x]` في الاتجاهين وتطبيعها.

**الاستخدام:**
- `chart_full_analysis()` في `vps-service/api/chart_routes.py` (للشارت التفاعلي).
- `BackgroundAnalyzer._analyze_and_store()` في `vps-service/analyzers/background_analyzer.py` (لتخزين التحليلات).
- `MasterAnalyzer._get_price_data()` في `master_analyzer.py`.

> ⚠️ **مهم:** أي محلل جديد **لازم** يستخدم `load_merged_history()` مش يقرأ من `stock_daily_prices` أو `price_history` مباشرة. ده يضمن توحيد البيانات ومنع الـ split-brain.

## فلتر السيولة الصارم (Strict Liquidity Filter)

> **القاعدة:** أي سهم turnover يومي < 500,000 EGP → **يُسقط** من `stored_analyses` نهائياً.
> مفيش استثناء. الهدف: تخلّص الأسهم الميّتة سيولًة (زي ACAP, AFDI, إلخ) من الـ UI.

**الثابت:** `MIN_TURNOVER_EGP = 500_000` (في `vps-service/analyzers/background_analyzer.py`)

**الـ Logic:**
```python
turnover_egp = last_close * last_volume
if turnover_egp < MIN_TURNOVER_EGP:
    return None  # لا يُخزَّن في stored_analyses
```

**الـ Migration الآمن:**
- تم إضافة عمود `turnover_egp REAL` لـ schema `stored_analyses` (ALTER TABLE ADD COLUMN — آمن).
- الـ background_analyzer بيحسب الـ turnover ويخزّنه مع كل تحليل.

**الـ Endpoints المتأثرة:**
- `GET /api/stored-analysis/results` — ما بيرجّعش الأسهم ميّتة السيولة.
- `GET /api/maestro/persona/<ticker>` — بيتخطّى الأسهم الميّتة.
- الـ Persona tabs في `MarketAnalysisView.tsx` — ما بتعّرضش أسهم ميّتة سيولة.

## MACD + Candlestick (موحّدين بين الشارت والمايسترو) — TOOLKIT-UNIFY-010

> **القاعدة:** الشارت التفاعلي والمايسترو بيستخدموا **نفس** حسابات MACD و Candlestick.
> مفيش تكرار للحسابات — الـ backend بيبعت arrays جاهزة، الـ Frontend بعرضها.

**الملف الموحّد:** `vps-service/api/chart_routes.py`

**الـ Helpers الجديدة:**
- `_ema_seeded(values, period)` — EMA باستخدام SMA كـ seed (الـ approach القياسي لـ MACD).
- `_calc_macd(closes, fast=12, slow=26, signal=9)` — يرجع 3 arrays (`macd_line`, `signal_line`, `histogram`) بنفس طول closes مع `None` في الـ warmup region.
- `_detect_candlestick_patterns(ohlcv)` — كشف 5 أنماط على آخر شمعتين:
  - Doji (neutral/weak)
  - Hammer (bullish/medium)
  - Shooting Star (bearish/medium)
  - Bullish Engulfing (bullish/strong)
  - Bearish Engulfing (bearish/strong)

**الـ Response Fields المضافة لـ `/api/chart/full-analysis`:**
- `indicators.macd`, `indicators.macd_signal`, `indicators.macd_histogram` (3 arrays للـ lightweight-charts).
- `current_indicators.macd`, `macd_signal`, `macd_histogram`, `macd_trend`, `macd_trend_ar`, `macd_color` (6 fields للـ sidebar/screener).
- `candlestick_patterns` array (كل pattern فيه `name`, `name_ar`, `signal`, `strength`).

**الـ Frontend:**
- `InteractiveChart.tsx`: MACD pane بـ backend-first approach (لو الـ backend بعت arrays، استخدمها؛ لو مش بعت، fallback لـ `calcMACD()`).
- `TradingChartView.tsx`: grid `2×2` → `3×2` (6 خلايا: RSI/ATR/Vol/BB/MACD/Pattern).

**الـ Audit Report:**
- `db/analysis_tools_audit.json`: `gap_count: 12 → 10`، `overlap_count: 5 → 7`، MACD + Candlestick_Patterns اتقلوا من `maestro-only` لـ `both`.

> ⚠️ **ملاحظة:** MACD + patterns بس بُعرضوا، مش بيأثروا على confluence score (دي P1 مستقبلية — لو عايز +5pts لـ bullish MACD).

## الـ Single-Viewport (شاشة الشارت 75%/25%) — SINGLE-VIEWPORT-008

> **القاعدة:** شاشة `#trading-chart` لازم تكون **single-viewport** بدون scroll عمودي على desktop.
> Layout: 75% للشارت + 25% للـ sidebar، مع publish button pinned في الأسفل.

**الملفات:**
- `src/app/page.tsx` — outer div للـ chart view: `h-[calc(100vh-103px)]` (يحجز 103px للـ banners).
- `src/components/analysis/TradingChartView.tsx` (765 → 655 سطر بعد إعادة الكتابة).

**الـ Layout:**
- `lg:flex-[3]` للشارت (75% width).
- `lg:flex-[1]` للـ sidebar (25% width).
- chart area: 941px × 628px | sidebar: 318px × 628px (على 1536×864 viewport).

**الـ Sidebar (5 أقسام مضغوطة):**
1. التوصية (badge كبير ملوّن + score%).
2. الخطة الفنية (grid 2×2: دخول/هدف/وقف/R:R).
3. الخلاصة بالبلدي (analysis_text مقطوع 240 حرف).
4. مؤشرات سريعة (grid 3×2: RSI/ATR/Vol/BB/MACD/Pattern).
5. زر النشر (full-width + Share2/spinner — pinned في الأسفل).

**الـ Responsive:**
- Desktop: لا scroll عمودي على body (h-[calc(100vh-103px)] يحجز مساحة الـ banners بالظبط).
- Mobile: layout عمودي (chart فوق 55vh، sidebar تحت، scroll مسموح).
- Sidebar بـ scroll داخلي على desktop فقط (`lg:overflow-y-auto`).

**زر النشر:**
- `chartViewRef` بيلفّ الـ Single-Viewport كله.
- `handlePublish` يستخدم `toPng` على chartViewRef + caption تفصيلي (6 أسطر: ticker, name_ar, signal, score, regime, entry/target/stop, R:R).
- POST `/api/market/publish-status-image` للنشر على تيليجرام.
- `mb-16` على زر النشر عشان ما يلبسش الـ FloatingAssistant button.

## الأدوات المساعدة (Utility Scripts)

> **القاعدة:** السكربتات دي مش شغّالة في الـ runtime — أدوات صيانة يدوية أو cron jobs.

| السكربت | الوظيفة | الاستخدام |
|---------|---------|-----------|
| `scripts/daily_db_health_check.py` | فحص يومي لكل DBs + إصلاح تلقائي + تحديث أسعار + تقرير JSON | `python3 scripts/daily_db_health_check.py [--dry-run] [--verbose]` |
| `scripts/setup-daily-health-cron.sh` | تثبيت/إزالة cron job يومي 3 صباحاً بتوقيت القاهرة | `bash scripts/setup-daily-health-cron.sh [--install|--remove|--status]` |
| `scripts/repair_all_dbs.py` | إصلاح DBs تالفة (REINDEX + dump/rebuild) + backup قبل أي إصلاح | `python3 scripts/repair_all_dbs.py [--check] [db_path]` |
| `scripts/refresh_stock_prices.py` | تحديث `stocks.current_price` من `price_history.db` (آخر close_price، مفضّل مصدر egksco) | `python3 scripts/refresh_stock_prices.py` |
| `scripts/analyze_ticker_pollution.py` | فحص تلوث رموز الأسهم (98 سهم ملوث اتعرفوا + اتوثّقوا في `stocks_cleanup_report`) | `python3 scripts/analyze_ticker_pollution.py [--apply]` |
| `scripts/inject_egx_historical_data.py` | حقن بيانات تاريخية EODHD في `price_history.db` (مصدر `egksco_backfill`) لسد فجوة الـ 4-Day Data Trap | `python3 scripts/inject_egx_historical_data.py [--dry-run] [--ticker=COMI]` |
| `scripts/backtest_unified_pipeline.py` | backtest بأثر رجعي للـ pipeline الموحّد (90 يوم × 10 أسهم، win_rate target ≥ 55%) | `python3 scripts/backtest_unified_pipeline.py` |

**التقارير الناتجة:**
- `db/backups/daily_health_report.json` (+ نسخ مؤرخة 30 يوم).
- `db/stocks_cleanup_report.json` (+ جدول `stocks_cleanup_report` في `stocks.db`).
- `db/backtest_results/unified_pipeline_backtest.json`.
- `db/backups/daily_health.log` (سجل cron).

**الـ Cron Job اليومي:**
```bash
# تثبيت cron job (يومياً 3 صباحاً Africa/Cairo)
bash scripts/setup-daily-health-cron.sh --install

# الحالة + آخر تقرير + آخر 10 أسطر من السجل
bash scripts/setup-daily-health-cron.sh --status

# إزالة
bash scripts/setup-daily-health-cron.sh --remove
```

> ⚠️ **ملاحظة:** الـ cron jobs مش متاحة في الساندبوكس — السكربتات جاهزة للإنتاج.

## نزع الألغام (Landmine Defusal) — P0-LANDMINE-FIX-011

> **القاعدة:** قبل أي رفع للإنتاج، لازم نتأكد إن مفيش runtime errors حرجة (لغم موقوت).

**اللغم اللي اتنزّع:**
- `_stop_level_1/2/3` و `_stop_triggers_ar` في `vps-service/analyzers/persona_gambler.py` (السطر 525 قبل الإصلاح).
- **التشخيص:** كانوا معرّفين فقط داخل `if signal == 'BUY'` block (السطر 517–521)، لكنهم يُستخدموا في `GamblerResult` النهائي (السطر 676–680) في كل المسارات (BUY/SELL/HOLD).
- **المشكلة:** لو `signal != 'BUY'` → `UnboundLocalError` → Runtime Error 500 وقت الجلسة.
- **الإصلاح:** نقل التهيئة `_stop_level_1/2/3 = 0.0` و `_stop_triggers_ar = ''` لـ **قبل** `if signal == 'BUY'` (السطر 423–426)، وحذف التهيئة المكررة داخل الـ block.
- **التحقق:** `analyze_gambler('COMI', ...)` → `signal=HOLD, stop_level_1=0.0` (لا UnboundLocalError) ✅.

> **قاعدة جديدة:** أي متغير بيُستخدم في الـ Result النهائي لازم يكون له default value قبل أي conditional block. ارجع لـ AGENTS.md ده كل ما تشتغل على `persona_*.py`.

## نظام النسخ الاحتياطي
- **سكربت**: `scripts/auto-backup.sh` — نسخ يومي مع حذف تلقائي بعد أسبوع
- **Cron**: `scripts/setup-backup-cron.sh` — إعداد تشغيل يومي الساعة 3 صباحاً
- **API**: `POST /api/admin/db-manager/auto-backup` — نسخ يدوي من لوحة التحكم
- **Cleanup**: `POST /api/admin/db-manager/cleanup-old-backups` — تنظيف يدوي
- **سجل العمليات**: `db/backups/backup.log`

## لو عايز تضيف ميزة جديدة

1. دوّر على المكوّن/الدالة الأقرب في الملفات الموجودة.
2. وسّعها (function param / tab / badge) مش تحط ملف جديد.
3. ربط الباك-إند ← endpoint ← بروكسي (لو موجود) ← الواجهة.
4. أضف الحقل للـ dataclass ولـ `to_dict` وللـ UI type وللـ render.
5. شغّل الفحص (tsc + import بايثون) قبل ما تخلص.

## بيئة الساندبوكس (Z.ai Code Sandbox)

> المسار: `/home/z/my-project/` — نفس الكود على الإنتاج واللابتوب، بس طريقة التشغيل مختلفة.

### الفروقات الجوهرية عن الإنتاج/اللابتوب

- **مفيش PM2**: الساندبوكس بيستخدم `.zscripts/start-watchdog.sh` بدلاً منه.
  - التشغيل: `./.zscripts/start-watchdog.sh --start`
  - الـ watchdog بيستخدم `setsid + nohup + disown` عشان العمليات تعيش بعد ما الـ shell يقفل.
  - بيراقب المنافذ 3000 و 8010 كل 5 ثواني ويعيد التشغيل لو ماتت خدمة.
- **مفيش build**: الساندبوكس بيشتغل بـ `next dev` بس (production build ممنوع).
- **NODE_OPTIONS محدود**: `--max-old-space-size=1024` (مش 2048) عشان الـ cgroup محدودة بـ 4GB.
  - لو Next.js مات من OOM، الـ watchdog بيعيد تشغيله تلقائياً.
- **Python**: بيستخدم `/home/z/.venv/bin/python3` (مش venv جوه المشروع).
- **المنافذ**: 3000 (Next.js) و 8010 (Python) بس. Caddy على المنفذ 81 بيوجه الطلبات.
  - للوصول لـ Python من المتصفح: `/api/...?XTransformPort=8010`
  - ممنوع تكتب `http://localhost:8010` في كود الواجهة — استخدم المسار النسبي.

### قواعد إضافية للساندبوكس

1. **متستخدمش `nohup cmd &` لوحدها** — العمليات هتموت مع قفل الـ shell. استخدم الـ watchdog.
2. **الـ DBs الحقيقية مش موجودة كاملة** — `stocks.db` فيه بيانات (مُستخرج من zip)،
   بس `price_history.db` و `data_engine.db` محتاجين استخراج من db/*.zip (موجودين في git
   لكن مجهّلين في `.gitignore`).
   - للبيانات الحقيقية: `unzip db/stocks.db.zip -d db/` (وكذلك data_engine و price_history).
   - أو انسخ الـ DBs الكبيرة من الإنتاج (`scp root@YOUR_VPS:/root/GLMinvestment/db/*.db db/`).
   - **السكربتات المساعدة** (`scripts/daily_db_health_check.py`، `scripts/repair_all_dbs.py`)
     جاهزة وتشتغل على الساندبوكس — مش محتاجة cron.
3. **ملف `dev.log`** هو المصدر الرسمي لسجل Next.js. اقرأه بـ `tail -50 dev.log`.
4. **ملف `python_backend.log`** هو سجل Python. اقرأه بـ `tail -50 python_backend.log`.
5. **ملف `worklog.md`** (هذا الملف) بيُحدَّث مع كل تعديل — بس مش متتبع في git (local only).
6. **الـ cron jobs مش متاحة في الساندبوكس** — `scripts/setup-daily-health-cron.sh --install`
   مش هيشتغل هنا. استخدم السكربتات يدوياً (`python3 scripts/daily_db_health_check.py --dry-run`).
7. **أحدث الملفات المضافة (يوليو 2026):** `AGENTS.md` (دليل سير العمل محدّث بأقسام:
   بايبلاين البيانات الموحّد، فلتر السيولة الصارم، MACD + Candlestick، الـ Single-Viewport،
   الأدوات المساعدة، نزع الألغام)، `DEPLOYMENT_GUIDE.md` (سكربتات مساعدة + cron + إصلاح DBs
   + حقن بيانات + توثيق تلقائي + استكشاف أخطاء).

### أوامر سريعة للساندبوكس

```bash
# تشغيل/إيقاف/حالة
./.zscripts/start-watchdog.sh --start
./.zscripts/start-watchdog.sh --stop
./.zscripts/start-watchdog.sh --status

# السجلات
tail -50 dev.log                    # Next.js
tail -50 python_backend.log         # Python
tail -50 .zscripts/watchdog.log     # watchdog

# فحص سريع
curl -s http://localhost:3000/api/health          # Next.js health
curl -s http://localhost:8010/health               # Python health
```

---

## 🏗️ الـ PROJECT_BLUEPRINT (إعادة بناء شامل) — PROJECT-BLUEPRINT-019

> **الملف:** `PROJECT_BLUEPRINT.md` (جذر المشروع، ~1400 سطر، 18 قسم).
> **الهدف:** "تأمين كامل على المشروع" — لو ضاع المستودع بالكامل، هذا الملف يُمكّنك من إعادة بناء المنصة من الصفر.

### الـ 18 قسم في الـ Blueprint

1. **نظرة عامة** — اسم/هدف/URL/إصدار/حجم الكود
2. **المعمارية** — 4 خدمات (Next.js:3000 + Python:8010 + Data Engine:5000 + WS:3005) + Caddy:81 + Ollama:11434
3. **بنية المجلدات** — شجرة كاملة لكل ملف (src + vps-service + data_engine + scripts + prisma + public + content + db)
4. **التقنيات** — Frontend (Next.js 14.2.28 + React 18 + TS + Tailwind 3 + shadcn/ui + lightweight-charts + Prisma 5.22) + Backend (Python 3.12 + Flask + numpy + pandas + Telethon + tradingview_ta + Ollama) + Infrastructure (SQLite WAL + Caddy + PM2 + Bun)
5. **قواعد البيانات** — 8 DBs (stocks/price_history/data_engine/predictions/auth/intraday/news/custom) + جداولها + علاقاتها
6. **API Endpoints** — 53 Flask blueprint + ~470 Next.js route + أهم endpoints
7. **محركات التحليل** — 100+ محلل + الـ 3 محركات الرئيسية (MasterAnalyzer/CoreScoringEngine/MaestroOrchestrator)
8. **الـ 8 Layers Confluence** — Post-Tuning (max 138 pts, BUY ≥ 68, win_rate 66.61%)
9. **RAG AI Pipeline** — boost +10 / veto -15 (historical_trades table)
10. **حماية DBs** — WAL + busy_timeout 30s + auto-repair + cron يومي 3 ص
11. **السكربتات** — 136 سكربت مصنّفة (DB Safety + Data + Backtest + Migration + Repair + Run/Deploy + Cleanup + Verify + Seed + Test + Sync + Import + Patch + Generate)
12. **متغيرات البيئة** — كل الـ env vars (placeholders فقط — لا قيم حقيقية)
13. **خطوات إعادة البناء من الصفر** — 6 مراحل (clone + install + DBs + env + run + verify)
14. **التوثيق** — كل ملفات التوثيق (Documentation + AGENTS + CHANGELOG + DEPLOYMENT_GUIDE + PROJECT_BLUEPRINT + worklog)
15. **القواعد الذهبية** — 15 قاعدة ملزمة
16. **سجل المهام الكامل** — Task IDs من 11 إلى PROJECT-BLUEPRINT-019
17. **المراجع والمصادر** — GitHub + Production + المكتبات الخارجية
18. **الخاتمة** — النقاط الحرجة للتذكير

### الـ 8 Layers Tuning (Final — HISTORICAL-TEST-018 + PROJECT-BLUEPRINT-019)

| # | Layer | Max Pts (final) | strong-hit rate | ملاحظة |
|---|-------|-----------------|-----------------|--------|
| 1 | Macro Trend (regime) | 25 | 65.58% | unchanged |
| 2 | Price vs SMA50 | **18** | 70.62% | boosted (was 15) |
| 3 | RSI (Wilder) | 20 | 63.09% | unchanged |
| 4 | Volume | 20 | 65.87% | unchanged |
| 5 | Bollinger Bands | **15** | 36.48% | cut (was 20 — underperforming) |
| 6 | **MACD** | **18** | **79.53%** | top (was 15) |
| 7 | Candlestick Patterns | 10 | 60.64% | NEW |
| 8 | Fibonacci Confluence | **12** | 73.58% | boosted (was 10) |
| **+ Sector Boost (+5)** | خدمات المستهلك / مستهلك غير معمرة / تجارة التجزئة | | win_rate 77-84% |
| **+ Sector Penalty (-5)** | خدمات التوزيع / الخدمات التجارية / خدمات التكنولوجيا | | قلّل الإشارات الخاسرة |
| **+ Regime Boost (+5/+3)** | bull_trend / ranging | | ranging 71.46% |
| **+ Regime Penalty (-10)** | bear_trend (aggressive veto) | | bear 45% → 59% |
| **Total max** | **138 pts** | | |
| **BUY threshold** | **68** (was 65) | | |
| **Comprehensive win_rate (50 EGX × 90d)** | **66.61%** | target 65% | ✅ MET (+1.61) |
| **Unified pipeline win_rate (9 tickers × 90d)** | **71.65%** | target 55% | ✅ MET (+16.65) |

### الـ Tuning Constants (في `scripts/backtest_unified_pipeline.py`)

```python
BUY_THRESHOLD = 68    # was 65
HOLD_THRESHOLD = 45

SECTOR_BOOST = {
    'خدمات المستهلك': 5,
    'مستهلك - غير معمرة': 5,
    'تجارة التجزئة': 5,
}

SECTOR_PENALTY = {
    'خدمات التوزيع': -5,
    'الخدمات التجارية': -5,
    'خدمات التكنولوجيا': -5,
}

REGIME_BOOST = {
    'bull_trend': 5,
    'ranging': 3,
}

REGIME_PENALTY = {
    'bear_trend': -10,  # aggressive veto
}
```

### خطوات إعادة البناء السريع (مرجع كامل في `PROJECT_BLUEPRINT.md` قسم 13)

```bash
# 1. استنساخ
git clone https://github.com/enmohsen20111975/GLMinvestment.git
cd GLMinvestment

# 2. تثبيت
bun install                          # postinstall: prisma generate + patch-html2canvas
pip3 install -r vps-service/requirements.txt

# 3. قواعد البيانات
bunx prisma db push --schema=prisma/predictions-schema.prisma
unzip db/stocks.db.zip -d db/         # (لو الـ DBs مش موجودة)
unzip db/data_engine.db.zip -d db/
unzip db/price_history.db.zip -d db/
python3 scripts/init_db_safety.py    # WAL + busy_timeout

# 4. البيئة
cp .env.example .env
nano .env                            # املأ القيم الحقيقية

# 5. التشغيل
pm2 start ecosystem.config.js        # للإنتاج
# أو
./.zscripts/start-watchdog.sh --start  # للساندبوكس

# 6. التحقق
curl -s http://localhost:3000/api/health
curl -s http://localhost:8010/health
```

> ⚠️ **مهم:** لأي تعديل جوهري، اقرأ `PROJECT_BLUEPRINT.md` أولاً. هذا الملف هو "بوليصة التأمين" على المشروع.
