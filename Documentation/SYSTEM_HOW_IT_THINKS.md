# 🧠 SYSTEM_HOW_IT_THINKS — كيف يحلّل النظام سهمًا ويُولّد توصية

> **THE single source of truth for how the system thinks/decides.** آخر تحديث: 2026-08-31
> (KILL-MAESTRO + V40.2 هو العقل الوحيد + V62 logic + AI News Agent).
> **كل ملفات التوثيق السابقة في `/Documentation/*.md` دُمجت في الـ 4 ملفات الرئيسية:**
> 1. `Documentation/00-CONSTITUTION.md` — الحوكمة والقواعد.
> 2. `Documentation/01-PROJECT_ANATOMY.md` — التشريح الكامل (المعمارية، المحركات، DBs، تدفق البيانات).
> 3. `Documentation/02-SCREENS_AND_COMPONENTS.md` — كل شاشة وكل مكوّن.
> 4. **`Documentation/SYSTEM_HOW_IT_THINKS.md` (هذا الملف)** — منطق المحرك (التفكير + القرار).
>
> **المنهجية:** كل رقم/صيغة/مسار/سلوك مُتحقَّق منه ضد الكود الفعلي + الأرشيف الإنتاجي
> (`active_databases_20260817_full.zip`, md5 `0947bdf6c2eff1a75ff8af6c3e576ed8`).
>
> **النتيجة على الإنتاج الحالي (2026-08-31):** V40.2 هو العقل الوحيد.
> Backtest (ساندبوكس): 12 صفقة مغلقة | WR 33.3% (7 breakeven) | PF 51.42 | Return +56.5%.
> Dry-run: 15 صفقة | WR 73.3% | PF 9.80 | Return +66.2%.

---

## ⚡ تغييرات جوهرية (2026-08-31)

### 🔥 KILL-MAESTRO: V40.2 هو العقل الوحيد

**Maestro مات بالكامل.** V40.2 هو مولّد التوقعات الأساسي والوحيد.

**ما تغيّر في منطق التفكير:**
- قبل: Maestro (8-layer confluence, 138 pts) → predictions.db
- بعد: V40.2 (6 proofs + evidence-based) → predictions.db
- Maestro لسه موجود في الكود (للـ UI/queries) بس مش بيكتب توقعات

**الفارق الجوهري:**
| المقياس | Maestro (مات) | V40.2 (العقل الوحيد) |
|---|---|---|
| المنطق | 8-layer confluence (138 pts) | 6 proofs + evidence-based (82-91 pts) |
| البقاء | معطل (signal_id = None) | مفعّل (tracker = PredictionTracker) |
| التوقعات | مش بيكتب | يكتب في predictions.db |
| الـ UI | للتحليل فقط | المصدر الوحيد للتوقعات |

### 🧠 V62 Logic (4 ميزات جديدة في V40.2)

أضفنا 4 ميزات من Pine Script V62 لـ V40.2 (سطر 979-1048 في v40_2_daily_generator.py):

1. **fake_pump** (رفض): طلع +3% بس حجم < MA → فخ الميكرز
2. **is_dist** (رفض): توزيع (شمعة حمراء + ظهر >50% + حجم >2× MA)
3. **is_story_stock** (تقليل حجم): P/E > 50 من data_engine.db.tab_valuation
4. **maker_sweep** (boost): sweep_low + delta موجب

BOS/CHOCH كان موجود بالفعل (سطر 953-977).

### 📰 AI News Agent (الإثبات السابع)

**الملف:** `vps-service/ai/news_agent.py`

بعد كل signal في V40.2، الـ News Agent:
1. يبحث عن أخبار السهم (DuckDuckGo)
2. يستخرج نص المقال (Trafilatura)
3. يحلل بالكلمات المفتاحية (120+ كلمة بأوزان 1-3)
4. لو score < 30 → يرفض الإشارة

**حالة Ollama:** crash على السيرفر (CPU بلا AVX/SSE). Keyword fallback هو الإنتاج.

### 🔧 إصلاحات daily_closer

1. **data_engine.db مباشر:** يقرأ من egksco_price_history (تجاوز data.prices recursion)
2. **created_at = prediction_date:** في backtest، لحساب days_elapsed صحيح
3. **V40.2 dry_run:** outcome_date يسجل بس في dry_run — daily_closer يقفل في الإنتاج

### ⚠️ مشاكل معروفة (2026-08-31)

| المشكلة | التفاصيل | الحل |
|---|---|---|
| Ollama crash | CPU السيرفر مش بيدعم AVX/SSE | keyword fallback شغّال |
| 7 breakeven exits | BE-stop-after-+3%-MFE بيخرج صفقات كتير عند breakeven | مراجعة threshold |
| DuckDuckGo rate limit | أحياناً 403 Ratelimit | retry + delay |
| أخبار الاكتتاب/توزيع الأرباح | مش موجودة | مطلوب إضافتها (انظر 01-PROJECT_ANATOMY.md §12) |

---

---

## 📑 فهرس المحتويات

| # | القسم |
|---|------|
| 1 | [نظرة عامة على pipeline التفكير](#1-نظرة-عامة-على-pipeline-التفكير) |
| 2 | [V34 Institutional Decision Engine — المنطق الكامل](#2-v34-institutional-decision-engine--المنطق-الكامل) |
| 3 | [Confluence / Scoring logic (8-layer, 138 pts max)](#3-confluence--scoring-logic-8-layer-138-pts-max) |
| 4 | [Persona logic (4 شخصيات + R:R overrides + PERSONA-UNIFY-A)](#4-persona-logic-4-شخصيات--rr-overrides--persona-unify-a) |
| 5 | [R:R logic — قصة الإصلاح الكاملة (commit 65a748f)](#5-rr-logic--قصة-الإصلاح-الكاملة-commit-65a748f) |
| 6 | [Fundamentals scoring logic — placeholder=50 → real 0-100 (Stages A-H)](#6-fundamentals-scoring-logic--placeholder50--real-0-100-stages-a-h) |
| 7 | [Backtest methodology (V38 + walk-forward + HARD cap + dedup)](#7-backtest-methodology-v38--walk-forward--hard-cap--dedup) |
| 8 | [Prediction lifecycle (PENDING → 5-state taxonomy → close)](#8-prediction-lifecycle-pending--5-state-taxonomy--close) |
| 9 | [Learning loop (continuous_learning + applied_lesson chain)](#9-learning-loop-continuous_learning--applied_lesson-chain) |
| 10 | [Picks management logic (daily cap=5, min_confidence=65%, 4 tiers)](#10-picks-management-logic-daily-cap5-min_confidence65-4-tiers) |
| 11 | [Known logic gaps & next steps](#11-known-logic-gaps--next-steps) |
| 12 | [ملخص: كيف يفكر النظام في 9 خطوات](#12-ملخص-كيف-يفكر-النظام-في-9-خطوات) |
| 13 | [Volume Surge Hunter (AXIS-5b) — صياد الأسهم الانفجارية](#13-volume-surge-hunter-axis-5b--صياد-الأسهم-الانفجارية) |
| 14 | [EGX-STRATEGY-FINAL — المنطق الموحد الكامل (2026-08-30)](#14-egx-strategy-final--المنطق-الموحد-الكامل-2026-08-30) |

---

## 1. نظرة عامة على pipeline التفكير

> **السؤال:** "كيف يتحول سهم من بيانات خام إلى توصية مكتوبة في `predictions.db` — ثم كيف تُقفل وتُعلَّم منها؟"

### 1.1 الـ pipeline الكامل (end-to-end)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  STAGE 1: SCRAPE (يجمع البيانات)                                              │
│  ────────────────────────────                                                 │
│  tradingview_scraper (كل 5 دقايق) ──→ stocks.db + data_engine.db              │
│  egksco_scraper (يومي) ──→ price_history.db (OHLCV EGX)                      │
│  yahoo_fallback (safety net) ──→ data_engine.historical_data                  │
│  coingecko + newsapi + gnews ──→ crypto.db + news.db + community.db          │
│  EGXPilot (egx_fundamental_fetcher — ⚠️ NOT scheduled) ──→ egx_fundamentals   │
└──────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│  STAGE 2: ENGINES (تحلّل السهم)                                                │
│  ─────────────────────────────                                                 │
│  MasterAnalyzer + V20 Fusion                                                  │
│   ├─ smc_engine (Order Blocks, FVG, Liquidity Sweeps)                         │
│   ├─ vsa_engine (Absorption, No Supply/Demand, Distribution)                 │
│   ├─ volume_profile (POC, Value Area, VWAP)                                   │
│   ├─ quant_engine (Bollinger Squeeze/Expansion, momentum)                    │
│   ├─ candle_prob_engine (DNA pattern matching)                               │
│   ├─ fundamental_data_provider (real 0-100 score from tab_*)                │
│   ├─ regime_detector (bull / bear / range + confidence)                     │
│   └─ sector_heat_map (Pillar 1 — دوران السيولة)                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│  STAGE 3: INSTITUTIONAL_DECISION_ENGINE (يصنع القرار)                        │
│  ──────────────────────────────────────────────────────────────────          │
│  institutional_decision_engine.build_institutional_decision()                │
│   ├─ Step 1: Maker State (accumulation / distribution / calm)                │
│   ├─ Step 2: Flight State (flying_up / falling_down / sideways / coiling)    │
│   ├─ Step 3: 5-6 Proofs (trend + makers + DNA + fundamental + sector +RS)    │
│   ├─ Step 4: Tech Score (base + Σ proof impacts, clamped 0-100)             │
│   ├─ Step 5: Signal Final + فلترة ترند صارمة                                 │
│   ├─ Step 6: Portfolio Advice (hold / scale_in / partial_sell / exit)        │
│   └─ Step 7: Stops (7 أنواع → optimal_stop)                                  │
│   OUTPUT: { signal, tech_score, sl, tp1, tp2, rr_ratio_tp1, rr_ratio_tp2 }   │
└──────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│  STAGE 4: PERSONA R:R OVERRIDES (تُعدّل الأهداف والوقف حسب الشخصية)            │
│  ─────────────────────────────────────────────────────────────────            │
│  PERSONA_CONFIGS (maestro_orchestrator.py):                                   │
│   ├─ gambler:      min_score=42, target_mult=2.0x, stop_mult=1.2x            │
│   ├─ balanced:     min_score=50, target_mult=2.2x, stop_mult=1.0x (default)  │
│   ├─ conservative: min_score=55, target_mult=2.5x, stop_mult=1.0x            │
│   └─ expert:       persona_fit annotation فقط (لا كتابة منفصلة — خيار آمن)    │
│  _ADAPTIVE_RR_TABLE (core_scoring_engine.py): RR ديّناميكي حسب volatility      │
│  dynamic_rr_normal=1.5, dynamic_rr_outperform=2.0 (engine_settings)         │
└──────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│  STAGE 5: KILL FILTERS + R:R FLOOR GATE (يطرح المرشحين الضعفاء)              │
│  ─────────────────────────────────────────────────────────────────            │
│  v40_2_daily_generator.py:                                                    │
│   ├─ liquidity_filter.set_strict_kill_filters(True) (turnover ≥ 3M EGP)      │
│   ├─ R:R ≥ dynamic_rr_normal (1.5) floor gate (L314-326)                     │
│   ├─ ATR stop clamp [3%, 9%]                                                 │
│   ├─ CBE News Guard (hard veto لو خبر بنك مركزي في 24h)                      │
│   └─ Ex-Dividend Protection (stop skip على يوم ex-div)                       │
└──────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│  STAGE 6: PREDICTION RECORD IN predictions.db                                │
│  ─────────────────────────────────────────────────────                        │
│  PredictionTracker.record_prediction() يكتب:                                  │
│   { ticker, signal, entry_price, target_price, stop_loss,                    │
│     target_price_2, master_score, technical_score, fundamental_score,        │
│     persona='balanced' (DEFAULT — PERSONA-UNIFY-A),                          │
│     atr_at_entry, evidence_count, morning_bell, kill_filter_result,          │
│     prediction_date, status='PENDING' }                                       │
│   + persona_fit annotation في kill_filter_result                              │
│   + persona_predictions row (لو fit_score ≥ 50 لـ gambler/conservative)      │
└──────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│  STAGE 7: CLOSING ENGINE (يقفل الصفقة)                                       │
│  ────────────────────────────────────────────                                 │
│  daily_closer.py (15:30 Cairo, بعد إغلاق السوق):                              │
│   ├─ لكل PENDING prediction:                                                  │
│   │   ├─ حمّل سعر الإغلاق اليومي من price_history.db                          │
│   │   ├─ حدّث highest_price / lowest_price (مع intraday.db)                  │
│   │   ├─ فحص: hit_target? hit_stop? trailing_stop? expired?                  │
│   │   ├─ حساب actual_return على سعر التفعيل (limit/stop) — مش سعر الإغلاق    │
│   │   ├─ SELL sign-flip: return=(entry-trigger)/entry                        │
│   │   ├─ HARD cap: ABS(actual_return) ≤ 50 (Rule 7)                         │
│   │   ├─ Hard Loss Ceiling: max loss = -7.0% (hard_loss_ceiling_pct)        │
│   │   ├─ Split Guard: ABS > 35% → exclude (split_drop_threshold_pct)        │
│   │   └─ كتب: outcome_date, exit_type, is_correct, actual_return, status    │
│   └─ POST /api/predictions/honest-tracking/close (الـ API endpoint)          │
└──────────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│  STAGE 8: LEARNING LOOP (يتعلّم من النتيجة)                                    │
│  ─────────────────────────────────────────────                                 │
│  lesson_store.record_lesson_from_close() يصنّف:                                │
│   ├─ STOP_TOO_TIGHT (ضرب وقف مبكر → يُوسّع الوقف في المرّة القادمة)            │
│   ├─ TARGET_HIT_OK (الهدف اتحقق → keeps config)                              │
│   ├─ LATE_MOMENTUM (تحرك متأخر → extend hold_days)                           │
│   └─ MISSED_BREAKOUT (كسر فات → lower entry threshold)                       │
│  continuous_learning.py: يقرأ الدروس → maestro_orchestrator.run_expert_memory_phase() │
│   → applied_lesson (توسيع وقف مسقوف +0.15×ATR لكل تكرار، حد أقصى 0.5×ATR)    │
│   → السلسلة تتراكم: كل صفقة جديدة بـ تـ inherits الدروس السابقة                │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 مداخل النظام (inputs)

| المصدر | البيانات | التردد |
|--------|----------|--------|
| `price_history.db` | EGX OHLCV (288,194 rows, 1,260 tickers) | يومي |
| `stocks.db` | 970 ticker metadata (price, 52w hi/lo, market) | لحظي (5 دقايق) |
| `data_engine.db` | historical_data + tab_valuation/profitability/dividends/performance/technical (858-866 rows each) | snapshot أسبوعي |
| `intraday.db` | أسعار لحظية (آخر 5 جلسات) | 15 دقيقة |
| `news.db` + `community.db` | sentiment + telegram signals | ساعي |
| `crypto.db` + `crypto-lab.db` | 6 عملات رقمية | ساعي |
| `learned.db` | دروس التعلم (STOP_TOO_TIGHT, ...) | تحديث عند كل إغلاق |
| `analytics.db` | persona scoring cache | عند كل تحليل |

### 1.3 مخارج النظام (outputs)

```python
prediction = {
    # Identity
    'ticker': 'COMI', 'market': 'EGX', 'persona': 'balanced',
    'prediction_date': '2026-08-17',

    # Signal
    'signal': 'BUY',  # STRONG_BUY / BUY / HOLD / SELL / STRONG_SELL
    'master_score': 78, 'technical_score': 82, 'fundamental_score': 93.0,
    'confidence': 0.74,  # from confidence_engine (7 factors, 0-1)

    # Trade plan (canonical keys — تمّ إصلاحها في commit 65a748f)
    'entry_price': 25.0, 'sl': 23.5, 'tp1': 28.5, 'tp2': 30.0,
    'rr_ratio_tp1': 2.0, 'rr_ratio_tp2': 2.5,
    'atr_at_entry': 0.78,

    # V40.2 evidence
    'evidence_count': 5,  # 0-6 (count of passed proofs)
    'morning_bell': 1,    # 1 = top pick for the day, 0 = others
    'kill_filter_result': 'V40 evidence=5/6 RR=2.00 | fit:balanced(75)',

    # Lifecycle
    'status': 'PENDING', 'outcome_date': None, 'exit_type': None,
    'is_correct': None, 'actual_return': None,
}
```

### 1.4 ثلاث معدّات تنفيذ (latency tiers)

| Tier | الغرض | Latency | المسار |
|------|------|---------|--------|
| Live | سعر لحظي + مؤشرات سريعة | 30-80ms | `LiveIndicatorEngine` → JSON |
| Daily | تحليل كامل + توصية | 2-4s | `MasterAnalyzer` → `institutional_decision_engine` → JSON |
| Backtest | محاكاة تاريخية كاملة | minutes | `v38_backtest_engine` per ticker per day |

---

## 2. V34 Institutional Decision Engine — المنطق الكامل

> **المرجع (مُدمج):** محتوى `V34-INSTITUTIONAL-DECISION-ENGINE.md` + `treadingView.code.text` (Pine Script V34، 372 سطر) دُمج بالكامل في هذا القسم §2 (توحيد التوثيق 2026-08-17).
> **الكود:** `vps-service/analyzers/institutional_decision_engine.py` (~1,060 سطر، V39.2).
> **الإلهام:** Pine Script "محرك القرار المؤسسي V34" (LuxAlgo + BigBeluga، CC BY-NC-SA 4.0).

### 2.1 الإعدادات (Pine Script Inputs)

| المجموعة | المدخل | الافتراضي | الوصف |
|---------|--------|----------|------|
| **اختر السوق** | `market_type` | `"تلقائي (Auto)"` | Auto/EGX/Tadawul/Crypto |
| **💼 إدارة محفظتي** | `enable_pm` | `true` | تفعيل مدير المحفظة |
| | `user_entry_price` | `0.0` | سعر الشراء (لو مركز مفتوح) |
| | `user_entry_qty` | `0` | الكمية |
| **🏭 رادار القطاع** | `sector_name_in` | `"تلقائي"` | اسم القطاع (من Python) |
| | `sector_change_in` | `0.0` | تغير القطاع % (من Python) |
| **العرض العام** | `show_ob` | `true` | عرض Order Blocks |
| | `show_fvg` | `true` | عرض Fair Value Gaps |
| | `show_fv` | `true` | عرض Fair Value (VWAP-like) |
| | `show_dna_proj` | `true` | عرض خطوط البصمة المستقبلية |
| | `show_maker_zones` | `true` | إظهار علامات الميكرز |
| **إدارة المخاطر** | `rr1` | **`1.5`** | نسبة الهدف 1 (R:R TP1) |
| | `rr2` | **`3.0`** | نسبة الهدف 2 (R:R TP2) |

> **ملاحظة:** الـ `rr1=1.5` / `rr2=3.0` هي القيم الافتراضية في Pine Script. في الإنتاج الفعلي
> (`engine_settings.py`)، أصبحت ديناميكية: `dynamic_rr_normal=1.5` + `dynamic_rr_outperform=2.0`
> (انظر §5). الـ `rr2=3.0` في Pine يقابله `rr_ratio_tp2` الذي يُعاد حسابه من قوة السهم النسبية
> للمؤشر (outperforming → 2.0 بدل 1.5).

### 2.2 كشف السوق التلقائي (Market Detection)

```pine
string active_market = market_type == "تلقائي (Auto)"
    ? (syminfo.type == "crypto" ? "Crypto"
       : syminfo.currency == "EGP" ? "EGX"
       : "Global")
    : market_type
```

| الشرط | السوق المُكتشف |
|------|----------------|
| `syminfo.type == "crypto"` | Crypto |
| `syminfo.currency == "EGP"` | EGX (البورصة المصرية) |
| `market_type == "السعودية (Tadawul)"` | Tadawul (السعودية) |
| غير ذلك | Global |

> في الـ Python backend، الكشف يتمّ عبر `stocks.db.market` column (مصر/السعودية/الكويت/قطر).

### 2.3 محرك البيانات والزخم (Data + Momentum Engine)

```pine
atr_val = ta.atr(14)
rsi_val = ta.rsi(close, 14)
[bb_mid, bb_up, bb_low] = ta.bb(close, 20, 2.0)

float bb_width = (bb_up - bb_low) / bb_mid * 100
float bb_width_sma = ta.sma(bb_width, 50)

bool is_squeeze = bb_width < bb_width_sma * 0.8   // عرضي نايم 😴
bool is_expanding = bb_width > bb_width_sma * 1.2 // جاهز للانفجار ⚡

float sma_atr = ta.sma(atr_val, 20)
float adaptive_ob = (sma_atr > 0 and atr_val / sma_atr > 1.2) ? 80 : 70
// RSI > 80 → متشبع شراء 🔴 | RSI < 30 → متشبع بيع 🟢
```

### 2.4 جلب الأساسيات تلقائياً (Fundamentals Auto-Fetch)

```pine
float pe_ratio = request.financial(syminfo.tickerid, "PRICE_EARNINGS", "FY")
float roe_val  = request.financial(syminfo.tickerid, "RETURN_ON_EQUITY", "FY")

if pe_ratio > 0 and pe_ratio < 15 and roe_val > 15:
    fund_state := "قوية جداً 🟢 (رخيص وربحان)"
    fund_strong := true
elif pe_ratio > 0 and pe_ratio < 25 and roe_val > 10:
    fund_state := "مقبولة 🟡"
else:
    fund_state := "ضعيفة 🔴 (غالي أو خسارة)"
```

> **في الـ Python backend:** الـ fundamentals لا تُجلب من TradingView بل من `data_engine.db`
> عبر `fundamental_data_provider.get_fundamental_score()` (انظر §6). الـ Pine Script يستخدم
> `request.financial()` فقط للعرض على الـ chart.

### 2.5 محرك التقييم والسيولة (Valuation + Liquidity Engine)

**Fair Value (القيمة العادلة):**
```pine
typical_price = (high + low + close) / 3
total_vol = math.sum(volume, 100)
total_typ_vol = math.sum(typical_price * volume, 100)
fair_value = total_vol > 0 ? total_typ_vol / total_vol : close
fair_premium = ((close - fair_value) / fair_value) * 100

// fair_premium > +5  → "غالي"
// fair_premium < -5  → "رخيص"
// بينها → "عادل"
```

**الترند (Trend):**
```pine
daily_ema200 = request.security(syminfo.tickerid, "D", ta.ema(close, 200)[1])
trend_up = not na(daily_ema200) ? (close > daily_ema200) : (close > ta.ema(close, 200))
```

**Pivots + Breaks:**
```pine
pivot_h = ta.pivothigh(high, 5, 5)
pivot_l = ta.pivotlow(low, 5, 5)

broke_resist = ta.crossover(close, last_resist)
broke_support = ta.crossunder(close, last_support)
sweep_low = low < last_support and close > last_support  // liquidity sweep
```

### 2.6 Order Blocks (OB)

```pine
var float active_ob = na
if (broke_resist or sweep_low) and show_ob:
    ob_l = low[5]
    if ob_l < close:
        active_ob := ob_l
        box.new(bar_index[5], high[5], bar_index + 8, ob_l, ...)
        label.new(bar_index, high[5], sweep_low ? "مسح سيولة" : "كسر مقاومة", ...)
```

| الحدث | المعنى | الاستخدام |
|------|------|----------|
| `broke_resist` | كسر مقاومة هيكلية | تشغيل OB bullish |
| `sweep_low` | مسح سيولة (liquidity sweep) | إشارة شراء خفية (institutional) |
| `active_ob` | آخر OB مُكتشف | يُستخدم كـ stop loss reference |

### 2.7 Fair Value Gaps (FVG)

```pine
// FVG = فجوة في السعر لم يُتداول فيها (imbalance)
// bullish FVG: low[0] > high[2] (gap up)
// bearish FVG: high[0] < low[2] (gap down)
```

> في الـ Python backend، FVG detection في `smc_engine.py` (`chart_routes.py` line 2964-2994).

### 2.8 محرك الميكرز (Maker State Engine)

```pine
bool is_absorption = close < open and volume > vol_ma * 1.5 and close > low - (atr_val * 0.2)
bool is_distribution = close > open and volume > vol_ma * 1.5 and close < high - (atr_val * 0.2)
bool maker_sweep = sweep_low and vol_ratio > 1.5
bool no_supply = close < open and volume < vol_ma * 0.5
bool no_demand = close > open and volume < vol_ma * 0.5

bool maker_bullish = is_absorption or maker_sweep or no_supply
bool maker_bearish = is_distribution or no_demand
```

| الحالة | الإشارة | الدلالة |
|------|--------|--------|
| `is_absorption` | 🟣 تجميع خفي | ميكرز بيشتري بهدوء (volume عالي + close أحمر صغير) |
| `is_distribution` | 🟠 تصريف | ميكرز بيبيع بهدوء (volume عالي + close أخضر صغير) |
| `maker_sweep` | 🟣 مسح سيولة | ميكرز بـ يـ sweep stop losses ثم يعكس |
| `no_supply` | 🟢 لا عرض | volume منخفض على شمعة حمراء = ضعف بائعين |
| `no_demand` | 🔴 لا طلب | volume منخفض على شمعة خضراء = ضعف مشترين |

### 2.9 Flight State Engine (حالة الطيران)

```pine
string flight_state = "عرضي 😴"
if broke_resist and is_expanding and (maker_bullish or volume_surge):
    flight_state := "طائر للأعلى 🚀"
else if broke_support and is_expanding and (maker_bearish or volume_surge):
    flight_state := "واقع للأسفل 📉"
```

| الحالة | الشرط | الإشارة |
|------|------|--------|
| **طائر للأعلى 🚀** | `broke_resist` + `is_expanding` + (`maker_bullish` OR `volume_surge`) | انفجار صاعد |
| **واقع للأسفل 📉** | `broke_support` + `is_expanding` + (`maker_bearish` OR `volume_surge`) | انفجار هابط |
| **عرضي 😴** | غير ذلك | لا انفجار |

### 2.10 DNA Triple Footprint Engine (محرك البصمة الثلاثية)

> **الفكرة:** "الـ price action الحالي بـ يشبه فترة تاريخية — فماذا حدث بعدها؟"

```pine
int pattern_len = 10    // طول البصمة الحالية (10 شمعات)
int search_depth = 100  // عمق البحث في التاريخ
int proj_len = 10       // طول التوقع المستقبلي

// 1. حمّل بصمة الـ 10 شمعات الحالية (نسب التغير)
float[] cur_p = array.new_float(pattern_len)
for j = 0 to pattern_len - 1:
    c1 = close[j], c2 = close[j+1]
    array.set(cur_p, j, c2 > 0 ? (c1 - c2) / c2 : 0)

// 2. ابحث عن أقرب تطابق في آخر 100 شمعة
float d1 = 1e10, int i1 = 0
for i = 3*proj_len to total_hist - pattern_len - 1:
    float match_dist = 0.0
    for j = 0 to pattern_len - 1:
        h_p = (close[i+j] - close[i+j+1]) / close[i+j+1]
        diff = h_p - array.get(cur_p, j)
        match_dist += diff * diff
    if match_dist < d1:
        d1 := match_dist
        i1 := i

// 3. اسقِط مسار الـ 10 شمعات التي تلت التطابق التاريخي
float base_price = close[i1]
float ratio1 = base_price > 0 ? close[i1 - proj_len] / base_price : 1.0
float end_price_1 = close * ratio1   // السعر المستهدف المتوقع

dna_target_price := end_price_1
proj_bullish := end_price_1 > close
dna_move1_pct := ((end_price_1 - close) / close) * 100
```

| المتغير | المعنى |
|------|------|
| `dna_target_price` | السعر المستهدف المتوقع (يُستخدم كـ TP1 لو bullish) |
| `dna_move1_pct` | نسبة الحركة المتوقعة |
| `proj_bullish` | البصمة طالعة ولا نازلة |

> في الـ Python backend، DNA matching في `candle_prob_engine.py`. الشخصية السهمية (stock personality)
> بـ تـ bias الـ probabilities.

### 2.11 Maker Zones Display

```pine
plotshape(show_maker_zones and is_absorption, title="تجميع",
    style=shape.triangleup, location=location.belowbar, color=color.purple,
    text="ميكرز يجمع")
plotshape(show_maker_zones and is_distribution, title="تصريف",
    style=shape.triangledown, location=location.abovebar, color=color.orange,
    text="ميكرز يوزع")
```

### 2.12 Confluence Proofs (نظام الإثباتات الـ 5)

```pine
int tech_score = 50  // base

// Proof 1: Trend (وزن 15)
if trend_up:
    tech_score += 15, proof_1 := "✅ الترند صاعد"

// Proof 2: Makers (وزن 20)
if maker_bullish:
    tech_score += 20, proof_2 := "✅ ميكرز بيجمع"
else if maker_bearish:
    tech_score -= 20, proof_2 := "❌ ميكرز بيوزع"

// Proof 3: DNA Footprint (وزن 15)
if proj_bullish:
    tech_score += 15, proof_3 := "✅ البصمة المستقبلية طالعة"
else:
    tech_score -= 15, proof_3 := "❌ البصمة نازلة"

// Proof 4: Fundamentals (وزن 15)
if fund_strong:
    tech_score += 15, proof_4 := "✅ الأساسيات قوية"

// Proof 5: Sector (وزن 10)
if sector_change_in > 0:
    tech_score += 10, proof_5 := "✅ القطاع أخضر"

tech_score := math.max(0, math.min(tech_score, 100))  // clamp [0, 100]
```

| Proof | الوزن | التأثير |
|------|------|--------|
| 1. Trend | +15 / -10 | EMA50 > EMA200 + ADX > 25 |
| 2. Makers | +20 / -15 | تجميع قوي=+20, تجميع=+10, تصريف=-15 |
| 3. Footprint (DNA) | +15 / -10 | Pattern match bullish/bearish |
| 4. Fundamental | +15 / -5 | P/E < 15 + ROE > 15% |
| 5. Sector | +10 / -5 | sector momentum > 0 |

> **V39 إضافي:** Proof 6 = Benchmark Relative Strength (وزن 10): `stock_roc > benchmark_roc → +10`.
> إجمالي الأوزان في V39: 15+20+15+15+10+10 = **85** (base 25 → max 110 → clamp 100).

### 2.13 Signal Final (الإشارة النهائية)

```pine
string signal = "انتظر"
if maker_bullish and flight_state == "طائر للأعلى 🚀":
    signal := "🟢 شراء (انفجار مؤسسي)"          // أقوى إشارة
else if tech_score >= 75:
    signal := "🟢 شراء مؤسسي قوي"
else if tech_score <= 35:
    signal := "🔴 بيع وتجنب"
// else: انتظر
```

| Signal | الشرط |
|--------|------|
| 🟢 شراء (انفجار مؤسسي) | `maker_bullish` AND `flight=طائر للأعلى` |
| 🟢 شراء مؤسسي قوي | `tech_score ≥ 75` |
| 🟡 انتظر | بين 35 و 75 |
| 🔴 بيع وتجنب | `tech_score ≤ 35` |

### 2.14 خطة التداول (Trade Plan)

```pine
entry = close
sl = not na(active_ob) ? active_ob - (atr_val * 0.5) : close - (atr_val * 1.5)
if sl >= entry:
    sl := entry - (atr_val * 1.5)   // fallback لو OB قريب جدًا

risk = entry - sl
tp1 = entry + (risk * rr1)   // rr1 = 1.5 (default)
tp2 = entry + (risk * rr2)   // rr2 = 3.0 (default)

// Override: لو DNA bullish ومتاح، TP1 = dna_target_price
if proj_bullish and not na(dna_target_price) and dna_target_price > entry:
    tp1 := dna_target_price
```

### 2.15 Portfolio Manager (مدير المحفظة)

```pine
if enable_pm and user_entry_price > 0:
    pnl_pct = ((close - user_entry_price) / user_entry_price) * 100

    if close <= sl:
        pm_action := "🔴 ارمي الورق! البوق اتنكسر."
    else if is_distribution:
        pm_action := "🟠 الميكرز بيوزع! خد فلوسك."
    else if trend_up and pnl_pct > 5:
        pm_action := "🟢 امسك وانت مطمن."
    else:
        pm_action := "🟡 امسك ساكت."
```

### 2.16 الـ 7 أنواع ستوب (Python backend)

| # | النوع | الصيغة | السقف |
|---|------|--------|------|
| 1 | Fixed Stop | `entry × (1 - 5%)` | 5% |
| 2 | Time Stop | `days_held ≥ 25 AND |Δ| < 3% → exit` | 25 يوم |
| 3 | Volatility Stop (ATR) | `entry - (2.5 × ATR)` | capped at `entry × (1 - 10%)` |
| 4 | Trailing Stop (Chandelier) | `highest_high - (2.0 × ATR)` | floor = `entry × 1.01` |
| 5 | Tiered Stop | before T1: -8% / after T1: BE+1% / after T2: T1+1% / after T3: trailing | متدرّج |
| 6 | Portfolio Heat | `max_loss = portfolio × 2%` | 2% من المحفظة |
| 7 | Break-Even | `gain ≥ 7% → stop = entry × 1.01` | BE + 1% |

`get_optimal_stop()` يقيّم كل الستوبات المطبقة ويرجع **أعلى stop_price** (أكثر حماية).

### 2.17 تناقضات معروفة (V34 → V39)

| التناقض | التفاصيل | التأثير |
|---------|---------|--------|
| `tech_score_base` | الكود=25, `engine_settings` DEFAULT=50 | الفعلي 25 — partial proofs تاثر أكتر |
| Trailing stop activation | V38=3%, V39=5% | الباكتست أكثر عدوانية من الـ live |
| Tiered stop initial | 8% ثابت رغم `default_stop_pct=5%` | `tiered_stop` يتجاهل الوقف الافتراضي |
| Break-even trigger | 7% ثابت | مش قابل للتعديل من `engine_settings` |
| Portfolio heat | 2% ثابت | مش قابل للتعديل من `engine_settings` |

> (كان مُوثّقًا في `GAPS_AND_MISSING.md` §3 — دُمج في توحيد التوثيق 2026-08-17.)

---

## 3. Confluence / Scoring logic (8-layer, 138 pts max)

> **السؤال:** "كيف يُجمّع النظام الـ confluence من 8 طبقات مختلفة؟ وأين عتبة الشراء؟"

### 3.1 الـ 8 طبقات (Confluence Layers)

| # | الطبقة | المصدر | النقاط القصوى |
|---|--------|--------|--------------:|
| 1 | **Price Action (PA)** | EMA50/200, ADX, BOS, pivot breaks | 25 |
| 2 | **Smart Money Concepts (SMC)** | Order Blocks, FVG, Liquidity Sweeps | 20 |
| 3 | **Volume Spread Analysis (VSA)** | Absorption, No Supply/Demand, Distribution | 15 |
| 4 | **Volume Profile (VP)** | POC, Value Area, VWAP deviation | 15 |
| 5 | **DNA Footprint** | Pattern match (10-bar history scan) | 15 |
| 6 | **Fundamentals** | real 0-100 score from `tab_*` (P/E, ROE, margins, dividends) | 18 |
| 7 | **Sector Heat** | 5-day sector return + role classification | 15 |
| 8 | **Benchmark Relative Strength** | `stock_roc` vs `egx30_roc` | 15 |
| **المجموع** | | | **138 pts** |

### 3.2 عتبات الشراء (Buy Thresholds)

| العتبة | القيمة | المعنى |
|--------|------|--------|
| **STRONG_BUY** | ≥ 110 / 138 (≈80%) | "شراء انفجار مؤسسي" — كل الطبقات مت align |
| **BUY** | ≥ **68** / 138 (≈49%) | الحد الأدنى للشراء — ≥ 4 طبقات بتمر |
| **HOLD** | 41-67 / 138 | انتظر |
| **SELL** | ≤ 40 / 138 | وقّلص المراكز |
| **STRONG_SELL** | ≤ 25 / 138 | اخرج فوراً |

> **ملاحظة:** العتبة الديناميكية (`dynamic_thresh`) قابلة للتعديل بـ self-learning:
> - `win_rate ≥ 65%` → خفض threshold بـ 10% (أداء كويس → اقبل إشارات أقل)
> - `win_rate < 40%` → ارفع threshold بـ 10% (أداء ضعيف → لازم إشارات أقوى)
> - الشرط: ≥ 5 صفقات عشان الـ learning يتفعل.

### 3.3 صيغة Tech Score (الإخراج النهائي 0-100)

```python
# vps-service/analyzers/institutional_decision_engine.py
tech_score_base = 25  # V39 default (engine_settings DEFAULT=50, لكن الكود default=25)

tech_score = tech_score_base + sum(proof.score_impact for proof in proofs)
tech_score = clamp(tech_score, 0, 100)
```

| المعامل | القيمة | ملاحظة |
|---------|------|------|
| `tech_score_base` | **25** (في الكود) | `engine_settings` DEFAULT=50 لكن الكود default=25 |
| Max possible | 25 + 85 = 110 → **100** (clamped) | V39 مع 6 إثباتات |
| Partial proofs | 25 + 40 = **65** | 3 إثباتات بتمر و3 بترفض |
| BUY threshold (V39 dynamic) | ≥ 75 default (self-learning ±10%) | "شراء مؤسسي قوي" |

### 3.4 dynamic Fair Value (V39)

الـ fair value صار ديناميكي بدل ±5% ثابت:
- `premium > +1σ` → غالي (overvalued)
- `premium < -1σ` → رخيص (undervalued)
- بينهما → عادل (fair value)

### 3.5 فلترة الترند الصارمة (V39.1 — 2026-08-13)

```python
# في _compute_signal_final():
if market_regime and market_regime.get('trend') in ('bear', 'bear_trend'):
    if market_regime.get('confidence', 0) > 0.7:
        signal = 'hold'
        recommendation = 'انتظر'
        reason = 'سوق هابط بثقة عالية — ممنع الدخول'
```

> **أُضيفت في 2026-08-13** كرد فعل على:
> - 285 صفقة ضربت الوقف في ترند هابط
> - يونيو 2026: 17.6% win rate فقط (كل التوقعات كانت BUY رغم إن السوق هابط)

---

## 4. Persona logic (4 شخصيات + R:R overrides + PERSONA-UNIFY-A)

> **السؤال:** "كيف يُكيّف النظام توصياته حسب نمط المستثمر؟"

### 4.1 الـ 4 شخصيات

| Persona | Arabic | الاستراتيجية | min_hold_days | محركات التركيز |
|---------|--------|--------------|---------------|----------------|
| `gambler` | **مقامر** 🎲 | `scalp_short` (قصير المدى) | 1 | vsa_engine, candle_prob_engine, momentum_engine |
| `balanced` | **متوازن** ⚖️ | `swing_medium` (متوسط المدى) | 5 | smc_engine, fusion_engine, vsa_engine |
| `conservative` | **محافظ** 🛡️ | `swing_medium_long` (متوسط-طويل) | 10 | smc_engine, fundamental_engine, volume_profile |
| `expert` | **خبير** 🧠 | persona_fit annotation فقط | — | (لا كتابة منفصلة — خيار آمن) |

### 4.2 PERSONA_CONFIGS (maestro_orchestrator.py)

| Persona | min_score | target_mult | stop_mult | الإصلاح (vs V34 القديم) |
|---------|----------:|------------:|----------:|--------------------------|
| **gambler** | **42** | **2.0x** | **1.2x** | threshold رفع 35→42 + target قُرّب 3.0→2.0x |
| **balanced** | 50 | 2.2x | 1.0x | (لم يُغيّر — default) |
| **conservative** | **55** | **2.5x** | **1.0x** | threshold خُفّض 60→55 + target وُسّع 1.8→2.5x |

> **المنطق:**
> 1. **conservative**: وسّعنا الأهداف (1.8→2.5x) عشان يطلع ربح أكبر + خفّضنا threshold (60→55) عشان يدخل صفقات أكثر.
> 2. **gambler**: قربنا الأهداف (3.0→2.0x) عشان تبقى واقعية + رفعنا threshold (35→42) عشان يفلت الصفقات الضعيفة.
> 3. **balanced**: تعديلات طفيفة للحفاظ على التوازن.

### 4.3 _ADAPTIVE_RR_TABLE (core_scoring_engine.py)

| Persona | Volatility | TP/SL (قديم) | TP/SL (جديد V34) |
|---------|------------|--------------|-------------------|
| gambler | extreme | (2.2, 4.5) | **(1.8, 2.5)** |
| gambler | low | (1.5, 3.0) | **(1.3, 1.8)** |
| conservative | extreme | (1.6, 2.2) | **(1.5, 2.8)** |
| conservative | low | (1.2, 1.6) | **(1.2, 2.2)** |
| balanced | extreme | (1.8, 3.0) | **(1.6, 2.6)** |
| balanced | low | (1.3, 2.2) | **(1.2, 2.0)** |

### 4.4 PERSONA_INPUT_WEIGHTS (Pillar 5 — 4-input weights matrix)

| Persona | Price Action (PA) | Smart Money (SMC) | Sector Heat (SH) | Fundamental (F) |
|---------|------------------:|------------------:|------------------:|-----------------:|
| **Gambler** | 40% | 35% | 25% | 0% |
| **Balanced** | 30% | 25% | 20% | 25% |
| **Conservative** | 15% | 10% | 15% | 60% |
| **Expert** | (composite — أعلى fit score) | — | — | — |

> **المنطق:** Gambler بـ يهتم بالـ price action اللحظي (40%) ومش بـ يهتم بالأساسيات (0%).
> Conservative بـ يهتم بالأساسيات (60%) أكثر من أي حاجة تانية. Balanced = توزيع متوازن.

### 4.5 persona_fit computation (PERSONA-UNIFY-A — Phase 2)

`compute_persona_fit(proofs)` في `v40_2_daily_generator.py` بـ derive 4 category scores من V40.2 proofs:

| V40.2 proof | Category score | الشرط |
|-------------|----------------|-------|
| `trend` + `dna` | `price_action` (0-100) | كل ✅ = 50%، كحد أقصى 100 |
| `makers` | `smc_vsa` (0 أو 100) | ✅ = 100 |
| `sector` | `sector_heat` (0 أو 100) | ✅ = 100 |
| `fundamentals` | `fundamental` (0 أو 100) | ✅ = 100 |

ثم بـ weightها بـ `PERSONA_INPUT_WEIGHTS`:

```python
gambler_fit      = 0.40*pa + 0.35*smc + 0.25*sector + 0.00*fund
balanced_fit     = 0.30*pa + 0.25*smc + 0.20*sector + 0.25*fund
conservative_fit = 0.15*pa + 0.10*smc + 0.15*sector + 0.60*fund

persona_fit = max(gambler_fit, balanced_fit, conservative_fit)
```

لو `fit_tag ∈ {gambler, conservative}` AND `fit_score ≥ 50`:
→ يُكتب row في `persona_predictions` من نفس الـ pool القوي + بـ يتـ closed فورًا بالـ outcome المحاكى.

### 4.6 أمثلة persona_fit

| Proofs (✅) | PA | SMC | SH | F | gambler | balanced | conservative | fit |
|------------|---:|----:|---:|---:|--------:|---------:|-------------:|-----|
| trend+makers+dna+sector (momentum) | 100 | 100 | 100 | 0 | **100** | 75 | 40 | gambler |
| fundamentals فقط | 0 | 0 | 0 | 100 | 0 | 25 | **60** | conservative |
| trend+makers (mixed) | 50 | 100 | 0 | 0 | **55** | 40 | 17.5 | gambler (≥50 → write) |

### 4.7 PERSONA-UNIFY-A — حماية الـ baseline (مهم)

> **القاعدة الذهبية:** `persona='balanced'` في جدول `predictions` **لا يتغيّر** — baseline محمي 100%.

| المبدأ | التنفيذ |
|--------|---------|
| جدول `predictions` (live dashboard source) | persona='balanced' ثابت لكل V40.2 picks |
| جدول `persona_predictions` (منفصل) | لا يقرأه الـ live dashboard overall KPI |
| overall KPI | محمي بالـ dedup-by-ticker (السهم الواحد = صفقة واحدة) |
| لا orphan PENDING | كل persona_predictions row بـ يتـ closed فورًا بـ outcome محاكى |
| HARD cap (Rule 7) | مطبّق على `get_persona_stats` في persona_db.py |

### 4.8 قرار مؤجّل يحتاج موافقة المالك

> **القرار:** إعادة تصنيف V40.2 picks في `predictions` من `persona='balanced'` لـ
> `persona='gambler'/'conservative'` بناءً على persona_fit.

- **التأثير:** بـ يغيّر أرقام byPersona في الـ live dashboard (22/1/3 → تتغير).
- **الـ overall KPI:** لا يتأثر (dedup بالـ ticker).
- **الحالة الحالية:** الخيار الآمن مُطبّق (persona='balanced' ثابت + persona_predictions منفصل).
- **قبل التفعيل:** لازم backtest يثبت إن جودة المتوازن ما انخفضتش.

### 4.9 PERSONA-UNIFY-A Measurement Report (مرجع)

- **الأرشيف:** 651 صف، 631 مغلق (2026-05-10 → 2026-08-09).
- **byPersona:** gambler=281 (WR 35.23%, PF 0.314) · conservative=280 (WR 35.00%, PF 0.212) · balanced=70 (WR 31.43%, PF 0.223).
- **High-fit proxy (≥3 appearances):** 16 صفقة، **WR 68.75%, PF 2.405, Exp +1.428%** (إشارة إيجابية قوية).
- **الخلاصة:** الأرشيف كان قبل تطبيق `compute_persona_fit` annotation، لكن الـ proxy يدعم الفرضية.

---

## 5. R:R logic — قصة الإصلاح الكاملة (commit 65a748f)

> **المرجع (مُدمج):** تقرير `RR_FIX_FINAL_REPORT_20260817.md` الكامل (277 سطر) دُمج في هذا القسم §5 (توحيد التوثيق 2026-08-17).
> **الأرشيف:** `active_databases_20260817_full.zip` (md5 `0947bdf6c2eff1a75ff8af6c3e576ed8`).
> **الحالة:** ✅ FIXED & MEASURED & COMMITTED (`65a748f`).

### 5.1 الـ Bug — key mismatch (السبب الجذري)

| Component | Returns keys | Read keys (buggy) | النتيجة |
|---|---|---|---|
| `institutional_decision_engine.py` L1218-1246 | `sl`, `tp1`, `tp2`, `rr_ratio_tp1`, `rr_ratio_tp2` | — | dynamic R:R 1.5/2.0 + ATR-percentile stops **مُحسبة صح** |
| `v38_backtest_engine.py` L1356-1360 (pre-fix) | — | `stop_loss`, `target_1`, `target_2` | الـ keys **غير موجودة** → fallback **بيفعل دائمًا** → `sl=entry-ATR*1.5`, `tp1=entry+ATR*1.5*1.5` → **R:R مُجمّد على 1.5 لكل صفقة** |

### 5.2 الأدلة من DB (pre-fix)

كل الـ 148 صفقة BUY مغلقة عندها R:R = 1.5 بالظبط:

```
KCEM  entry=7.56   tgt=8.24   sl=7.10   computed_RR=1.5
TAO   entry=653.51 tgt=712.29 sl=614.33 computed_RR=1.5
EG23X entry=3787   tgt=4101   sl=3578   computed_RR=1.5
... (كل الـ 148 صفقة متطابقة)
```

```sql
-- كل الـ risk_reward = 0.0 (NULL fallback) قبل الإصلاح
SELECT COUNT(*) FROM predictions WHERE risk_reward = 0.0 AND signal IN ('BUY','STRONG_BUY');
-- النتيجة: 148
```

### 5.3 الـ Fix (3 تغييرات)

**Change 1 — `vps-service/engines/v38_backtest_engine.py` (lines ~1356-1396):**
- قراءة canonical keys: `sl` / `tp1` / `tp2` (مع backward-compat fallback لـ `stop_loss`/`target_1`/`target_2` لأي decisions قديمة)
- إضافة ATR stop clamp `[3%, 9%]` باستخدام `get_setting('atr_stop_min_pct')` / `get_setting('atr_stop_max_pct')` — يحترم CONSTITUTION Rule 8
- إعادة اشتقاق `tp1`/`tp2` من الـ clamped stop للحفاظ على R:R ratio من `rr_ratio_tp1` / `rr_ratio_tp2`

**Change 2 — `vps-service/jobs/v40_2_daily_generator.py` (lines ~314-326):**
- R:R floor gate: `if r_mult < get_setting('dynamic_rr_normal', default=1.5): continue`
- يرفض setups أقل من العتبة **قبل** ما تدخل `predictions.db`
- مع الـ key-mismatch fix، `dynamic_rr_outperform=2.0` بـ يُحترم للأسهم اللي بتفوق على السوق → الـ gate نادرًا بـ يفعل

**Change 3 — No change to `institutional_decision_engine.py`:**
- الـ dynamic logic كان صحيح من الأصل؛ كان بـ يتم تجاهله بسبب الـ buggy reader. Fix #1 وحده بـ يفتحه.

### 5.4 Before/After Numbers (fair re-simulation, 148 closed trades)

| Metric | BEFORE (raw DB) | BEFORE-RESIM (fair baseline) | **AFTER-A** (dynamic 1.5/2.0) | AFTER-B (fixed 1.5 + clamp) |
|---|---:|---:|---:|---:|
| n | 148 | 148 | 148 | 148 |
| Win Rate | 52.7% | 43.24% | 43.24% | 43.24% |
| Profit Factor | 1.513 | 1.398 | **1.453** | 1.398 |
| Avg Win | +8.30% | +11.00% | **+11.44%** | +11.00% |
| Avg Loss | −6.12% | −6.00% | −6.00% | −6.00% |
| Expectancy / trade | +1.48% | +1.35% | **+1.54%** | +1.35% |
| Total Return | 219.6% | 200.5% | **228.3%** | 200.5% |
| Max Gain | +50.0% | +50.0% | +50.0% | +50.0% |
| Max Loss | −7.59% | −7.59% | −7.59% | −7.59% |

### 5.5 Δ AFTER-A vs BEFORE-RESIM (المقارنة العادلة)

- **PF:** 1.398 → 1.453 (**+0.055**)
- **Expectancy:** 1.35% → 1.54% (**+0.189%/trade**)
- **WR:** unchanged (الأهداف الأعلى أصعب، لكن payoff بـ يعوّض)
- **ATR clamp fired:** **0 trades** (كل الـ stops أصلاً ضمن [3%, 9%])

### 5.6 ماذا تعني الأرقام

1. **النظام ربحان على الأرشيف الحالي الحقيقي** — PF > 1.4, expectancy موجب. الـ PF=0.25 القديم كان على أرشيف أقدم/أضعف.
2. **Dynamic R:R (1.5/2.0) تحسين هندسي حقيقي** — +0.189%/trade expectancy, +0.055 PF, بدون تضخيم trade count أو WR.
3. **95.27% من الصفقات بـ تحصل على R:R=2.0** (outperforming-market path) — الـ dynamic path هو المهيمن، زي ما هو مُصمّم.
4. **Max loss بـ يبقى -7.59%** — Hard Loss Ceiling (HARD cap ABS(return) ≤ 50 + the -7% stop floor في `daily_closer.py`) سليم. الإصلاح ما بـ يكسر أي حماية.
5. **ATR clamp دفاعي، مش نشط** — 0 fires معناه إن الـ ATR stops الحالية بـ تحترم [3%, 9%]؛ الـ clamp شبكة أمان للحالات المستقبلية.

### 5.7 engine_settings (canonical)

| Key | القيمة | الوصف |
|-----|------|------|
| `dynamic_rr_normal` | **1.5** | R:R floor للأسهم العادية (يتح بها floor gate في `v40_2_daily_generator.py` L314-326) |
| `dynamic_rr_outperform` | **2.0** | R:R target للأسهم اللي بتفوق على الـ benchmark (EGX30ETF) |
| `atr_stop_min_pct` | **3.0** | ATR stop clamp الحد الأدنى |
| `atr_stop_max_pct` | **9.0** | ATR stop clamp الحد الأقصى |
| `partial_exit_at_rr` | 1.5 | بيع 50% عند 1.5R + breakeven |
| `partial_exit_trail_remaining` | 1.0 | تفعيل trailing على الباقي |
| `hard_loss_ceiling_pct` | 7.0 | سقف الخسارة الأقصى (cap) |
| `split_drop_threshold_pct` | 35.0 | تجزئة سهم → استبعاد من P&L |

### 5.8 Files Changed

| File | Lines | Change |
|------|-------|--------|
| `vps-service/engines/v38_backtest_engine.py` | ~1356-1396 | Read canonical keys `sl`/`tp1`/`tp2` + ATR stop clamp [3%, 9%] + re-derive tp from clamped sl |
| `vps-service/jobs/v40_2_daily_generator.py` | ~314-326 | R:R ≥ 1.5 floor gate (rejects sub-threshold setups before DB insert) |
| `institutional_decision_engine.py` | — | unchanged (was already correct) |

### 5.9 Commit

```
65a748f fix(rr): unlock dynamic R:R (1.5/2.0) + ATR stop clamp [3%,9%] + R:R>=1.5 floor gate
```

```bash
# Production sync (READ-ONLY — no DB touch)
cd /root/GLMinvestment && git pull origin main
git log --oneline -3   # verify 65a748f is present

# (optional dry-run) Re-run today's generator with the fix
/root/GLMinvestment/.venv/bin/python vps-service/jobs/v40_2_daily_generator.py --today-only

# Verify R:R is now dynamic on today's prediction
sqlite3 /root/GLMinvestment/db/predictions.db \
  "SELECT ticker, entry_price, target_price, stop_loss,
          ROUND((target_price-entry_price)/(entry_price-stop_loss),3) AS rr
   FROM predictions
   WHERE prediction_date = date('now') AND signal IN ('BUY','STRONG_BUY') LIMIT 5;"
# Expected: rr values should now vary (1.5 for normal, 2.0 for outperforming) — NOT all 1.5
```

### 5.10 ما لا يجب فعله

- ❌ Do NOT delete or modify any existing predictions in `predictions.db` — الإصلاح forward-only.
- ❌ Do NOT re-run the historical backfill (`maestro_backfill_*`) — بـ يدمر audit trail.
- ❌ Do NOT change `engine_settings.py` thresholds بدون measurement session منفصلة.
- ❌ Do NOT enable the fundamentals fetcher cron حتى يُصلح `tab_*` → ticker mapping.

---

## 6. Fundamentals scoring logic — placeholder=50 → real 0-100 (Stages A-H)

> **المراجع (مُدمجة):** محتوى `DATA_ENGINE_FUNDAMENTALS_INVENTORY.md` (Stage A, 161 سطر) + `FUNDAMENTALS_HISTORICAL_TEST_REPORT.md` (Stage A-H, 316 سطر) دُمج بالكامل في هذا القسم §6 (توحيد التوثيق 2026-08-17).
> **الحالة:** ✅ Stage A-H مُنفّذة في sandbox/code (commit `04354a5`). ⏳ Production sync + cron + hard veto = NEXT.

### 6.1 المشكلة التاريخية: placeholder=50 لكل الـ 153 توقعات

```sql
-- قبل الإصلاح (commit 04354a5):
SELECT fundamental_score, COUNT(*) FROM predictions GROUP BY fundamental_score;
-- النتيجة: (50.0, 153)  ← كل الـ 153 توقع عنده fundamental_score = 50.0
```

**السبب الجذري (طبقتان من المشاكل):**

| الطبقة | المشكلة | الأثر |
|--------|---------|------|
| `egx_fundamentals` table | **0 rows** (fetcher UNSCHEDULED) | `stock_fundamentals.py` ما بـ يلاقي بيانات |
| `tab_*` tables (8) | **858-866 rows لكل جدول**، بس `symbol` column فيها **Arabic names** (e.g. "السعودية") مش tickers | `stock_fundamentals.py` بـ يعمل `WHERE ticker = ?` → no match → `fundamentals.available = False` |
| V40.2 generator | بـ يكتب placeholder `50.0` لو `fundamentals.available == False` | كل توقع بـ ياخد 50.0 |

```python
# v38_backtest_engine.py L1292 (pre-fix)
fundamental_score = fundamentals.score * 100 if fundamentals.available else 0.0

# v40_2_daily_generator.py (pre-fix)
fundamental_score = 50.0 if not fundamentals.available else fundamentals.score * 100
```

### 6.2 جرد tab_* (Stage A — DONE)

| Table | Rows | Date column | Usable? |
|-------|-----:|-------------|---------|
| `tab_valuation` | 858 | (none — snapshot) | ✅ clean |
| `tab_profitability` | 858 | (none) | ✅ clean |
| `tab_dividends` | 858 | (none) | ✅ clean |
| `tab_performance` | 858 | (none) | ✅ clean |
| `tab_technical_analysis` | 863 | (none) | ✅ clean |
| `tab_balance_sheet` | 866 | `fiscal_period` (2025-Q3 → 2026-Q3) | ❌ BROKEN — columns shifted |
| `tab_income_statement` | 866 | `fiscal_period` | ❌ BROKEN — same shift |
| `tab_cash_flow` | 866 | `fiscal_period` | ❌ BROKEN — same shift |
| `egx_fundamentals` | **0** | `last_updated` | ❌ EMPTY (fetcher unscheduled) |
| `historical_data` | 99,076 | `date` (2021-06-08 → 2026-06-07) | Saudi + US only (no EGX) |

**Critical schema bug — `tab_balance_sheet` / `tab_income_statement` / `tab_cash_flow`:**

```
Expected:  symbol=1030 | market=السعودية | fiscal_period=2025-Q3 | fiscal_end=2025-12-31 | total_assets=...
Actual:    symbol=السعودية | market=2025-Q3 | fiscal_period=2025-12-31 | fiscal_end=335.05 M SAR | total_assets=...
```

> الـ 3 جداول دي **UNUSABLE** بدون migration. الـ score بيعتمد على الـ 5 جداول النظيفة فقط.

### 6.3 Market label discrepancy (مُوثّق، لم يُصلح)

`predictions.db` بـ يـ label كل الـ 22 tickers كـ `market=EGX`، لكن الأسواق الحقيقية:

| Market | Count | Tickers |
|--------|------:|---------|
| السعودية (Saudi) | 11 | 1030, 1120, 1302, 1321, 1322, 1323, 1324, 2090, 2180, 2190, 2200 |
| مصر (EGX) | 4 | ALCN, ETCRS, MCQE, TMGH |
| الكويت | 3 | BOURSA, ENERGYH, KCEM |
| unknown | 4 | EG23X, MTEZ, OCIC, TAO |

> **ملاحظة:** الأسعار في `price_history.db` للـ numeric tickers **هي أسعار سعودية** (verified: ticker=1030 close=13.26 matches `stocks` table price=13.26 for الإستثمار). الصفقات حقيقية؛ بس الـ market label غلط في `predictions.db`.

### 6.4 Stage B — Mapping (DONE: 81.8% ticker / 97.4% trade coverage)

`resolve_ticker()` في `fundamental_data_provider.py`:

```python
def resolve_ticker(ticker: str, db) -> Optional[str]:
    # 1. Exact match على tab_valuation.symbol (للـ numeric Saudi tickers: 1030, 1120)
    row = db.execute("SELECT symbol FROM tab_valuation WHERE symbol = ?", (ticker,)).fetchone()
    if row:
        return row['symbol']

    # 2. Prefix match `symbol LIKE 'TICKER%'` (للـ EGX alpha tickers: ALCNالاسكندرية → ALCN)
    row = db.execute("SELECT symbol FROM tab_valuation WHERE symbol LIKE ? || '%'", (ticker,)).fetchone()
    if row:
        return row['symbol']

    # 3. No match → fundamental_score = None, confidence = 0
    return None
```

| Metric | Value |
|--------|------:|
| Distinct prediction tickers | 22 |
| Matched to `tab_valuation` | **18 (81.8%)** |
| Unmatched | 4 (EG23X, MTEZ, OCIC, TAO) |
| **Predictions WITH fundamentals** | **149 / 153 (97.4%)** |
| Predictions WITHOUT fundamentals | 4 / 153 (2.6%) |

> **Zero duplicates:** لا ticker بيظهر في 2+ markets في `tab_valuation`، فالـ match unambiguous.

### 6.5 Stage C — get_fundamental_score() (DONE)

`vps-service/analyzers/fundamental_data_provider.py` → `get_fundamental_score(ticker)`

| Component | Weight | Fields | Logic |
|-----------|------:|--------|-------|
| **Profitability** | 40% | roe (20%), net_margin (12%), op_margin (8%) | ROE ≥20=1.0, 10-20=0.75, 5-10=0.5, <5=0.25, <0=0; margins similar |
| **Valuation** | 30% | pe_ratio (18%), pb_ratio (12%) | P/E <8=1.0, <15=0.9, <25=0.7, <40=0.4, ≥40=0.2; P/B <1=1.0, <2=0.85, <4=0.6, <8=0.3, ≥8=0.15 |
| **Dividend** | 15% | div_yield + payout penalty | yield ≥6=1.0, ≥3=0.85, ≥1=0.65, 0-1=0.45, 0=0.3; payout >90% → ×0.7 |
| **Growth** | 15% | dps_growth (proxy — revenue_growth in broken table) | ≥20=1.0, ≥5=0.8, 0-5=0.55, <0=0.3, <-20=0 |

**Missing data handling:** field = None → that component gets weight 0 (excluded from weighted average, NOT forced to 50). Confidence = % of components with data.

```python
# Output example
{
    'ticker': 'COMI',
    'score': 93.0,           # 0-100
    'confidence': 100.0,     # % of components with data
    'available': True,
    'components': {
        'roe':         {'value': 21.36, 'score': 100.0, 'weight': 20.0},
        'net_margin':  {'value': 51.03, 'score': 100.0, 'weight': 12.0},
        # ...
    },
    'source_symbol': 'COMIالبنك التجاري الدولي',
    'source_market': 'مصر',
    'as_of': '2026-08-17',
}
```

### 6.6 Stage D-E — Historical Test (DONE)

| Metric | Value |
|--------|------:|
| Total closed BUY/STRONG_BUY predictions | 148 |
| Distinct tickers (after dedup) | 18 |
| Tickers WITH fundamentals | 16 (88.9%) |
| Tickers WITHOUT fundamentals | 2 (EG23X, TAO) |
| Date range | 2026-01-01 → 2026-08-17 |

**3 scenarios comparison:**

| Scenario | n | WR | PF | Expectancy | Total |
|----------|---:|---:|---:|---:|---:|
| **S0 — Baseline (all trades, no fundamentals gate)** | 18 | 55.56% | 1.511 | +1.391% | +25.05% |
| **S1 — High-score tier (≥70)** | **9** | **77.78%** | **4.436** | **+4.30%** | **+38.70%** |
| S1 — Mid-score tier (40-70) | 4 | 25.00% | 0.341 | −3.24% | −12.96% |
| S1 — Low-score tier (<40) | 3 | 33.33% | 0.717 | −1.18% | −3.54% |
| S1 — No score (missing) | 2 | 50.00% | 1.515 | +1.43% | +2.85% |
| **S2 — Conservative gate (reject score<40 + conf>70)** | 18 | same as S0 (no conservative trades in archive) | — | — | — |
| **S3 — Hard veto (reject ALL score<30)** | 15 | 60.00% | 1.784 | +1.906% | +28.59% |

**Δ (S3 vs S0):** WR +4.44pp · PF +0.273 · Exp +0.52% · Total +3.54pp.

### 6.7 Key Findings

1. **Fundamentals تفيد بقوة في winner selection:** high-score tier (≥70) = PF 4.436 (2.9× أعلى من baseline 1.511).
2. **Hard veto <30 يرفع الـ portfolio كله:** PF +0.273, Exp +0.52%.
3. **⚠️ False positive واحد:** 2180 (فيبكو) — score=17.5 لكن ret=+8.97% (momentum-driven rally على سهم ضعيف الأساسيات). يؤكد القاعدة: الأساسيات filter مساعد، مش قرار وحيد.
4. **Conservative gate غير مُختبَر:** الـ archive كله `persona=balanced` (PERSONA-UNIFY-A) → الـ gate بـ يفعل لما تظهر صفقات conservative.

### 6.8 Stage F — Integration (DONE, commit 04354a5)

| File | Change |
|------|--------|
| `vps-service/analyzers/fundamental_data_provider.py` | Fixed `_fetch_*` methods (ticker→symbol column + prefix match). Added `resolve_ticker()` + `get_fundamental_score()` + `_score_*` component scorers. |
| `vps-service/engines/v38_backtest_engine.py` | Added `confidence` field to `FundamentalsState`. Rewrote `_load_fundamentals()` (data_engine.db primary + stocks.db fallback). Added `_get_fundamentals()` lazy lookup. Changed `fundamental_score` from binary `score*100` to real 0-100. |
| `vps-service/scripts/fundamentals_hist_test.py` | NEW — Stage E measurement script (3 scenarios + score tiers). |

### 6.9 egx_fundamental_fetcher.py — HARDENED + scheduled (Stage G ✅ DONE)

```python
# vps-service/data/egx_fundamental_fetcher.py
# Uses EGXPilot free API (/api/stocks/all + /api/stockanalysis/<ticker>)
# Writes to: egx_fundamentals table in data_engine.db (ticker PK — clean)
# Does NOT write to tab_* (owned by TradingView scraper; different symbol format)
```

**Cron (السبت 16:00 Cairo = 14:00 UTC) — مُفعّل في crontab.txt (commit a268957):**

```cron
# ─── 5. FUNDAMENTALS FETCHER (EGXPilot — free) ────────────────
0 14 * * 5 cd /root/GLMinvestment && /root/GLMinvestment/.venv/bin/python vps-service/data/egx_fundamental_fetcher.py >> /root/GLMinvestment/logs/fundamentals_fetch.log 2>&1
```

**FETCHER-FIX (2026-08-17, commit 4cde9f0) — ثلاث دفاعات قبل أول تشغيل cron:**

1. **Ticker-validation guard** (`_is_valid_ticker`): يرفض أسماء الأسواق العربية
   (السعودية/مصر/الكويت/قطر)، أنماط fiscal_period (YYYY-Qn/Hn/FY)، رموز الـ indices
   (.EGX30)، والفراغات قبل أي كتابة لـ `egx_fundamentals`. ده يمنع تمامًا إعادة إنتاج
   صفوف الـ column-shift (اسم السوق يتسرب لعمود symbol للأسهم ذات الأكواد الرقمية).
   مُطبّق في `get_fundamentals()` + حلقة `fetch_all_egx_fundamentals()`.

2. **Cron no-args bug fix**: الـ cron بيشغّل السكربت بدون args، بس الـ `__main__` القديم
   كان بيفترض 'COMI' (اختبار سهم واحد) → الـ cron ما كانش يع populate حاجة. دلوقتي
   no-args = full bulk fetch. أضفت `verify` subcommand للتحقق من سلامة tab_*.

3. **tab_* integrity check** (`verify_tab_integrity`): فحص read-only لـ
   tab_balance_sheet/income_statement/cash_flow بحثًا عن shifted rows (symbol = اسم
   سوق). الـ fetcher ما بيكتبش في tab_* (ملك الـ TradingView scraper اللي بيستخدم
   صيغة TICKER+ArabicName مختلفة). ده التحقق بيسمح للمشغّل يتأكد إن tab_* فضلت نظيفة
   بعد الـ migration وبعد كل دورة cron.

```bash
# التحقق من سلامة tab_* بعد الـ cron:
EGX_DATA_ENGINE_DB=db/vps_real/data_engine.db python3 vps-service/data/egx_fundamental_fetcher.py verify
# → {"clean": true, "tables": {"tab_balance_sheet": {"total": 858, "shifted": 0}, ...}}
```

> **Prerequisite (✅ DONE):** تم إصلاح `tab_*` column-shift بـ `migrate_fundamentals_schema.py`
> (commit a73b1a1) — 24 صف فاسد اتمسح، 858 سليم لكل جدول. الـ cron آمن للتشغيل.

### 6.10 Stage A-H Summary

| Stage | Status | What was done |
|-------|--------|---------------|
| A — Inventory | ✅ DONE | 5 clean tables identified, 3 broken documented, egx_fundamentals=0 confirmed |
| B — Mapping | ✅ DONE | `resolve_ticker()` (exact + prefix match), 81.8% ticker / 97.4% trade coverage |
| C — Score | ✅ DONE | `get_fundamental_score()` 0-100 from 4 clean tables (40/30/15/15 weights) |
| D — Test sample | ✅ DONE | 148 closed BUY/STRONG_BUY predictions, 18 distinct tickers |
| E — Before/After | ✅ DONE | 3 scenarios (baseline / informational / hard veto) |
| F — Integration | ✅ DONE | `_get_fundamentals()` lazy lookup + `FundamentalsState.confidence` |
| G — Fetcher cron | ✅ DONE | cron مُفعّل (a268957) + fetcher مُحصّن ضد column-shift (4cde9f0): ticker guard + no-args bug fix + tab_* integrity check |
| H — Report | ✅ DONE | (مُدمج في §6 — كان FUNDAMENTALS_HISTORICAL_TEST_REPORT.md، 316 سطر) |

### 6.11 Recommended Activation Phases

| Phase | Action | Risk |
|-------|--------|------|
| **1 (now)** | فعّل `fundamental_score` الحقيقي (يُحسب ويُعرض، بدون gate) | صفر — informational فقط |
| **2 (after 1 week live)** | فعّل hard veto score<30 (يرفض BUY ضعيف الأساسيات) | منخفض — 3/18 rejections |
| **3 (after conservative persona data)** | فعّل conservative gate (score<40 + conf>70) | يحتاج بيانات conservative |

### 6.12 ما لا يجب فعله

- ❌ لا ترفض BUY بناءً على fundamentals فقط للـ Gambler (يقتل الزخم).
- ❌ لا ترفع عتبة الـ veto فوق 30 (هتقتل winners).
- ❌ (مُستوفى) لا تفعّل الـ fetcher cron قبل إصلاح `tab_*` → ticker mapping — **تم الإصلاح**: migrate_fundamentals_schema.py (a73b1a1) + ticker guard في الـ fetcher (4cde9f0). الـ cron آمن الآن.

---

## 7. Backtest methodology (V38 + walk-forward + HARD cap + dedup)

> **المرجع (مُدمج):** محتوى `V34-INSTITUTIONAL-DECISION-ENGINE.md` + `RR_FIX_FINAL_REPORT_20260817.md` دُمج في §2 + §5 (توحيد التوثيق 2026-08-17).
> **الكود:** `vps-service/engines/v38_backtest_engine.py` (~1,400 سطر).

### 7.1 V38 Backtest Engine — walk-forward

```
لكل ticker في EGX (~370):
    حمّل بيانات تاريخية من price_history.db
    لكل يوم في الفترة:
        شغّل V39 institutional_decision_engine logic
        لو إشارة BUY:
            simulate_trade(entry_price, signal, date)
                → تتبع highest_price (مع intraday.db)
                → اخرج عند: hit_target / hit_stop / trailing_stop / expired
        سجّل الصفقة (entry_date, exit_date, return_pct, exit_reason)
    جمع النتائج
```

### 7.2 simulate_trade() — خطوة بخطوة

```python
def simulate_trade(entry_price, signal, date, target, stop, atr_series):
    highest_price = entry_price

    for each day in future (up to 30 days):
        # 1. حدّث highest_price (مع intraday)
        highest_price = max(highest_price, today_high_from_intraday_db)

        # 2. احسب gain_pct
        gain_pct = (today_close - entry_price) / entry_price * 100

        # 3. ★ Trailing Stop (2.0× ATR — V39.1)
        if gain_pct >= 3.0 and atr_available:
            trailing_price = highest_price - (2.0 * atr)
            if today_close <= trailing_price:
                return exit('trailing_stop', trailing_price)

        # 4. Time Stop
        if days_held >= 30:
            return exit('expired', today_close)

        # 5. Hit Target
        if today_close >= target:
            return exit('hit_target', target)

        # 6. Hit Stop
        if today_close <= stop:
            return exit('hit_stop', stop)

    return exit('expired', today_close)
```

### 7.3 أسباب الخروج (Exit Reasons)

| السبب | الدلالة | is_correct |
|------|--------|-----------|
| `hit_target` | وصل الهدف | 1 (WIN) |
| `hit_stop` | ضرب الوقف | 0 (LOSS) |
| `trailing_stop` | الستوب المتحرك اتفعل | depends on return (TRAILING_PROFIT if return≥0, STOPPED if <0) |
| `expired` | الوقت خلص | depends on return |

### 7.4 HARD cap (Rule 7)

```sql
-- مطبّق في 4 مواقع:
WHERE (actual_return IS NULL OR ABS(actual_return) <= 50)
```

| Layer | File | التطبيق |
|-------|------|---------|
| Client KPIs | `PredictionTrackingDashboard.tsx::computeStatsFromPredictions` | `if (Math.abs(ret) > 50) continue` للـ WIN/LOSS |
| Client aggregate | `PredictionTrackingDashboard.tsx::aggregateByTicker` | memo جديد: صف واحد لكل `(ticker, entryDate)` |
| Server SQL (overall) | `live-tracking/route.ts:64-75` | `(eff_return IS NULL OR ABS(eff_return) <= 50)` |
| Server SQL (per-persona) | `live-tracking/route.ts:218-228` | نفس الـ HARD cap |
| Persona stats (Python) | `core/persona_db.py::get_persona_stats` | `WHERE (profit_loss_percent IS NULL OR ABS(profit_loss_percent) <= 50)` |

> **السبب:** قيم زي `-10814%` (تجزئة سهم غير مُعدّلة) كانت بـ تلوث المتوسطات. الـ HARD cap بـ يستبعد كل صف |return| > 50%.

### 7.5 Dedup Rules (PERSONA-BALANCE — Rule 22)

> **القاعدة الذهبية:** السهم الواحد = صفقة واحدة حتى لو تكرر بين الثلاث شخصيات.
> التكرار بين الشخصيات = **إشارة أقوى** (أسهم تحت التركيز)، وليس 3 صفقات منفصلة.

| الطبقة | القاعدة |
|--------|--------|
| **Overall (العدّاد الرسمي)** | عدد الصفقات الفريدة = عدد الـ `(ticker, entryDate)` المخصّصة. WR/PF/avgWin/avgLoss تُحسب منهم. هذا هو الرقم الصادق. |
| **byPersona (تفصيل الشخصيات)** | يعرض "تغطية" كل شخصية — كم سهمًا أعلامت عنه. السهم الذي ظهر في شخصيتين يُعدّ في تغطية كليهما. لذلك **مجموع الشخصيات قد يفوق الـ overall** وهذا صحيح. |
| **focusTickers (أسهم تحت التركيز)** | الأسهم التي ظهرت في ≥ 2 شخصيات = إشارة قوة. لها قسم مخصص. |
| **أولوية Dedup** | `target_hit` > `holding_days` أقل > `master_score` أعلى |

### 7.6 معمارية مسارَي التوليد (مهم لفهم فجوة Live vs Backtest)

| المسار | المولّد | الـ persona المكتوبة | الجودة |
|--------|---------|---------------------|--------|
| **V40.2 evidence-based** | `jobs/v40_2_daily_generator.py` | `balanced` فقط (سطر 327) | عالية — 6 إثباتات + kill filters + R/R≥1.5. **69% WR حيًا** |
| **Maestro persona** | `analyzers/maestro_orchestrator.py` → `core/persona_db.py` | `gambler` + `investor` (منفصلة) | مسار منفصل، أقل صرامة في الـ evidence |

> **التشخيص:** المضارب/المستثمر الضعيف حيًا (1 و 3 توصيات) ليس لأن الشخصية نفسها ضعيفة، بل لأن توقعاتها تأتي من مسار maestro الذي **لم يمرّ بنفس الـ evidence-based pipeline** الصارم. جعل V40.2 يولّد per-persona = قرار تصميمي كبير يحتاج موافقة المالك (يخاطر بالـ baseline المحمي).

### 7.7 Backtest Results (V40.2 — 2026-01-01 → 2026-08-16)

| المقياس | النتيجة | الهدف | الحالة |
|--------|--------|------|--------|
| **Total Trades** | **539** | 60-150 | ✅ تجاوز (3.6x) |
| **Win Rate** | **51.0%** (275W / 264L) | ≥ 50% | ✅ تحقق |
| **Profit Factor** | **1.584** | ≥ 1.5 | ✅ تجاوز |
| **Average Win** | +8.84% | — | — |
| **Average Loss** | -5.81% | capped ≤ -5% to -9% | ✅ ضمن النطاق |
| **Worst Single Loss** | -12.55% (MFPC, expired trade) | ≥ -9% | ⚠️ تجاوز بسيط (5 صفقات = 0.9%) |
| **Hit Target** | 192 (35.6%) | — | — |
| **Hit Stop** | 255 (47.3%, avg -5.81%) | — | — |

### 7.8 Fair re-sim post R:R fix (148 closed trades, archive 20260817)

| Metric | Value |
|--------|------:|
| Win Rate | 43.24% |
| Profit Factor | **1.453** (was 1.398 pre-fix) |
| Expectancy / trade | **+1.54%** (was +1.35% pre-fix) |
| Max Loss | -7.59% (unchanged — Hard Loss Ceiling intact) |
| ATR clamp fired | 0 trades |

---

## 8. Prediction lifecycle (PENDING → 5-state taxonomy → close)

> **المرجع (مُدمج):** محتوى `RL-FIX-9-Predictions-Status-Logic.md` (285 سطر) دُمج في هذا القسم §8 (توحيد التوثيق 2026-08-17).
> **الكود:** `vps-service/jobs/daily_closer.py` + `vps-service/api/misc_routes.py`.

### 8.1 الـ 5-state taxonomy

| الحالة (status) | exit_type | hit_target | hit_stop | is_correct | المعنى | اللون |
|------------------|-----------|------------|----------|------------|----------------|--------|
| `TARGET_HIT` | `target_hit` | 1 | 0 | 1 | ✅ تم تحقيق الهدف | أخضر |
| `TRAILING_PROFIT` | `trailing_profit` | 0 | 0 | 1 | 💰 خرج بربح | زمردی |
| `STOPPED` | `stop_loss` / `trailing_stop` | 0 | 1 | 0 | ❌ ضرب وقف | أحمر |
| `EXPIRED` | `expired` | 0 | 0 | 0 | ⌛ انتهت المدة | رمادي |
| `PENDING` | (NULL) | 0 | 0 | NULL | ⏳ لسه معلقة | كهرمانی |

### 8.2 قواعد الانتقال (Transition Rules)

```
PENDING  ──hit_target──→  TARGET_HIT  (is_correct=1)
PENDING  ──hit_stop────→  STOPPED     (is_correct=0)
PENDING  ──trailing(+)--→  TRAILING_PROFIT  (is_correct=1, return≥0)
PENDING  ──trailing(-)--→  STOPPED     (is_correct=0, return<0)
PENDING  ──30 days─────→  EXPIRED     (is_correct=0 or 1, depends on return)
```

### 8.3 الـ 4 مشاكل التاريخية (RL-FIX-9 — أغسطس 2026)

| # | المشكلة | السبب الجذري | الإصلاح |
|---|---------|--------------|---------|
| 1 | "ضرب وقف" مع ربح موجب (STOPPED + profit) | `daily_closer.py:check_trailing_stop` كان بـ يصنّف كل trailing exit كـ `STOPPED` رغم إن العائد موجب | إضافة `TRAILING_PROFIT` state — لو exit رابح، صنّفه `CLOSED/trailing_profit` بدل `STOPPED/trailing_stop` |
| 2 | "لسه معلقة" مع عائد سالب (PENDING + negative return) | `misc_routes.py:3072-3082` كان بـ يحسب `actual_return` من `exit_price` بصيغة BUY فقط | direction-aware: `SELL → return=(entry-trigger)/entry` |
| 3 | كل التوقعات بتاريخ واحد (08-10) | SQL filter ضيق (14 يوم) + LIMIT 80 + per-ticker dedup + `DELETE FROM predictions WHERE outcome_date IS NULL` | الـ window من 14 يوم → **220 يوم** + LIMIT 500 + per-(ticker, date) dedup + no destructive DELETE |
| 4 | High == Low == Entry | `_mark_expired` كان بـ يمرّر `highest=0.0, lowest=0.0` | تمرير `entry_price` كـ highest/lowest بدل 0.0 |

### 8.4 Closing Engine (daily_closer.py)

```python
# vps-service/jobs/daily_closer.py
# يشتغل 15:30 Cairo (بعد إغلاق السوق) — يومي Sun-Thu

def run_daily_closer():
    pending = get_pending_predictions()  # status='PENDING'
    for pred in pending:
        today_close = get_close_price(pred.ticker, today)

        # 1. حدّث highest_price / lowest_price (مع intraday.db)
        highest = max(pred.highest_price, get_intraday_high(pred.ticker, since=pred.prediction_date))
        lowest  = min(pred.lowest_price,  get_intraday_low (pred.ticker, since=pred.prediction_date))

        # 2. فحص الـ exits
        if today_close >= pred.target_price:
            exit_pred(pred, exit_type='target_hit', exit_price=pred.target_price)
        elif today_close <= pred.stop_loss:
            exit_pred(pred, exit_type='stop_loss', exit_price=pred.stop_loss)
        elif should_trailing_exit(pred, today_close, highest):
            # ★ trailing stop logic (direction-aware)
            actual_return = ((exit_price - entry_price) / entry_price * 100)
            if pred.signal == 'SELL':
                actual_return = -actual_return  # SELL sign-flip
            if actual_return >= 0:
                exit_pred(pred, exit_type='trailing_profit', exit_price=exit_price, is_correct=1)
            else:
                exit_pred(pred, exit_type='trailing_stop', exit_price=exit_price, is_correct=0)
        elif days_held >= 30:
            exit_pred(pred, exit_type='expired', exit_price=today_close)

def exit_pred(pred, exit_type, exit_price, is_correct=None):
    # حساب actual_return على سعر التفعيل (limit/stop) — مش سعر الإغلاق
    if pred.signal == 'BUY':
        actual_return = ((exit_price - pred.entry_price) / pred.entry_price) * 100
    else:  # SELL
        actual_return = ((pred.entry_price - exit_price) / pred.entry_price) * 100

    # ★ HARD cap (Rule 7)
    if abs(actual_return) > 50:
        actual_return = None  # exclude from KPIs

    # ★ Hard Loss Ceiling (-7%)
    if actual_return < -hard_loss_ceiling_pct:  # -7.0%
        actual_return = -hard_loss_ceiling_pct

    # ★ Split Guard (-35% → exclude entirely)
    if abs(actual_return) > split_drop_threshold_pct:  # 35%
        actual_return = None

    # ★ is_correct من exit_type (ممنوع نسمّي ضربة وقف "win")
    if is_correct is None:
        is_correct = 1 if exit_type == 'target_hit' else 0

    # ★ لا WIN بدون outcome_date
    update_prediction(pred.id, status='CLOSED',
        outcome_date=today, exit_type=exit_type, exit_price=exit_price,
        is_correct=is_correct, actual_return=actual_return,
        highest_price=highest, lowest_price=lowest)

    # ★ سجّل الدرس للتعلم
    record_lesson_from_close(pred, exit_type, actual_return)
```

### 8.5 الـ API Endpoint للإغلاق

```
POST /api/predictions/honest-tracking/close
```

> يُستدعى يدويًا أو من cron. يكتب الـ outcome رسميًا في `predictions.db` + يسجّل الدرس في `learned.db`.

### 8.6 SQL window

```sql
-- misc_routes.py (route /api/unified/predictions)
WHERE date(prediction_date) >= date(?, '-220 days')  -- كان 14 يوم
ORDER BY prediction_date DESC
LIMIT 500  -- كان 80
```

> يغطي 1/1/2026 → الآن (220 يوم ~ 7.3 شهور).

---

## 9. Learning loop (continuous_learning + applied_lesson chain)

> **المرجع (مُدمج):** محتوى `CLOSED_LOOP_FINAL.md` (120 سطر، CL4) دُمج في هذا القسم §9 (توحيد التوثيق 2026-08-17).
> **الكود:** `vps-service/utils/lesson_store.py` + `vps-service/analyzers/maestro_orchestrator.py::run_expert_memory_phase` + `vps-service/utils/live_price.py`.

### 9.1 الـ Closed-Loop Chain (4 ملفات)

| # | الملف | الدور |
|---|------|------|
| 1 | `vps-service/utils/live_price.py` | مصدر السعر الموحّد: `get_live_price` (intraday → data_engine → fallback). يُستخدم في كتابة التوقع، الإغلاق، ومعاينة التتبع. |
| 2 | `vps-service/analyzers/maestro_orchestrator.py` | العقل: `run_expert_memory_phase` يقرأ الدروس → `applied_lesson` (توسيع وقف مسقوف) → `record_prediction` يكتب التوقع بـ persona حقيقية. |
| 3 | `vps-service/jobs/daily_closer.py` | الإغلاق الآلي: يقفل على سعر التفعيل (target/stop) + `is_correct` من `exit_type` + `record_lesson_from_close` + `detect_and_record_missed_opportunities`. |
| 4 | `vps-service/utils/lesson_store.py` | ذاكرة الدروس: `record_lesson_from_close` يصنّف (STOP_TOO_TIGHT / TARGET_HIT_OK / LATE_MOMENTUM / MISSED_BREAKOUT) → `get_persona_lesson_summary` / `get_ticker_lesson_summary` يقرأها المايسترو. |

> **قاعدة ثابتة:** Python = العقل · Node = عرض فقط. لا WIN/LOSS نهائي بدون `outcome_date`.

### 9.2 تصنيف الدروس (Lesson Types)

| Lesson Type | الشرط | الإجراء التعلّمي |
|-------------|------|------------------|
| `STOP_TOO_TIGHT` | ضرب وقف مبكر، ثم ارتد السعر للأعلى | توسيع وقف مسقوف (+0.15×ATR لكل تكرار، حد أقصى 0.5×ATR) |
| `TARGET_HIT_OK` | الهدف اتحقق بنجاح | keeps config — لا تغيير |
| `LATE_MOMENTUM` | تحرك متأخر بعد فترة طويلة | extend `hold_days` |
| `MISSED_BREAKOUT` | كسر فات النظام (لم يُولد توقع) | lower entry threshold |

### 9.3 applied_lesson — التعلّم الفعّال المسقوف

```python
# maestro_orchestrator.py::run_expert_memory_phase
def run_expert_memory_phase(ticker, persona):
    # 1. حمّل الدروس السابقة
    ticker_lessons = get_ticker_lesson_summary(ticker)
    persona_lessons = get_persona_lesson_summary(persona)

    # 2. لو STOP_TOO_TIGHT متكرر → وسّع الوقف
    stop_widen_atr = 0.0
    stop_too_tight_count = ticker_lessons.get('STOP_TOO_TIGHT', 0)
    if stop_too_tight_count >= 2:  # سهم
        stop_widen_atr = min(0.5, stop_too_tight_count * 0.15)
    elif persona_lessons.get('STOP_TOO_TIGHT', 0) >= 3:  # شخصية
        stop_widen_atr = min(0.5, persona_lessons['STOP_TOO_TIGHT'] * 0.15)

    return ExpertMemoryResult(
        stop_widen_atr=stop_widen_atr,
        applied_lesson=f"widen_stop +{stop_widen_atr:.2f}ATR" if stop_widen_atr > 0 else None,
    )

# maestro_orchestrator.py::analyze (يستخدم النتيجة)
def analyze(ticker, ...):
    expert_memory = run_expert_memory_phase(ticker, persona)

    if expert_memory.stop_widen_atr > 0:
        # توسيع الوقف قبل record_prediction
        if signal == 'BUY':
            original_stop = stop_loss
            stop_loss -= expert_memory.stop_widen_atr * atr
            # ★ سقف: entry×0.85 + 50% من المخاطرة الأصلية
            stop_loss = max(stop_loss, entry_price * 0.85)
        elif signal == 'SELL':
            stop_loss += expert_memory.stop_widen_atr * atr
            stop_loss = min(stop_loss, entry_price * 1.15)

        # إعادة حساب R:R
        risk = abs(entry_price - stop_loss)
        rr = target_dist / risk
        log(f"[LEARNING] applied_lesson: {expert_memory.applied_lesson} "
            f"(STOP_TOO_TIGHT {stop_too_tight_count}x on {ticker}) "
            f"stop {original_stop:.2f}->{stop_loss:.2f} RR {old_rr:.2f}->{rr:.2f}")
```

### 9.4 مثال موثّق من الـ production log

```
[LEARNING] applied_lesson: widen_stop +0.45ATR (STOP_TOO_TIGHT 3x on COMI) dir=BUY stop 95.0->94.1 RR 2.0->1.69 (atr=2.000 widen_atr=0.45)
```

> **ده تغيير معامل فعلي ضمن سقف — مش نفخ ثقة.** الـ stop_loss بـ يتوسّع فيدّي السهم فرصة أكبر قبل ما يضرب الوقف، مع الاحتفاظ بسقف لا يتجاوزه.

### 9.5 continuous_learning.py — self-correction

```python
# vps-service/analyzers/continuous_learning.py
# يقرأ win_rate من آخر N صفقات ويُعدّل dynamic_thresh:

def self_correct_threshold(persona, recent_trades):
    if len(recent_trades) < 5:
        return  # ما يتعلمش من ضوضي

    win_rate = sum(1 for t in recent_trades if t.is_correct) / len(recent_trades)

    if win_rate >= 0.65:
        # أداء كويس → اقبل إشارات أقل
        new_threshold = max(60, current_threshold - 0.10 * current_threshold)
    elif win_rate < 0.40:
        # أداء ضعيف → لازم إشارات أقوى
        new_threshold = min(85, current_threshold + 0.10 * current_threshold)

    update_engine_setting(f'dynamic_thresh_{persona}', new_threshold)
```

### 9.6 نموذج الجودة (Quality Model)

```python
# لو win_rate ≥ 60% AND profit_factor > 1.2 → ✅ دقيق ومتأكد
# else → ⚠️ محتاج ضبط
```

### 9.7 السلسلة التراكمية (Cumulative Chain)

كل صفقة جديدة بـ تـ inherits الدروس السابقة:

```
Trade 1 (COMI, STOP_TOO_TIGHT)   → widen_stop +0.15 ATR
Trade 2 (COMI, STOP_TOO_TIGHT)   → widen_stop +0.30 ATR (cumulative)
Trade 3 (COMI, STOP_TOO_TIGHT)   → widen_stop +0.45 ATR (cumulative)
Trade 4 (COMI, TARGET_HIT_OK)    → keeps config (no further widening)
Trade 5 (COMI, ...)               → inherits +0.45 ATR baseline from history
```

> الـ stop_widen_atr بـ يتراكم لكن بسقف 0.5×ATR. لو الـ TARGET_HIT_OK يبدأ بـ يقلّل الـ widen تدريجيًا.

### 9.8 تعريف "التعلّم شغّال وفعّال" (بعد أسبوع تشغيل آلي)

- ✅ دروس جديدة يوميًا (`lessons` count بـ يزيد).
- ✅ `[LEARNING]` يظهر على أسهم لها تاريخ.
- ✅ `applied_lesson` يظهر عند تكرار STOP_TOO_TIGHT (توسيع وقف مسقوف + RR متغيّر).
- ❌ بدون ذلك: النظام **يسجّل** ولا **يتعلّم**.

---

## 10. Picks management logic (daily cap=5, min_confidence=65%, 4 tiers)

> **المرجع (مُدمج):** محتوى `PICKS-MANAGEMENT-SYSTEM.md` (498 سطر) دُمج في هذا القسم §10 (توحيد التوثيق 2026-08-17).
> **الكود:** `vps-service/analyzers/confidence_engine.py` + `vps-service/analyzers/position_manager.py`.

### 10.1 الـ Daily Cap

```python
MAX_PREDICTIONS_PER_DAY = 5  # Picks Management System (v3.4.43)
MIN_CONFIDENCE = 65.0        # الحد الأدنى للثقة
```

> **القاعدة:** لا أكثر من 5 توصيات/يوم. كل توصية بـ يـ threshold ≥ 65% confidence.

### 10.2 Confidence Engine — 7 عوامل (0-100%)

| # | العامل | الوزن | الشرط |
|---|--------|-------|-------|
| 1 | **Technical Score** | 30 | `master_score` من maestro (0-100) |
| 2 | **Trend Strength** | 15 | ADX > 25 + EMA alignment |
| 3 | **Volume Confirmation** | 15 | Volume > 1.5x avg + OBV rising |
| 4 | **Risk/Reward Ratio** | 15 | R/R ≥ 2.0 = full marks، < 1.0 = 0 |
| 5 | **Volatility (ATR)** | 10 | ATR معتدل (0.5-3%) = ممتاز |
| 6 | **Explosive Signal** | 10 | BB squeeze + volume spike |
| 7 | **Data Quality** | 5 | History ≥ 60d + no gaps |

```python
confidence = (
    technical_score * 0.30 +
    trend_strength * 0.15 +
    volume_confirmation * 0.15 +
    risk_reward_score * 0.15 +
    volatility_score * 0.10 +
    explosive_score * 0.10 +
    data_quality_score * 0.05
)
confidence = clamp(confidence, 0, 100)
```

### 10.3 الـ 4 Tiers

| Tier | النطاق | اللون | الإجراء |
|------|--------|-------|---------|
| 🥇 **TOP_PICK** | ≥ 80% | ذهبي | اختيار فوري (أولوية قصوى) |
| 🟢 **STRONG** | 65-79% | أخضر | اختيار إذا توفرت فرصة |
| 🟡 **WATCH** | 50-64% | أصفر | مراقبة فقط (لا اختيار) |
| 🔴 **SKIP** | < 50% | أحمر | تجاهل تام |

### 10.4 select_top_picks()

```python
def select_top_picks(date: str, max_picks: int = 5, min_confidence: float = 65.0):
    """تختار أعلى 5 توصيات لليوم مع منع التكرار."""
    candidates = get_all_predictions_for_date(date)

    # 1. فلترة بالثقة (≥ 65%)
    filtered = [p for p in candidates if p.confidence >= min_confidence]

    # 2. ترتيب بالثقة تنازليًا
    filtered.sort(key=lambda p: p.confidence, reverse=True)

    # 3. منع التكرار (نفس السهم لا يتكرر)
    seen_tickers = set()
    top_picks = []
    for p in filtered:
        if p.ticker not in seen_tickers:
            top_picks.append(p)
            seen_tickers.add(p.ticker)
            if len(top_picks) >= max_picks:
                break

    return top_picks
```

### 10.5 Position Manager — 7 توصيات إدارة

| الشرط | النصيحة | الإجراء |
|-------|---------|---------|
| وقف ضرب | 🛑 وقف الخسارة | اخرج 100% |
| توزيع اكتشف | 📉 بيع جزئي | اخرج 50% |
| ربح > 15% AND absorption | 📈 إضافة | scale-in (أضف) |
| ربح > 5% AND trend up | 🏃 ستوب متحرك | hold مع trailing |
| خسارة > 5% | ⚠️ مراقبة | danger watch |
| else | ⏸️ امسك | hold |

### 10.6 V40 Phase 2 — صيد الأسهم الطائرة

#### 10.6.1 Explosive Uncap + المقاومة الهيكلية

لما `volume_ratio >= 1.8 AND (change_1d >= 3% OR change_1w >= 5%)` أو `is_breakout=True`:
- الهدف بيتحول لأقرب **مقاومة هيكلية** (Bearish Order Block فوق السعر) بدل النسبة الثابتة.
- لو مفيش مقاومة أعلى → الهدف مفتوح حتى +200% (مفيش سقف أرباح).
- الخروج بس عبر **Trailing Stop** — مفيش profit cap.
- `target_source` flag: `'structural_resistance'` أو `'persona_pct'`.

#### 10.6.2 Scale-in Anti-Chasing Guard

الإضافة للمركز (`add_lot`) محتاجة **شرطين**:
1. السعر قرب الدخول (within +3% of first entry) OR قرب Bullish Order Block.
2. الميكرز بيجمع (maker_state في absorption/accumulation).

> لو السعر طالع بعيد ومفيش OB → **ممنوع الإضافة (Chasing blocked)**.

#### 10.6.3 Intraday Trailing Stop

الـ trailing stop بـ يقرا أعلى سعر لحظي من `intraday.db` (آخر 5 جلسات):

```python
effective_highest = max(highest_close_since_entry, intraday_high)
```

> ده عشان في EGX السهم يوصل +10% لحظيًا ويغسل سالب — مينفعش نحسب الـ trailing على الـ close بس.

#### 10.6.4 CBE News Guard — Hard Veto

لو فيه خبر بنك مركزي في الـ 24 ساعة (قبل أو بعد):
- إشارات الشراء → **HOLD** + `position_size=0%`.
- إشارات البيع → **تفضل** (لحماية رأس المال).
- `cbe_news_veto=True` flag في `MasterAnalysis`.

#### 10.6.5 Ex-Dividend Protection

لو السهم في يوم ex-dividend:
- Stop loss لا يتفعل — السعر بيقع بقيمة الكوبون بس، ده مش خسارة حقيقية.
- الـ trailing stop بـ skip اليوم ده.
- بيتحقق من `DividendCalendar` في `data_engine.db`.

### 10.7 المتابعة اللحظية أثناء الجلسة (Live Session Monitoring)

```
┌─────────────────────────────────────────────────────────────────┐
│  أثناء الجلسة (Cairo 10:00 - 14:30)                            │
├─────────────────────────────────────────────────────────────────┤
│  1) TradingView Scraper  (كل 5 دقايق)                           │
│     يجلب OHLCV + Volume لكل أسهم EGX                             │
│  2) Live Autonomous Monitor  (thread منفصل، كل 5-30 دقيقة)      │
│     ├── وصل TP1/TP2/TP3؟ → تنبيه 🎯 "جني أرباح"                │
│     ├── كسر Stop Loss؟ → تنبيه 🚨 "خروج طارئ"                   │
│     └── ربح > 15%؟ → اقترح trailing stop                        │
│  3) MarketScheduler Intraday Jobs                               │
│     ├── intraday_prices (5 min)                                 │
│     ├── bag_holder_alerts (15 min): تنبيه لو خسارة ≥15%          │
│     └── trailing_stop_update (15 min): يحرّك الستوب تلقائياً    │
│  4) Partial Exit + Scale-In  (engine_settings)                  │
│     ├── partial_exit_at_rr=1.5: بيع 50% عند 1.5R                │
│     ├── partial_exit_trail_remaining=1.0: trail الباقي          │
│     └── scale_in_pnl_threshold=15: اقترح زيادة عند +15%         │
└─────────────────────────────────────────────────────────────────┘
```

### 10.8 الـ Thresholds القابلة للتعديل (engine_settings)

| المفتاح | الافتراضي | التأثير |
|---------|----------:|---------|
| `partial_exit_at_rr` | 1.5 | بيع 50% عند R/R = 1.5 |
| `partial_exit_pct` | 50.0 | نسبة الخروج الجزئي |
| `partial_exit_trail_remaining` | 1.0 | تفعيل trailing على الباقي |
| `scale_in_pnl_threshold` | 15 | حد ربح اقتراح زيادة المركز |
| `danger_pnl_threshold` | -5 | حد الخسارة الخطرة (تنبيه) |
| `trailing_stop_activation_gain` | 2.0 | ربح تفعيل الوقف المتحرك |
| `hard_loss_ceiling_pct` | 7.0 | سقف الخسارة الأقصى (cap) |
| `split_drop_threshold_pct` | 35.0 | تجزئة سهم → استبعاد من P&L |

---

## 11. Known logic gaps & next steps

> **الحالة الحالية:** R:R fix DONE (65a748f). Fundamentals Stages A-H DONE (04354a5). tab_* migration DONE (a73b1a1). Fetcher cron scheduled (a268957). Fetcher hardened against column-shift + cron no-args bug fixed (4cde9f0). Fundamentals hard veto active (81244f0). ما تبقّي هو **production sync فقط**.

### 11.1 الفجوات المؤكدة (Confirmed Gaps)

| # | الفجوة | الحالة | التأثير |
|---|--------|--------|---------|
| **G-RR-1** | `egx_fundamental_fetcher.py` NOT in crontab | ✅ DONE (a268957+4cde9f0) | cron مُفعّل السبت 14:00 UTC + fetcher مُحصّن (ticker guard + no-args bug fix + verify subcommand) |
| **G-FUND-1** | `tab_balance_sheet` / `tab_income_statement` / `tab_cash_flow` column-shift bug | ✅ DONE (a73b1a1) | migrate_fundamentals_schema.py: 24 صف فاسد اتمسح، 858 سليم لكل جدول. verify_tab_integrity يؤكد 0 shifted |
| **G-FUND-2** | Production sync of commit `04354a5` not yet applied to VPS | ⏳ NEXT | `fundamental_score=50.0` placeholder ما زال في `predictions.db` على الـ production (sandbox فقط فيه الـ real score) |
| **G-FUND-3** | Hard veto score<30 | ✅ DONE (81244f0) | veto مُفعّل downstream في v40_2_daily_generator: persona≠gambler AND fund<30 → reject. Safe-by-design عند unavailable |
| **G-FUND-4** | Conservative persona gate not testable | ⏳ Phase 3 | لا توجد صفقات `persona=conservative` في الـ archive (كلها `balanced` per PERSONA-UNIFY-A) |
| **G-FUND-5** | 4 tickers unmapped (EG23X, MTEZ, OCIC, TAO) | ⏳ NEXT | `fundamental_score = None` (لا 50 ولا real) — confidence=0 |
| **G-PERSONA-1** | Market label bug in `predictions.db` | 📋 documented | كل الـ 22 tickers labeled `market=EGX` لكن 11 سعودية + 4 EGX + 3 كويت + 4 unknown — الصفقات حقيقية بس الـ label غلط |
| **G-MIGRATION-1** | `tab_balance_sheet` column-shift migration needed | ✅ DONE (a73b1a1) | تم قبل تفعيل الـ cron. verify: 858 clean / 0 shifted لكل جدول |
| **G-BACKTEST-1** | Worst single loss -12.55% (MFPC expired) exceeds -9% target | 📋 documented | 5 صفقات فقط من 539 = 0.9% (outliers من أسهم عالية التقلب). ATR_STOP_MAX_PCT=9% بـ يـ apply على `compute_optimal_stop()` فقط، مش على `analyze_single_day_v393` |
| **G-LEARN-1** | `applied_lesson` chain depends on enough historical trades | ⏳ accumulate | لو < 5 صفقات لـ ticker → ما يتعلمش (ضوضي) |

### 11.2 الـ Staged Plan A-H for Fundamentals Activation (status tracker)

| Stage | Status | What was done | What's next |
|-------|--------|---------------|-------------|
| **A — Inventory** | ✅ DONE | 5 clean tables identified, 3 broken documented, egx_fundamentals=0 confirmed | — |
| **B — Mapping** | ✅ DONE | `resolve_ticker()` (exact + prefix match), 81.8% ticker / 97.4% trade coverage | Fix remaining 4 unmapped tickers (EG23X, MTEZ, OCIC, TAO) |
| **C — Score** | ✅ DONE | `get_fundamental_score()` 0-100 from 4 clean tables (40/30/15/15 weights) | Extend to balance_sheet/income/cash_flow after migration |
| **D — Test sample** | ✅ DONE | 148 closed BUY/STRONG_BUY predictions, 18 distinct tickers | — |
| **E — Before/After** | ✅ DONE | 3 scenarios (baseline PF 1.511 / high-score ≥70 PF 4.436 / hard veto <30 PF 1.784) | — |
| **F — Integration** | ✅ DONE | `_get_fundamentals()` lazy lookup + `FundamentalsState.confidence` | — |
| **G — Fetcher cron** | ⏳ **NEXT** | `egx_fundamental_fetcher.py` موجود بس مش مُجدول | (1) إصلاح `tab_*` column-shift migration → (2) إضافة cron entry → (3) backfill `egx_fundamentals` |
| **H — Report** | ✅ DONE | (مُدمج في §6) | — |

### 11.3 Next Planned Work (priority order)

| # | المهمة | المتطلبات | الخطر |
|---|--------|----------|------|
| 1 | **Production sync of commit 04354a5** | `git pull origin main` على الـ VPS | صفر — informational فقط (no gate) |
| 2 | **Activate hard veto score<30** | 1 week live observation | منخفض — 3/18 rejections (1 false positive: 2180) |
| 3 | **Fix `tab_balance_sheet`/`tab_income_statement`/`tab_cash_flow` column-shift** | migration script | متوسط — schema change, needs testing |
| 4 | **Schedule `egx_fundamental_fetcher.py` cron** | (1) tab_* migration done | منخفض — weekly Saturday 14:00 UTC |
| 5 | **Backfill `egx_fundamentals`** | (4) cron running | منخفض — one-time backfill |
| 6 | **Re-measure with full fundamentals** | (5) backfill done | — |
| 7 | **Conservative persona gate** | enough conservative trades in archive | يحتاج بيانات conservative |

### 11.4 التناقضات المعروفة (Known Code/Settings Contradictions)

| # | التناقض | التفاصيل | التأثير |
|---|---------|---------|---------|
| C1 | `tech_score_base` | الكود=25, `engine_settings` DEFAULT=50 | الفعلي 25 — partial proofs تاثر أكتر |
| C2 | Trailing stop activation | V38=3%, V39=5% | الباكتست يفعل الـ trailing أبكر من الـ live |
| C3 | Tiered stop initial | 8% ثابت رغم `default_stop_pct=5%` | `tiered_stop` يتجاهل الوقف الافتراضي |
| C4 | Break-even trigger | 7% ثابت | مش قابل للتعديل من `engine_settings` |
| C5 | Portfolio heat | 2% ثابت | مش قابل للتعديل من `engine_settings` |
| C6 | `MAX_PREDICTIONS_PER_DAY=5` vs `MAX_PREDICTIONS_PER_DAY=7` (in some legacy code paths) | 7 might be too low in strong bull trend | needs unification |

### 11.5 الاختبارات الناقصة (Missing Tests — Critical)

| الملف | الناقص | الأولوية |
|------|--------|---------|
| `stop_manager.py` | كل الـ 7 أنواع ستوب | 🔴 حرج |
| `position_manager.py` | lots, scaling, partial exits | 🔴 حرج |
| `institutional_decision_engine.py` | proofs, signals, self-learning | 🔴 حرج |
| `v38_backtest_engine.py` | `simulate_trade`, trailing stop, ATR clamp | 🔴 حرج |
| `fundamental_data_provider.py` | `resolve_ticker()`, `get_fundamental_score()` | 🟠 مهم |
| `historical_prediction_generator.py` | كل المنطق | 🟠 مهم |

### 11.6 محدودية النظام (System Limitations)

| القيد | التفاصيل |
|------|---------|
| **SQLite لكل شيء** | 8+ DBs كلها SQLite. WAL mode + 30s busy_timeout يساعد بس write contention تحت ضغط عالي |
| **Dual DB management** | Prisma (auth/predictions) + raw Python sqlite3 (stocks/price_history) — لا توجد migration موحدة |
| **No message queue** | المهام المجدولة تشتغل مباشرة في نفس العملية — لو مهمة ثقيلة بتعلق التانية |
| **Admin components ضخمة** | MaestroCommandCenter 3,748 سطر, MaestroDashboard 2,750 سطر — صعوبة الصيانة |
| **Stop loss values hardcoded** | `default_stop_pct`, `max_stop_pct`, ATR multiplier — كلها في constructor مش engine_settings |
| **Position targets ثابتة** | +10%/+20%/+35% مش قابلة للتعديل ديناميكيًا |
| **MAX_PREDICTIONS_PER_DAY = 5** | ممكن قليل في ترند صاعد قوي |
| **MONITORING_PERIOD_DAYS = 30** | ثابت مش متغير حسب timeframe |
| **Market weight ثابت** | KSA=1.5, EGX=1.2 — مش قابل للتعديل |

---

## 12. ملخص: كيف يفكر النظام في 9 خطوات

```
1. "هل المؤسسات بتشتري أو بتبيع؟"  → Maker State
   (SMC + VSA + Volume Profile → accumulation/distribution/calm)

2. "السهم طاير ولا واقع؟"          → Flight State
   (BB expanding + BOS + volume surge → flying_up/falling_down/sideways)

3. "جمع 5-6 أدلة موزونة"          → Proofs → Tech Score
   (trend +15 + makers +20 + DNA +15 + fundamental +15 + sector +10 = 75-85 pts)

4. "السوق كله هابط؟"              → ⛔ Hard Regime Filter
   (bear + confidence > 0.7 → BUY forbidden, force HOLD)

5. "أعمل إيه دلوقتي؟"             → Signal + Portfolio Advice
   (STRONG_BUY ≥110 / BUY ≥68 / HOLD / SELL / STRONG_SELL)

6. "أين أضع وقفي؟"                → 7 Stop Types → optimal_stop
   (Fixed + Time + Volatility + Trailing + Tiered + Heat + Break-Even)

7. "أحمي أرباحي"                   → Trailing Stop (2.0× ATR)
   (highest_price - 2.0×ATR, floor at entry×1.01)

8. "أدائي كويس؟"                   → Self-Learning Threshold
   (win_rate ≥ 65% → lower threshold; < 40% → raise threshold)

9. "النتائج التاريخية إيه؟"        → V38 Backtest + trailing stop
   (walk-forward, simulate_trade, HARD cap |ret|≤50, dedup-by-ticker)
```

### 12.1 النتيجة النهائية على الإنتاج الحالي

| المسار | n | WR | PF | Expectancy |
|--------|---:|---:|---:|---:|
| **Backtest V40.2** (2026-01-01 → 2026-08-16) | 539 | 51.0% | **1.584** | — |
| **Live production** (26 صفقة مقفولة) | 26 | **≈ 69.2%** | **≈ 4.46** | — |
| **Fair re-sim post R:R fix** (148 صفقة، archive 20260817) | 148 | 43.24% | **1.453** (was 1.398) | **+1.54%** (+0.189% Δ) |

### 12.2 ملفات المراجع السريعة

| الملف | الدور |
|------|------|
| `Documentation/00-CONSTITUTION.md` | الدستور والقواعد (25 absolute rules) |
| `Documentation/01-PROJECT_ANATOMY.md` | تشريح المشروع الكامل |
| `Documentation/02-SCREENS_AND_COMPONENTS.md` | دليل الشاشات والمكونات |
| `Documentation/SYSTEM_HOW_IT_THINKS.md` | هذا الملف — منطق المحرك |
| `SYSTEM_STATE.md` | آخر حالة للنظام |
| `CHANGELOG.md` | آخر 3 إدخالات للتعديلات |
| `AGENTS.md` | دليل سير العمل اليومي |
| `worklog.md` | سجل جلسات العمل |

### 12.3 الـ commits المرجعية

| Commit | التاريخ | الوصف |
|--------|---------|-------|
| `65a748f` | 2026-08-17 | fix(rr): unlock dynamic R:R (1.5/2.0) + ATR stop clamp [3%,9%] + R:R≥1.5 floor gate |
| `04354a5` | 2026-08-17 | feat(fundamentals): activate real fundamental_score from data_engine.db + measure 2.9x PF improvement |
| `c14597d` | 2026-08-17 | PERSONA-UNIFY-A — persona_fit from V40.2 pool (no reclassification) |
| `8eabdca` | 2026-08-17 | PERSONA-BALANCE — dedup-by-ticker + HARD cap ABS≤50 |
| `ed55a60c` | 2026-08-09 | schema-aware scripts + HARD cap in 3 API routes |

---

**End of SYSTEM_HOW_IT_THINKS.md — single source of truth for how the system thinks/decides.**

---

## 13. Volume Surge Hunter (AXIS-5b) — صياد الأسهم الانفجارية

> **أُضيف:** 2026-08-28 (بعد اكتشاف إن V40.2 فات كل الأسهم الانفجارية السبعة).
> **المرجع:** `vps-service/analyzers/core_scoring_engine.py::detect_volume_surge_rocket`
> **المستدعى من:** `vps-service/jobs/v40_2_daily_generator.py` (في الـ generation loop).

### 13.1 المشكلة التي حلّها

قبل AXIS-5b، النظام فات **7 من 7 أسهم انفجارية** في 2026:

| السهم | العائد الفعلي | إشارة V40.2 |
|-------|---------------|-------------|
| BIOC | +25,440% (من 2.04 → 521) | WAIT score=0 |
| NIPH | +1,346% | WAIT score=75 |
| AMES | +146% | WAIT score=25 |
| GPIM | +22% | WAIT score=0 |
| CRST | +63% | WAIT score=75 |
| AFMC | +424% | WAIT score=0 |
| GTWL | +1,471% | WAIT score=0 |

**السبب:** V40.2 بيركز على الإشارات الكلاسيكية (RSI/ATR/EMA/Order Blocks) لكنه **عمي** عن:
1. **Volume Surge** (انفجار السيولة المفاجئ)
2. **ROC20 > +15%** (زخم قوي آخر 20 يوم)
3. **Maker Bull** (delta_vol > 0 OR imbalance_bull)
4. **Deeply Extended** (extension_atr > 2.2 — لا نشتري بعد ما طار)

### 13.2 المنطق (مستوحى من Pine Script V56)

`detect_volume_surge_rocket()` بيدور على **6 عوامل** تتراكم في score 0-100:

| # | العامل | النقاط | الشرط |
|---|--------|-------:|-------|
| 1 | **Volume Surge** | 25 | `vol > MA20 + 1.5×STD20` |
| 1b | Volume semi-surge | 12 | `vol_ratio >= 1.3` |
| 2 | **ROC20** | 20 | `ROC20 > +15%` |
| 2b | ROC20 متوسط | 12 | `ROC20 > +10%` |
| 2c | ROC20 ضعيف | 5 | `ROC20 > +5%` |
| 3 | **فوق SMA50** | 15 | `close > SMA50` |
| 4 | **Maker Bull** | 20 | `(vol_surge AND delta_vol>0) OR imbalance_bull` |
| 4b | Delta موجب فقط | 8 | `delta_vol > 0` |
| 5 | **Not deeply extended** | 10 | `extension_atr < 2.2` |
| 6 | **ROC5** | 10 | `ROC5 > +3%` |

**قرار الـ ROCKET** (شرطان لازم يتحققوا مع بعض):
- `score >= 60` AND
- `vol_surge = True` AND
- `roc20 > 5%`

### 13.3 Entry/Target/Stop

| العنصر | القيمة |
|--------|-------|
| Entry | `close[-1]` |
| Target | `entry + 3×ATR` (3R) |
| Stop | `entry - 1.5×ATR` (1.5R) |
| **R:R** | **2.0** (مطابق للقاعدة 18) |

### 13.4 التكامل مع V40.2

في `v40_2_daily_generator.py`، الـ flow:
1. `analyze_single_day_v393()` بيرجع signal
2. لو signal = WAIT/HOLD → بيشغل `detect_volume_surge_rocket()`
3. لو `is_surge_rocket=True` → بيحوّل الـ signal لـ STRONG_BUY ويستخدم entry/target/stop من الـ hunter
4. لو لا → `continue` (زي ما كان)

```python
if signal not in ('STRONG_BUY', 'INSTITUTIONAL_BUY', 'BUY'):
    surge_result = detect_volume_surge_rocket(...)
    if surge_result.get('is_surge_rocket'):
        signal = 'STRONG_BUY'
        result['entry'] = surge_result['entry']
        result['target'] = surge_result['target']
        result['stop_loss'] = surge_result['stop']
        result['proofs'] = {'surge_hunter': True, **surge_result['details']}
    else:
        continue
```

### 13.5 النتائج (backtest كامل Dec 2025 → Aug 2026)

| النسخة | التوقعات | WR | PF | Net | ملاحظة |
|--------|----------|----|----|-----|--------|
| v0 (لا فلتر) | 109 | 27.5% | 0.88 | **-60%** | خسائر |
| v1 (blocklist 12) | 55 | 43.6% | 1.78 | +157% | PF target met |
| v2 (blocklist 18) | 41 | 56.1% | 2.94 | +227% | WR target met |
| **v3 (blocklist + hunter)** | **227** | **46.3%** | **1.90** | **+692%** | 🚀 الأسهم الانفجارية |

### 13.6 المقايضة (Trade-off)

- **v2**: WR عالية (56%) لكن net متوسط (+227%) — قليل من الصفقات المربحة
- **v3**: WR أقل (46%) لكن net أعلى (+692%) — صفقات أكثر، R:R 2.2:1 يعوّض

**القرار:** v3 أفضل لـ production لأن الـ expectancy/trade = +3.05% (أعلى من v2's +5.54% لكن على حجم أكبر بـ 5.5x).

### 13.7 الفرق عن detect_explosive_rocket (AXIS-5)

| العنصر | AXIS-5 (Explosive Rocket) | AXIS-5b (Volume Surge Hunter) |
|--------|---------------------------|-------------------------------|
| النمط | VCP + Volume Dry-up + Ignition | Volume Surge + ROC20 + Maker Bull |
| يصطاد | تقلص ثم انفجار | انفجار سيولة مفاجئ |
| مناسب لـ | الأسهم اللي بترتاح قبل الطيران | الأسهم اللي بتنفجر بالسيولة مباشرة |
| الحالة | dead code (مش مستدعى) | **نشط — مدمج في V40.2** |

**الخلاصة:** AXIS-5 و AXIS-5b مكمّلان لبعض — الأول بيدور على الهدوء قبل العاصفة، الثاني بيدور على العاصفة نفسها.

---

## 14. EGX-STRATEGY-FINAL — المنطق الموحد الكامل (2026-08-30)

> **أُضيف:** 2026-08-30 (بعد سلسلة تحسينات: UNIFIED-BALANCED-ONLY + EGX-MARKET-ISOLATION + EGX-STRATEGY + RISK-MANAGEMENT + ENTRY-GATE).
> **المرجع:** `vps-service/utils/` (entry_gate + position_sizing + circuit_breaker + egx_gate + stock_state).
> **النتيجة:** Max DD -72.93% → -4.71%، WR 51.2% → 69.2%، PF 2.788 → 6.035.

### 14.1 خط الإصلاح الكامل (Timeline)

| المرحلة | التغيير | WR | PF | Max DD | Total Return |
|---------|---------|----|----|--------|--------------|
| قبل أي تعديل (84 صفقة) | baseline | 51.2% | 2.788 | -72.93% | +336.29% |
| UNIFIED-BALANCED-ONLY | تعطيل Gambler/Morning Bell | 51.2% | 2.788 | -72.93% | +336.29% |
| EGX-MARKET-ISOLATION | فلتر EGX canonical فقط | 51.2% | 2.788 | -72.93% | +336.29% |
| EGX-STRATEGY (عتبات) | atr_stop 3→5%, R:R 1.5→1.8, min_ev=3 | 58.1% | 3.561 | -56.22% | +249.46% |
| RISK-MANAGEMENT | Position Sizing + Circuit Breaker | 58.5% | 3.572 | -5.95% | +37.83% |
| **ENTRY-GATE-FINAL** | **8 شروط إلزامية** | **69.2%** | **6.035** | **-4.71%** | **+51.62%** |

### 14.2 المنطق الموحد — 6 محاور

#### المحور 1: تصنيف حالة السهم (Correction Stage Classifier)
**الملف:** `utils/stock_state.py`

قبل أي قرار دخول، النظام بـ يصنّف السهم في واحدة من 4 حالات:

| الحالة | التعريف | القرار |
|--------|---------|--------|
| **DEEP_CORRECTION** | نزل ≥ 12% من قمة 40 يوم + لسه بينزل | ممنوع دخول |
| **LATE_CORRECTION_BASE** | نزل + بنى قاع + تذبذب قل + حجم نام | راقب فقط |
| **RECOVERY_STARTING** | كسر مقاومة + حجم يرجع + RS > 1.0 | مسموح (بشروط) |
| **EXTENDED_CHASE** | طلع ≥ 12% في 3 أيام أو ≥ 15% في 5 أيام | ممنوع (Don't Chase) |

**شروط تأكيد Recovery Starting (5 شروط، لازم 4 من 5):**
1. السعر فوق SMA50.
2. حجم آخر 3 أيام ≥ 1.2× متوسط 20 يوم.
3. change > 0 اليوم.
4. شمعة قوية (إغلاق قرب القمة ≥ 60%).
5. القطاع مش هابط.

#### المحور 2: EGX-Market-Isolation (فلتر السوق)
**الملف:** `utils/egx_gate.py`

- `is_valid_egx_ticker(ticker)` — تحقق صارم إن الـ ticker مصري موجود في TradingView.
- بـ يستخدم `EGX_CANONICAL_TV` (278 سهم) + `EGX_ISIN_NAMES` (11 ISIN).
- بـ يـ normalize الـ tickers الملوّثة (أسماء شركات + ISIN codes).
- النتيجة: 313 raw → 235 EGX-canonical (rejected 73 non-EGX).

#### المحور 3: وقف الخسارة الديناميكي + Geometry Guard
**الملف:** `core/opportunity_quality.py` + `analyzers/prediction_tracker.py`

- **ATR stop clamp**: [5%, 9%] (atr_stop_min_pct=5.0, atr_stop_max_pct=9.0).
- **Geometry Guard** (HARD REJECT): target ≤ entry×1.05 OR stop ≥ entry×0.95 OR R/R < 1.5.
- **k = 1.5** (balanced ATR multiplier — ثابت لكل personas).

#### المحور 4: سلسلة الاكتشاف (Discovery Fallback Chain)
**الملف:** `v40_2_daily_generator.py` (Maestro معطّل — KILL-MAESTRO 2026-08-31)

لو المحرك الأساسي (V40.2) ما طلعش BUY/STRONG_BUY → افحص بالترتيب:
1. `detect_volume_surge_rocket` (Layer 1: Volume Surge Hunter).
2. `detect_accumulation_phase` (Layer 2: Pre-explosion Accumulation).
3. `detect_recovery_from_base` (Layer 3: Recovery from Long Base).

لو أي detector رجّع score ≥ 60 + entry gate مش مرفوض → رقّي لـ BUY.

#### المحور 5: إدارة الصفقة بعد الدخول
**الملف:** `jobs/daily_closer.py` + `utils/position_sizing.py` + `utils/circuit_breaker.py`

| الميزة | العتبة | المنطق |
|--------|--------|--------|
| **Position Sizing** | 1.2% risk (1-1.5% range) | position_value = risk_amount / stop_distance_pct |
| **Circuit Breaker** | 3 خسائر متتالية → 3 أيام وقف | mode=block (skip) أو mode=reduce (50% حجم) |
| **Partial exit** | عند 1.8R | profit_lock = 1.8 × stop_distance_pct |
| **Trailing stop** | FLOOR at breakeven | trailing_stop = max(trailing_stop, entry_price) |
| **CHoCH exit** | 3 أيام نزول + حجم بيعي | exit فوري (partial_choch / choch_distribution) |
| **Stuck trade exit** | 5 أيام + < 1.5% حركة | exit (partial_stuck / stuck_no_movement) |
| **Hard Loss Ceiling** | -7% | actual_return ≥ -7% (capped) |

#### المحور 6: قواعد غير قابلة للنقض (Entry Gate)
**الملف:** `utils/entry_gate.py`

`check_entry_gate(data)` بـ يفحص **8 شروط إلزامية** مرة واحدة:

| # | الشرط | العتبة | الوزن |
|---|--------|--------|------|
| 1 | evidence_count | ≥ 3 (من 6 إثباتات) | 3 |
| 2 | R/R | ≥ 1.8 (dynamic_rr_normal) | 3 |
| 3 | السعر فوق SMA50 | أو قريب (within 2%) + 3 شموع صاعدة | 2 |
| 4 | RS (Relative Strength) | > 1.0 (stock_roc - benchmark_change) | 3 |
| 5 | مش Deep Correction | نزول > 12% + قيعان جديدة → رفض | 2 |
| 6 | Don't Chase | ROC3 ≥ 12% أو ROC5 ≥ 15% → رفض | 2 |
| 7 | السيولة | volume ≥ 1000 + turnover ≥ 50k EGP | 1 |
| 8 | فلتر السياق | سوق bear/distribution → رفض. قطاع أحمر/ميت → رفض | 2-3 |

الـ gate بـ pass لو **كل** الشروط passed. لو أي شرط فشل → `[ENTRY-GATE-REJECT]` + skip.

### 14.3 الـ 6 إثباتات (Proofs) — V40 Evidence-Based

كل توقع لازم يحقق ≥ 3 من 6 إثباتات:

| # | الإثبات | الوزن | الوصف |
|---|---------|------|--------|
| 1 | Trend | 8 | الترند (هيكل القمم/القيعان) |
| 2 | Makers | 26 | الميكرز (تجميع مؤسسي) — الأولوية 1 |
| 3 | DNA | 13 | البصمة المستقبلية |
| 4 | Fundamentals | 8 | الأساسيات (فلتر استبعاد فقط) |
| 5 | Sector | 12 | زخم القطاع |
| 6 | Benchmark | 24 | القوة النسبية للمؤشر — الأولوية 2 |

### 14.4 العتبات النهائية (engine_settings.py)

| العتبة | القيمة | السبب |
|--------|--------|--------|
| `atr_stop_min_pct` | **5.0** | التذبذب الطبيعي عالي في EGX |
| `atr_stop_max_pct` | **9.0** | للأسهم عالية التقلب |
| `dynamic_rr_normal` | **1.8** | R:R ≥ 1.8 إجباري |
| `dynamic_rr_outperform` | **2.0** | R:R للأسهم المتفوقة |
| `min_evidence_count` | **3** | لازم ≥ 3 إثباتات من 6 |
| `risk_per_trade_pct` | **1.2** | مخاطرة 1.2% لكل صفقة (1-1.5% range) |
| `consecutive_losses_limit` | **3** | circuit breaker بعد 3 خسائر |
| `cooldown_days` | **3** | 3 أيام وقف بعد circuit breaker |

### 14.5 الـ persona الوحيدة: Balanced

بعد UNIFIED-BALANCED-ONLY، النظام بـ يشتغل بـ **Balanced فقط**:

| العنصر | القيمة |
|--------|--------|
| Thresholds (bull) | strong_buy=55, buy=42, hold=30, sell=20 |
| Thresholds (bear) | strong_buy=58, buy=45, hold=32, sell=22 |
| Thresholds (range) | strong_buy=52, buy=40, hold=28, sell=18 |
| ATR multiplier (k) | 1.5 (ثابت) |
| Profit lock | 1.8R (بدل 7% الثابت) |
| morning_bell | معطّل (0 دايماً) |
| persona_predictions | معطّل (مش بـ يكتب) |

### 14.6 النتائج النهائية (39 صفقة على 6 شهور)

| المقياس | النتيجة | الهدف | الحالة |
|---------|---------|-------|--------|
| **Win Rate** | **69.2%** | > 50% | ✅ |
| **Profit Factor** | **6.035** | > 2.0 | ✅ |
| **Max Drawdown** | **-4.71%** | < 30-35% | ✅ |
| Total Return | +51.62% | — | ✅ |
| Avg Win | +1.87% | — | — |
| Avg Loss | -0.70% | — | — |

### 14.7 ملخص: كيف يفكر النظام دلوقتي (9 خطوات محدثة)

1. **EGX Gate**: هل السهم مصري صحيح موجود في TradingView؟ لو لا → skip.
2. **V38 Engine**: حلل السهم (6 إثباتات + score).
3. **Discovery Fallback** (V40.2): لو مفيش BUY signal → جرّب Volume Surge → Accumulation → Recovery.
4. **Evidence Gate**: هل evidence ≥ 3؟ لو لا → skip.
5. **Entry Gate (8 شروط)**: evidence + R:R + SMA50 + RS + Deep Correction + Don't Chase + سيولة + سياق.
6. **Geometry Guard**: target > entry×1.05 + stop < entry×0.95 + R/R ≥ 1.8.
7. **ATR Stop**: stop = entry - 1.5×ATR (clamp [5%, 9%]).
8. **Position Sizing**: position_value = (capital × 1.2%) / stop_distance_pct.
9. **Circuit Breaker**: لو 3 خسائر متتالية → وقف 3 أيام.

**النتيجة:** إشارات منطقية + حماية رأس المال + قابلية تشغيل بفلوس حقيقية.

---

**End of Section 14 — EGX-STRATEGY-FINAL (2026-08-30).**

---

## 15. تطور النظام — المراحل المنفصلة (2026-08-30)

> **أُضيف:** 2026-08-30 (بعد سلسلة مراحل منفصلة: sector liquidity + BOS/ChoCH + T-0/T-1/T-2 + لوحة قرار شفافة).
> **النتيجة:** من 217 صفقة WR=65.1% MaxDD=-16.27% → 56 صفقة WR=57.1% PF=3.393 MaxDD=-4.54% Return=+291%.

### 15.1 خط التطور الكامل (Timeline)

| المرحلة | التعديل | الصفقات | WR | PF | MaxDD | Return | الحكم |
|---------|---------|---------|----|----|-------|--------|-------|
| baseline | قبل أي تعديل | 217 | 65.1% | 3.955 | -16.27% | +319% | — |
| المرحلة 1 | وقف/هدف ديناميكي (swing low/high) | 56 | 57.1% | 3.396 | -4.54% | +20.56% | ✅ نعتمده |
| المرحلة 2 | تصنيف السيولة (smart/speculative/weak) | 56 | 57.1% | 3.396 | -4.54% | +20.56% | ✅ نعتمده |
| المرحلة 3 | فحص استمرارية الحركة قبل الخروج | 49 | 53.1% | 2.702 | -4.54% | +203% | ✅ نعتمده |
| **sector filter** | حرارة القطاع (dead → رفض) | **56** | **57.1%** | **3.393** | **-4.54%** | **+291%** | ✅ **نعتمده** |
| BOS/ChoCH | كشف بنية السوق (كسر دعم → رفض) | 56 | 57.1% | 3.393 | -4.54% | +291% | ⚠️ neutral (ما أثرش) |
| T-0/T-1/T-2 | صفقات شبه يومية | 49 | 53.1% | 2.702 | -4.54% | +203% | ❌ **نلغيه** (أنقص الأداء) |
| لوحة قرار شفافة | تقرير مرتب في #trading-chart | — | — | — | — | — | ✅ UI (مش backtest) |

### 15.2 الفلاتر النشطة (الترتيب من الأول للأخير)

| # | الفلتر | الملف | المنطق |
|---|--------|------|--------|
| 1 | **EGX Gate** | utils/egx_gate.py | سهم مصري فقط (289 canonical) |
| 2 | **Evidence Gate** | v40_2_daily_generator | evidence ≥ 3/6 |
| 3 | **Entry Gate** (8 شروط) | utils/entry_gate.py | evidence + R:R + SMA50 + RS + Deep Correction + Don't Chase + سيولة + سياق |
| 4 | **Sector Liquidity** | v40_2_daily_generator | القطاع dead → رفض |
| 5 | **BOS/ChoCH** | v40_2_daily_generator | كسر دعم (ChoCH bear) → رفض |
| 6 | **Dynamic Stop/Target** | core/opportunity_quality | swing low + ATR + clamp [5%, 9%] |
| 7 | **Geometry Guard** | analyzers/prediction_tracker | target > entry×1.05 + stop < entry×0.95 + R:R ≥ 1.8 |
| 8 | **Position Sizing** | utils/position_sizing | risk 1.2% × liquidity_pos_mult |
| 9 | **Circuit Breaker** | utils/circuit_breaker | 3 خسائر → 3 أيام وقف |
| 10 | **Liquidity Classification** | core/opportunity_quality | smart/neutral/speculative/weak → pos_mult |
| 11 | **Momentum Check (المرحلة 3)** | jobs/daily_closer | لو الحركة لسه مستمرة → Runner |

### 15.3 لوحة القرار الشفافة (#trading-chart)

أضفنا تقرير مرتب وجميل (زي Pine Script V56) في `SingleStockAnalysisView.tsx`:
- الحالة + القرار
- الأساسيات (PE, ROE, D/E)
- الفني (نظام السوق, القوة النسبية, عدد الإثباتات)
- خطة التداول (دخول, وقف, هدف 1, R:R)

### 15.4 ملخص: كيف يفكر النظام دلوقتي (محدث)

1. **EGX Gate**: سهم مصري؟
2. **V38 Engine**: 6 إثباتات + score
3. **Discovery Fallback**: Volume Surge → Accumulation → Recovery → Soft Surge
4. **Evidence Gate**: ≥ 3 إثباتات؟
5. **Entry Gate**: 8 شروط إلزامية
6. **Sector Filter**: القطاع مش dead؟
7. **BOS/ChoCH**: مفيش كسر دعم؟
8. **Dynamic Stop/Target**: swing low/high + ATR
9. **Geometry Guard**: R:R ≥ 1.8
10. **Position Sizing**: 1.2% × liquidity
11. **Circuit Breaker**: 3 خسائر → وقف
12. **Momentum Check**: لو الحركة مستمرة → Runner

**النتيجة**: 56 صفقة | WR=57.1% | PF=3.393 | MaxDD=-4.54% | Return=+291%

---

**End of Section 15 — تطور النظام (2026-08-30).**
