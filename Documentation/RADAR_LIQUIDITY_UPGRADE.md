# رادار السيولة — ترقية LIQUIDITY RADAR UPGRADE 🛰️

> **الملف المرجعي الرسمي** لترقية رادار السيولة (Liquidity Radar Upgrade) المُنفَّذة في 2026-09-27 عبر المهام `RADAR-A` + `RADAR-B` + `RADAR-C` + `RADAR-MAIN`.
>
> **النطاق:** 6 ميزات جديدة (5 endpoints + 1 pipeline مُتوصِّل سابقاً) + 4 مكونات UI + 2 libs جديدة + 2 ملفات مُعدَّلة surgical.
>
> **المستهدفون:** مطوّرو الـ Backend، مطوّرو الـ Frontend، فريق الـ QA، المالك (Owner) للمراجعة المعمارية.

---

## جدول المحتويات

| # | القسم | الوصف |
|---|------|------|
| 1 | [مقدمة (Introduction)](#1-مقدمة-introduction) | ما هو رادار السيولة + ماذا أضفنا + لماذا |
| 2 | [الميزات الجديدة (6 Features)](#2-الميزات-الجديدة-6-features) | تفاصيل كل ميزة + API + UI + مثال عملي |
| 3 | [قاعدة البيانات (Database)](#3-قاعدة-البيانات-database) | radar_signal_tracking + user_notifications + ملفات JSON |
| 4 | [التدفقات (Flows)](#4-التدفقات-flows) | warmup + signal verification + Radar→V40.2 |
| 5 | [المخطط المعماري (Architecture)](#5-المخطط-المعماري-architecture-diagram) | علاقة المكونات ببعضها |
| 6 | [خريطة الملفات (File Map)](#6-خريطة-الملفات-file-map) | جدول بكل ملف جديد/معدّل |
| 7 | [نقاط التكامل (Integration Points)](#7-نقاط-التكامل-integration-points) | V40.2 + alert-engine + user_notifications |
| 8 | [خطة الاختبار (Testing Checklist)](#8-خطة-الاختبار-testing-checklist) | checkpoints للتحقق اليدوي |
| 9 | [الصيانة والترقيات المستقبلية](#9-الصيانة-والترقيات-المستقبلية-maintenance--future-upgrades) | إضافة signal_type / threshold / alert type |

---

## 1. مقدمة (Introduction)

### 1.1 ما هو رادار السيولة؟

**رادار السيولة (Liquidity Radar / Maker Radar)** هو طبقة تحليلية مساعدة في المنصة تُشغَّل عبر سكريبت Python مستقل (`scripts/maker_radar.py`) يفحص يومياً ~303 سهم على البورصة المصرية (EGX) ويُصنِّفها إلى 4 قوائم:

| القائمة (path) | الوصف العربي | الحالة |
|---|---|---|
| `quiet_list` | تجميع هادي (قوي/ضعيف) | السهم بيتجمّع بصمت قبل انفجار محتمل |
| `pre_surge_list` | ما قبل الانفجار | السهم وصل لمرحلة متقدمة من التجميع |
| `explosive_list` | انفجار حجمي | حجم تداول انفجاري + اختراق سعري |
| `early_break_list` | اختراق مبكر | اختراق مقاومة مع تأكيد حجمي |

الرادار يكتب نتيجته في ملف JSON مؤقَّت (`scripts/output/maker_radar_YYYYMMDD.json`) و طبقة الـ Next.js API بتقرأ هذا الملف بشكل فوري (instant <50ms) عبر `src/lib/radar-cache.ts`. الـ cache ليه TTL = 15 دقيقة، و لو قديم → الـ API بيبدّي background warmup (fire-and-forget spawn).

### 1.2 ماذا أضفنا في هذه الترقية؟

قبل الترقية، الرادار كان مجرد **عارض قوائم** — يُظهر للـ user الأسهم المصنَّفة لكن بدون:

- ❌ درجة كمية لتوقيت الدخول (entry timing)
- ❌ تتبُّع مصير الإشارات (win/loss بعد 7/14/30 يوم)
- ❌ توزيع الحجم على مستويات السعر (volume profile)
- ❌ رؤية سيولة القطاع ككل (sector aggregation)
- ❌ تنبيهات تلقائية على تحولات الرادار (state transitions)

الترقية أضافت **6 ميزات** (5 endpoints جديدة + 1 pipeline كان متوصِّل سابقاً) + **4 مكونات UI** + **2 libs** + **تعديلات surgical** على 3 ملفات موجودة. الإجمالي: ~2000 سطر كود جديد.

### 1.3 لماذا هذه الترقية مهمة للمستخدم النهائي؟

| المشكلة قبل الترقية | الحل بعد الترقية | الأثر على المستخدم |
|---|---|---|
| المستخدم بيشوف "COMI في قائمة الانفجار" لكن مش عارف هل ده توقيت دخول كويس؟ | `Entry Timing Score 0-100` بيجاوب على السؤال بدرجة كمية من 4 عوامل | قرار دخول مدروس بدلاً من حدس |
| مفيش way to know هل إشارات الرادار دقيقة أصلاً؟ | `Signal Tracker` بيسجّل كل إشارة ويتحقق منها بعد 7/14/30 يوم ويعرض win rate | ثقة + شفافية + قياس دقة الرادار |
| مستخدم بيشوف "تجميع قوي" لكن مش فاهم معنى ذلك كمياً | `Liquidity Footprint` بيُظهر توزيع الحجم على مستويات السعر + POC + VAH/VAL + buy/sell delta | رؤية هيكل السوق بدلاً من نص غامض |
| المستخدم بيشوف 50 سهم في الرادار بدون سياق قطاعي | `Sector Treemap` بيُجمّع القطاعات ويعرض سيولة كل قطاع + اتجاه الأموال | اختيار قطاع قبل اختيار السهم |
| التحولات بتحصل بدون ما حد يعرفها (سهم خرج من الانفجار، سهم تحوّل للتوزيع) | `Smart Radar Alerts` بتطلق 4 أنواع تنبيهات تلقائياً على `user_notifications` | تنبيه فوري دون فتح المنصة |
| الرادار معزول عن V40.2 (محرك التوقعات الرئيسي) | `Radar → V40.2 Pipeline` كان متوصِّل من 2026-09-05 عبر `_radar_kill / _radar_boost / _radar_money_flow` | الرادار فعلياً بيتحكم في توقعات V40.2 (kill/boost) |

---

## 2. الميزات الجديدة (6 Features)

### 2.1 توقيت الدخول الذكي (Entry Timing Signal 0-100) 🎯

**المسار:** `GET /api/maker-radar/entry-timing?ticker=X`

#### المشكلة التي تحلها
المستخدم بيشوف "COMI في قائمة الانفجار الحجمي" — بس مش عارف هل ده توقيت دخول كويس ولا لأ. قرار الدخول بيكون إما عشوائي أو متأثر بـ recency bias. مفيش درجة كمية موحَّدة.

#### الحل التقني
Endpoint بيقرأ آخر 30 جلسة تداول OHLCV من radar DB (يفضّل `db/data_engine.db.egksco_price_history`، fallback لـ `stocks.db`) ويحسب 4 درجات فرعية:

| # | المكوّن (Factor) | المدى | المعادلة |
|---|---|---|---|
| 1 | **Accumulation Strength** | 0-30 | عدد أيام الشراء (close > prev_close) في آخر 10 جلسات: 8-10→30 · 6-7→22 · 5→15 · 3-4→8 · 0-2→0 |
| 2 | **Volume Confirmation** | 0-25 | `vol_ratio = avg_vol_10d / avg_vol_20d`: ≥1.5→25 · 1.2-1.5→18 · 1.0-1.2→10 · <1.0→0 |
| 3 | **Price Near Support** | 0-25 | `distance_from_min20 = (current - min20) / min20 * 100`: ≤2%→25 · 2-5%→18 · 5-10%→10 · >10%→0 |
| 4 | **Momentum ROC10** | 0-20 | `ROC10 = (close_today - close_10d_ago) / close_10d_ago * 100`: 5-15%→20 · 0-5%→12 · 15-25%→14 · -5..0%→6 · else→0 |

المجموع = `score` من 0-100. الـ label بيتحدَّد كالتالي:
- `score ≥ 80` → "توقيت ممتاز" (emerald)
- `score ≥ 60` → "توقيت جيد" (amber)
- `score ≥ 40` → "توقيت مقبول" (yellow)
- `score < 40` → "توقيت ضعيف" (rose)

#### المعاملات (Query Params)
| المعامل | النوع | الإفتراضي | مطلوب؟ | الوصف |
|---|---|---|---|---|
| `ticker` | string | — | ✅ نعم | رمز السهم (UPPERCASE تلقائياً) |

#### مثال على الـ Response

```json
GET /api/maker-radar/entry-timing?ticker=COMI

{
  "success": true,
  "ticker": "COMI",
  "score": 49,
  "label": "توقيت مقبول",
  "label_color": "yellow",
  "breakdown": {
    "accumulation": { "score": 8,  "max": 30, "label": "تجميع ضعيف",     "detail": "3 من 10 أيام شراء" },
    "volume":       { "score": 10, "max": 25, "label": "حجم متوسط",     "detail": "نسبة الحجم 1.05" },
    "support":      { "score": 25, "max": 25, "label": "قرب الدعم مباشرة", "detail": "1.20% من قاع 20 يوم" },
    "momentum":     { "score": 6,  "max": 20, "label": "زخم سلبي خفيف",  "detail": "ROC 10 أيام = -1.85%" }
  },
  "recommendation": "توقيت متوسط — يُفضّل انتظار تأكيد اختراق حجمي أو تصحيح أقرب للدعم",
  "data_points": 30,
  "current_price": 52.41,
  "min_20": 51.79,
  "vol_ratio": 1.05,
  "roc_10d": -1.85,
  "buy_days_10": 3,
  "computed_at": "2026-09-27T08:42:13.421Z"
}
```

#### المكونات المستخدمة في الـ UI
- `EntryTimingCard` في `src/components/predictions/radar/RadarStatsCards.tsx` (lines 482-596)
- يعرض: درجة كبيرة (text-2xl) + Badge ملوّن + progress bar + grid 2×2 للـ breakdown + recommendation box

#### ملفات الـ source code المعنية
| الملف | السطور | الدور |
|---|---|---|
| `src/app/api/maker-radar/entry-timing/route.ts` | 256 | الـ GET endpoint الكامل |
| `src/lib/radar-db.ts` | 180 | `getRadarDb / getRadarDbConfig / parseVolume / computeTurnover` |
| `src/components/predictions/radar/RadarStatsCards.tsx` | (482-596) | `EntryTimingCard` |

#### مثال على الاستخدام العملي
```ts
// من أي client component
const res = await fetch(`/api/maker-radar/entry-timing?ticker=${ticker}`, { cache: 'no-store' });
const { score, label, recommendation } = await res.json();

if (score >= 60) {
  // اعرض للمستخدم "مدخل مناسب"
} else if (score >= 40) {
  // اعرض "توقيت متوسط — يحتاج تأكيد"
} else {
  // اعرض "انتظر تصحيح للدعم"
}
```

---

### 2.2 تتبع مصير الإشارات (Signal Tracker) 🏆

**المسار:** `GET /api/maker-radar/signal-tracker` · `POST /api/maker-radar/signal-tracker` · `POST /api/maker-radar/signal-tracker/verify`

#### المشكلة التي تحلها
قبل الترقية، مفيش way to answer: "هل إشارات الرادار دقيقة أصلاً؟". الإشارات بتطلع وتموت بدون أثر. مفيش win rate per signal_type، مفيش avg outcome بعد 30 يوم.

#### الحل التقني
3-layer solution:

1. **التسجيل (Recording)** — كل warmup للرادار بيُسجِّل إشاراته في جدول `radar_signal_tracking` (atomic via shared lib `recordSignalsBatch` مع dedup على `(ticker, signal_date, signal_type)`).
2. **الإحصائيات (Stats)** — GET endpoint بيُرجع `total / pending / verified / win_rate_pct / avg_outcome_{7,14,30}d / by_signal_type / recent_signals`.
3. **التحقق (Verification)** — POST endpoint بيحدِّث الصفوف الـ pending بـ outcomes حقيقية من بيانات الأسعار التاريخية.

#### الأنواع المسموحة (5 signal types)
| الـ signal_type | الـ label العربي |
|---|---|
| `explosive_surge` | 💥 انفجار حجمي |
| `quiet_accumulation_strong` | 🎯 تجميع قوي هادي |
| `quiet_accumulation_weak` | 🔍 تجميع ضعيف هادي |
| `pre_surge` | 🚀 ما قبل الانفجار |
| `early_break` | ⚡ اختراق مبكر |

#### API 1: GET (Stats)

```http
GET /api/maker-radar/signal-tracker?days=30&signal_type=explosive_surge
```

| المعامل | النوع | الإفتراضي | الوصف |
|---|---|---|---|
| `days` | int | 30 | نافذة التحليل (يوم) |
| `signal_type` | string | null | فلتر اختياري على نوع الإشارة |

مثال response:
```json
{
  "success": true,
  "window_days": 30,
  "signal_type_filter": null,
  "total_signals": 96,
  "pending": 96,
  "verified": 0,
  "win_rate_pct": 0,
  "avg_outcome_7d": null,
  "avg_outcome_14d": null,
  "avg_outcome_30d": null,
  "by_signal_type": [
    { "signal_type": "pre_surge", "label": "ما قبل الانفجار", "total": 57, "verified": 0, "wins": 0, "win_rate_pct": 0, "avg_outcome_7d": null, "avg_outcome_14d": null, "avg_outcome_30d": null },
    { "signal_type": "quiet_accumulation_strong", "label": "تجميع قوي هادي", "total": 28, ... },
    { "signal_type": "explosive_surge", "label": "انفجار حجمي", "total": 10, ... },
    { "signal_type": "early_break", "label": "اختراق مبكر", "total": 1, ... }
  ],
  "recent_signals": [],
  "computed_at": "2026-09-27T09:12:00.000Z"
}
```

#### API 2: POST (Record)

```http
POST /api/maker-radar/signal-tracker
Content-Type: application/json

{ "ticker": "COMI", "signal_type": "explosive_surge", "entry_price": 52.41, "path": "D_explosive", "reason": "vol_ratio=2.1×, breakout above resistance" }
```

Response:
```json
{ "success": true, "dedup": false, "id": 97, "ticker": "COMI", "signal_type": "explosive_surge", "signal_date": "2026-09-27", "entry_price": 52.41 }
```

لو الـ tuple `(ticker, signal_date, signal_type)` موجود → `dedup: true` + `existing_id`.

#### API 3: POST /verify

```http
POST /api/maker-radar/signal-tracker/verify
Content-Type: application/json

{ "max_age_days": 45 }
```

Response:
```json
{
  "success": true,
  "verified_count": 12,
  "win_count": 7,
  "loss_count": 3,
  "neutral_count": 2,
  "pending_partial_count": 4,
  "scanned_count": 16,
  "errors": [],
  "verified_at": "2026-09-27T09:15:00.000Z"
}
```

الـ status transitions في الـ verify:
- `outcome_30d > 0.5%` → `verified_win`
- `outcome_30d < -0.5%` → `verified_loss`
- `|outcome_30d| ≤ 0.5%` → `verified_neutral`
- `outcome_30d == null` (less than 30 trading days passed) → `pending` (partial outcomes + excursions still recorded)

#### المكونات المستخدمة في الـ UI
- `RadarSignalStatsCard` في `RadarStatsCards.tsx` (lines 98-301)
- زر "تحقّق ({pending})" بيستدعي POST /verify و يعرض الـ summary
- grid 4 خانات (إجمالي / pending / verified / win rate) + grid 3 خانات للـ avg outcomes + قائمة by_signal_type

#### ملفات الـ source code المعنية
| الملف | السطور | الدور |
|---|---|---|
| `src/app/api/maker-radar/signal-tracker/route.ts` | 372 | GET (stats) + POST (record) |
| `src/app/api/maker-radar/signal-tracker/verify/route.ts` | 387 | POST (verify pending signals) |
| `src/lib/radar-signal-tracker.ts` | 190 | shared DB layer (`recordSignal / recordSignalsBatch / ensureSchema / openTrackerDb`) |
| `src/lib/schedulers/radar-alerts.ts` | (387-447) | `recordRadarSignals()` helper — بيستدعي `recordSignalsBatch` بعد كل warmup |

#### مثال على الاستخدام العملي
```bash
# تسجيل إشارة يدوياً (للـ testing)
curl -X POST http://localhost:3000/api/maker-radar/signal-tracker \
  -H 'Content-Type: application/json' \
  -d '{"ticker":"COMI","signal_type":"explosive_surge","entry_price":52.41}'

# تشغيل التحقق
curl -X POST http://localhost:3000/api/maker-radar/signal-tracker/verify \
  -H 'Content-Type: application/json' \
  -d '{"max_age_days":45}'

# قراءة الإحصائيات
curl 'http://localhost:3000/api/maker-radar/signal-tracker?days=120'
```

---

### 2.3 بصمة السيولة (Liquidity Footprint / Volume Profile) 📊

**المسار:** `GET /api/maker-radar/footprint?ticker=X&days=30`

#### المشكلة التي تحلها
المستخدم بيشوف "تجميع قوي هادي" — بس الكلمة دي غامضة. كم عملياً؟ على أي مستوى سعر؟ فين الـ fair value؟ الـ volume profile هو الـ standard في الـ institutional trading لكن كان ناقص.

#### الحل التقني
Endpoint بيقرأ آخر N جلسة OHLCV (افتراضي 30، max 365) ويبني **volume profile**:

1. **تقسيم المدى السعري** إلى ~15-20 bin مُتساوية بين `[min_low, max_high]`.
2. **توزيع حجم كل bar** على الـ bins اللي بيتداخل معاها (proportional split: `overlap / bar_range`).
3. **تصنيف كل bar** كـ bullish (close>open → 70/30 buy/sell) / bearish (close<open → 30/70) / flat (50/50).
4. **حساب POC** (Point of Control) = الـ bin الأعلى حجم.
5. **حساب VAH/VAL** (Value Area High/Low) = التوسّع من POC لحد ما 70% من الحجم يكون داخل.

الـ bar بـ `high == low` (degenerate) → كل الحجم بيروح لـ bin الـ close-price.

#### المعاملات
| المعامل | النوع | الإفتراضي | المدى | الوصف |
|---|---|---|---|---|
| `ticker` | string | — | — | مطلوب |
| `days` | int | 30 | 1-365 | عدد الجلسات |

#### مثال على الـ Response

```json
GET /api/maker-radar/footprint?ticker=COMI&days=30

{
  "success": true,
  "ticker": "COMI",
  "days": 30,
  "bin_count": 18,
  "price_min": 50.10,
  "price_max": 55.40,
  "poc_price": 52.41,
  "poc_volume": 1850000,
  "vah_price": 54.26,
  "val_price": 52.10,
  "value_area_volume_pct": 71.2,
  "total_volume": 12500000,
  "buy_volume": 7500000,
  "sell_volume": 5000000,
  "delta_volume": 2500000,
  "buy_sell_ratio": 1.50,
  "levels": [
    { "price_low": 55.15, "price_high": 55.40, "price_mid": 55.27, "volume": 250000,  "buy_volume": 150000, "sell_volume": 100000, "delta": 50000,  "volume_pct": 2.0, "is_poc": false, "is_value_area": false },
    { "price_low": 54.90, "price_high": 55.15, "price_mid": 55.02, "volume": 480000,  "buy_volume": 280000, "sell_volume": 200000, "delta": 80000,  "volume_pct": 3.8, "is_poc": false, "is_value_area": true },
    ...
    { "price_low": 52.30, "price_high": 52.55, "price_mid": 52.41, "volume": 1850000, "buy_volume": 1200000,"sell_volume": 650000, "delta": 550000, "volume_pct": 14.8,"is_poc": true,  "is_value_area": true },
    ...
  ],
  "computed_at": "2026-09-27T09:20:00.000Z"
}
```

الـ levels مُرتَّبة **تنازلياً بالسعر** (الأعلى أولاً) عشان UI يرسمها top-to-bottom.

#### المكونات المستخدمة في الـ UI
- `LiquidityFootprintCard` في `RadarStatsCards.tsx` (lines 632-793)
- grid 3 خانات للـ POC/VAH/VAL
- buy/sell pressure bar (emerald/rose)
- قائمة horizontal bars لكل مستوى سعر (buy volume right → emerald, sell volume left → rose, POC marker ★, value area border)

#### ملفات الـ source code المعنية
| الملف | السطور | الدور |
|---|---|---|
| `src/app/api/maker-radar/footprint/route.ts` | 388 | الـ GET endpoint + خوارزمية الـ binning |
| `src/components/predictions/radar/RadarStatsCards.tsx` | (601-793) | `LiquidityFootprintCard` |

#### مثال على الاستخدام العملي
```ts
// في الـ StockDetailDrawer في MakerRadarTab
<LiquidityFootprintCard ticker={selectedTicker} />
// الكومبوننت بيـ fetch تلقائياً + بيرندر POC/VAH/VAL + الـ horizontal bars
```

---

### 2.4 ربط الرادار بـ V40.2 Pipeline 🧠

**المسار:** داخل `vps-service/jobs/v40_2_daily_generator.py` (lines 2200-2246)

> ⚠️ **ملاحظة مهمة:** هذه الميزة **كانت موجودة فعلاً ومُتوصِّلة وشغّالة** قبل الترقية الحالية (منذ 2026-09-05). تم توثيقها هنا لاستكمال الـ 6 ميزات.

#### المشكلة التي تحلها
الرادار لو معزول عن محرك التوقعات V40.2 → بيبقى مجرد عرض قوائم بدون تأثير فعلي على قرارات التداول. المطلوب: الرادار يقتل الإشارات السيئة (kill switch) ويعزّز الإشارات القوية (boost).

#### الحل التقني
3 متغيرات بتتحسب داخل حلقة الـ backtest لكل (ticker, scan_date):

| المتغير | النوع | المصدر | التأثير |
|---|---|---|---|
| `_radar_kill` | bool | `check_kill_switch()` من `utils.shared_liquidity` | لو True → `continue` (الإشارة تُرفض فوراً ولا تُضاف لـ signals_by_date) |
| `_radar_boost` | int | `compute_money_flow()` → `'🔥 دخول قوي' → +5`, `'🔥 خروج قوي' → -5`, `'🟢 سيولة داخلة' → +2`, `'🔴 سيولة خارجة' → -2` | يُضاف لـ `result['score']` (clamped 0-100) |
| `_radar_money_flow` | str | من `compute_money_flow().money_flow_state` | يُسجَّل في الـ signal للتحليل لاحقاً |

#### مقتطف من الكود (lines 2205-2246)
```python
_radar_kill = False
_radar_kill_reason = ''
_radar_boost = 0
_radar_money_flow = 'neutral'
try:
    from utils.shared_liquidity import check_kill_switch, compute_money_flow
    _closes_slice = closes[:day_idx+1]
    _volumes_slice = volumes[:day_idx+1]
    _highs_slice = highs[:day_idx+1]
    _lows_slice = lows[:day_idx+1]
    if len(_closes_slice) >= 18:
        _kill_triggered, _kill_reason = check_kill_switch(
            _closes_slice, _volumes_slice, _highs_slice, _lows_slice
        )
        if _kill_triggered:
            _radar_kill = True
            _radar_kill_reason = _kill_reason
            print(f"🚫 [RADAR-KILL] {ticker} on {scan_date}: {_kill_reason} → rejected", flush=True)

        _mf = compute_money_flow(_closes_slice, _volumes_slice, _highs_slice, _lows_slice)
        _radar_money_flow = _mf.get('money_flow_state', 'neutral')
        if '🔥 دخول قوي' in _radar_money_flow:
            _radar_boost = 5
        elif '🔥 خروج قوي' in _radar_money_flow:
            _radar_boost = -5
        elif '🟢 سيولة داخلة' in _radar_money_flow:
            _radar_boost = 2
        elif '🔴 سيولة خارجة' in _radar_money_flow:
            _radar_boost = -2
except Exception as _radar_err:
    pass  # safe-by-design: لو الرادار فشل → نكمّل من غيره

# Kill Switch → ارفض الإشارة فوراً
if _radar_kill:
    print(f"🚫 [RADAR-KILL] {ticker} on {scan_date}: {_radar_kill_reason} → signal rejected", flush=True)
    continue

# Apply boost/penalty
if _radar_boost != 0:
    _old_score = result.get('score', 0)
    result['score'] = max(0, min(100, _old_score + _radar_boost))
    print(f"📊 [RADAR-BOOST] {ticker} on {scan_date}: {_radar_money_flow} → score {_old_score} → {result['score']} ({_radar_boost:+d})", flush=True)
```

#### المكونات المستخدمة في الـ UI
مفيش UI مباشر لهذه الميزة — هي تعديل خلفي على V40.2 generator. الـ boost/kill بيظهر في الـ logs بـ prefix `[RADAR-KILL]` / `[RADAR-BOOST]`.

#### ملفات الـ source code المعنية
| الملف | السطور | الدور |
|---|---|---|
| `vps-service/jobs/v40_2_daily_generator.py` | (2200-2246) | الـ integration point |
| `vps-service/utils/shared_liquidity.py` | — | `check_kill_switch` + `compute_money_flow` (المصدر) |

#### مثال على الاستخدام العملي
الـ pipeline ده بيشتغل تلقائياً كل ما الـ V40.2 generator يشتغل (cron يومي). مفيش API endpoint لتفعيله. الـ output هو:
- إشارات مرفوضة (kill) → ما تظهرش أصلاً في `signals_by_date`
- إشارات مُعزَّزة (boost) → بتظهر بـ `score` أعلى → احتمالية اختيارها أعلى

---

### 2.5 خريطة سيولة القطاعات (Sector Liquidity Treemap) 🗺️

**المسار:** `GET /api/maker-radar/sector-treemap?days=30`

#### المشكلة التي تحلها
المستخدم بيشوف 50+ سهم في الرادار بدون سياق قطاعي. مش عارف أي قطاع فيه سيولة دلوقتي، وأي قطاع بيتصفّى. القرار على مستوى السهم بيبقى صعب بدون رؤية الصورة الكبيرة.

#### الحل التقني
Endpoint بيقرأ الـ radar cache (`readRadarCache()`) ويُجمِّع كل tickers الـ 4 قوائم (deduped)، ثم يفتح `db/stocks.db` (readonly) ويـ fetch مرة واحدة كل ticker info (`sector`, `name_ar`, `current_price`, `previous_close`)، ويُجمّع حسب القطاع:

| الحقل | الحساب |
|---|---|
| `stocks_count` | عدد الأسهم في القطاع |
| `total_turnover` | Σ `avg_turnover_20d` |
| `total_volume` | Σ `avg_volume_20d` |
| `avg_change_pct` | mean لـ `((current_price - previous_close) / previous_close) * 100` |
| `avg_roc_10d` | mean لـ `roc_10d` من radar cache |
| `direction` | `inflow` لو `avg_change_pct > +0.5%` · `outflow` لو `< -0.5%` · `neutral` غير ذلك |
| `color` | emerald / rose / amber (matching direction) |
| `top_tickers` | أعلى 3 أسهم حسب `avg_turnover_20d` (مع name_ar + change_pct + roc_10d) |

القطاعات مُرتَّبة **تنازلياً حسب `total_turnover`**. لو الـ radar cache غير متوفر → 503 مع Arabic "الرادار بيتسخن".

#### المعاملات
| المعامل | النوع | الإفتراضي | الوصف |
|---|---|---|---|
| `days` | int | 30 | نافذة التحليل (مُمرَّر فقط للـ display، الـ data اللي بيتجمع دايماً من آخر cache) |

#### مثال على الـ Response

```json
GET /api/maker-radar/sector-treemap?days=30

{
  "success": true,
  "days": 30,
  "total_sectors": 12,
  "total_turnover": 487000000,
  "sectors": [
    {
      "sector": "البنوك",
      "stocks_count": 14,
      "total_turnover": 185000000,
      "total_volume": 4800000,
      "avg_change_pct": 1.85,
      "avg_roc_10d": 3.20,
      "direction": "inflow",
      "color": "emerald",
      "top_tickers": [
        { "ticker": "COMI", "name_ar": "البنك التجاري الدولي", "avg_turnover_20d": 42000000, "change_pct": 2.45, "roc_10d": 4.10 },
        { "ticker": "HRHO", "name_ar": "الهرم للإستثمار",      "avg_turnover_20d": 38000000, "change_pct": 1.95, "roc_10d": 3.50 },
        { "ticker": "ECAP", "name_ar": "إي كابيتال",           "avg_turnover_20d": 25000000, "change_pct": 1.40, "roc_10d": 2.80 }
      ]
    },
    { "sector": "العقارات", "stocks_count": 8, "total_turnover": 92000000, "avg_change_pct": -0.80, "direction": "outflow", "color": "rose", "top_tickers": [...] },
    ...
  ],
  "generated_at": "2026-09-27T09:25:00.000Z"
}
```

#### المكونات المستخدمة في الـ UI
- `SectorTreemapCard` في `RadarStatsCards.tsx` (lines 335-454)
- خريطة treemap مبنية بـ **CSS flex-wrap** (بدون D3.js) — كل قطاع بـ box حجمه يتناسب مع `total_turnover`، لونه حسب direction (emerald/rose/amber)
- أسفل الـ treemap: قائمة top 3 قطاعات مع top tickers كـ badges

#### ملفات الـ source code المعنية
| الملف | السطور | الدور |
|---|---|---|
| `src/app/api/maker-radar/sector-treemap/route.ts` | 342 | الـ GET endpoint + الـ aggregation logic |
| `src/lib/radar-cache.ts` | (readRadarCache) | بيجيب آخر radar JSON |
| `db/stocks.db` (table `stocks`) | — | معلومات القطاع + name_ar + current_price |
| `src/components/predictions/radar/RadarStatsCards.tsx` | (335-454) | `SectorTreemapCard` |

#### مثال على الاستخدام العملي
```ts
// في MakerRadarTab — SectorTreemapCard بتترسم بـ:
<SectorTreemapCard />
// بيـ fetch تلقائياً + بيرسم الـ treemap لو فيه data كافية
```

---

### 2.6 التنبيهات الذكية (Smart Radar Alerts) 🔔

**المسار:** مفيش API endpoint مباشر — التنبيهات بتشتغل **تلقائياً بعد كل warmup ناجح**.

#### المشكلة التي تحلها
التحولات بتحصل في الرادار بدون ما حد يعرفها:
- سهم دخل قائمة الانفجار → لازم تعرف فوراً.
- سهم ظهر في تجميع قوي → فرصة.
- سهم متابَع تحوّل من "تجميع" لـ "تصريف" → خطر.
- سهم اشتعال حجمي > 1.30× → انتباه.

#### الحل التقني
`runRadarAlertsCheck(userId?)` في `src/lib/schedulers/radar-alerts.ts` (447 سطر):

1. بيقرأ آخر radar cache + آخر snapshot محفوظ + ملف الـ tracking (`db/maker_radar_tracking.json`).
2. بيحسب 4 مجموعات: `current_explosive_tickers`, `current_quiet_tickers`, `prev.explosive_tickers`, `prev.quiet_tickers`.
3. بيطلق 4 أنواع تنبيهات عبر `insertNotification()` المُصدَّرة من `alert-engine.ts`:

| النوع | الـ title | الـ trigger | severity |
|---|---|---|---|
| `radar_explosive` | 💥 انفجار حجمي جديد | ticker في `current_explosive` و مش في `prev.explosive_tickers` | warning |
| `radar_opportunity` | 🎯 فرصة تجميع جديدة | ticker في `current_quiet` و مش في `prev.quiet_tickers` | info |
| `radar_distribution` | ⚠️ تحول للتوزيع | ticker متابَع: `prev_accumulation` فيه "تجميع" + `current_accumulation` فيه "تصريف" | warning |
| `radar_flare` | 🔥 اشتعال حجمي | ticker متابَع + `volume_ratio_10d_vs_20d > 1.30` (للمتابَعة فقط عشان منعملش spam على 303 سهم) | info |

4. بيحفظ snapshot جديد في `db/radar_alerts_state.json` للمقارنة في المرة القادمة.
5. بيستدعي `recordRadarSignals()` لتسجيل إشارات اليوم في `radar_signal_tracking` للتحقق منها لاحقاً.

كل التنبيهات بـ `user_id = userId || 'system'` (global radar alerts → تظهر لكل المستخدمين عبر NotificationCenter).

#### الـ payload structure
كل تنبيه بـ `payload` JSON فيه:
- `ticker` — رمز السهم
- `source` — قائمة الرادار المصدر (`explosive_list` / `quiet_or_pre_surge` / ...)
- `current_price` — آخر سعر
- معلومات إضافية حسب النوع (`volume_ratio_10d_vs_20d` / `prev_accumulation` / `current_accumulation` / `avg_turnover_20d` / `path`)

#### المكونات المستخدمة في الـ UI
مفيش UI مخصص للـ radar alerts — بيظهروا في **NotificationCenter** العام (مع باقي أنواع التنبيهات: stock_alerts / gold_alerts / pnl_alerts). كل تنبيه بـ `type = radar_*` + `severity` + `payload` عشان الـ UI يقدر deep-link لرادار السهم.

#### ملفات الـ source code المعنية
| الملف | السطور | الدور |
|---|---|---|
| `src/lib/schedulers/radar-alerts.ts` | 447 | الـ smart alerts engine (4 alert types + snapshot management + recordRadarSignals) |
| `src/lib/schedulers/alert-engine.ts` | (modified) | export `insertNotification` + إضافة `radar_alerts` لـ `AlertEngineResult` + 4th engine في `runAllAlerts` |
| `src/lib/radar-cache.ts` | (modified) | fire-and-forget `import('@/lib/schedulers/radar-alerts').then(m => m.runRadarAlertsCheck())` بعد كل warmup ناجح (sync + async) |

#### مثال على الاستخدام العملي
```ts
// التشغيل التلقائي بيحصل بعد كل warmup ناجح. للتشغيل اليدوي:
import { runRadarAlertsCheck } from '@/lib/schedulers/radar-alerts';
const fired = await runRadarAlertsCheck('user-123');
console.log(`🔥 fired ${fired} new radar alerts`);
```

---

## 3. قاعدة البيانات (Database)

### 3.1 جدول `radar_signal_tracking` (الـ schema الكامل)

| العمود | النوع | القيمة الافتراضية | الوصف |
|---|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | — | المُعرّف الفريد للصف |
| `ticker` | TEXT NOT NULL | — | رمز السهم (UPPERCASE) |
| `signal_date` | TEXT NOT NULL | — | تاريخ الإشارة (YYYY-MM-DD) |
| `signal_type` | TEXT NOT NULL | — | نوع الإشارة (5 قيم مسموحة، راجع §2.2) |
| `entry_price` | REAL NOT NULL | — | سعر الإغلاق وقت الإشارة |
| `path` | TEXT | NULL | مسار الرادار (`A_quiet_*`, `B_pre_surge`, `C_early_break`, `D_explosive`) |
| `reason` | TEXT | NULL | سبب الإشارة (free text) |
| `status` | TEXT | `'pending'` | حالة التحقق: `pending` / `verified_win` / `verified_loss` / `verified_neutral` |
| `outcome_7d` | REAL | NULL | نسبة العائد بعد 7 أيام تداول: `((close_7d - entry) / entry) * 100` |
| `outcome_14d` | REAL | NULL | نسبة العائد بعد 14 يوم تداول |
| `outcome_30d` | REAL | NULL | نسبة العائد بعد 30 يوم تداول (إذا توفرت → يُحدِّث الـ status) |
| `max_price_after` | REAL | NULL | أعلى high بعد الإشارة (true upside excursion) |
| `min_price_after` | REAL | NULL | أدنى low بعد الإشارة (true downside excursion) |
| `verified_at` | TEXT | NULL | ISO 8601 timestamp للتحقق |
| `created_at` | TEXT | `datetime('now')` | وقت إنشاء الصف |

#### الـ indexes (4)
```sql
CREATE INDEX IF NOT EXISTS idx_radar_sig_ticker ON radar_signal_tracking(ticker);
CREATE INDEX IF NOT EXISTS idx_radar_sig_status ON radar_signal_tracking(status);
CREATE INDEX IF NOT EXISTS idx_radar_sig_type  ON radar_signal_tracking(signal_type);
CREATE INDEX IF NOT EXISTS idx_radar_sig_date  ON radar_signal_tracking(signal_date);
```

#### موقع الـ DB
- **الأولوية 1:** `db/stocks.db` (لو موجود)
- **الأولوية 2:** `db/data_engine.db` (fallback)
- لو الاتنين مش موجودين → `pickTrackerDbPath()` بيخلق `db/stocks.db` جديد + الـ schema.

#### الاستخدام
| المستخدم | الطريقة |
|---|---|
| `src/lib/radar-signal-tracker.ts` | `recordSignal()` + `recordSignalsBatch()` (shared lib) |
| `src/app/api/maker-radar/signal-tracker/route.ts` | GET (stats) + POST (manual record) |
| `src/app/api/maker-radar/signal-tracker/verify/route.ts` | POST (update outcomes + status) |
| `src/lib/schedulers/radar-alerts.ts` | `recordRadarSignals()` بعد كل warmup |

---

### 3.2 جدول `user_notifications` (الأنواع الجديدة radar_*)

جدول `user_notifications` كان موجود مسبقاً في الـ alert-engine (`ensureUserNotifColumns`). الترقية أضافت **4 أنواع تنبيهات جديدة**:

| النوع (`type` column) | الـ title | severity | الـ trigger |
|---|---|---|---|
| `radar_explosive` | 💥 انفجار حجمي جديد | warning | سهم دخل قائمة الانفجار لأول مرة |
| `radar_opportunity` | 🎯 فرصة تجميع جديدة | info | سهم ظهر في تجميع قوي/pre-surge لأول مرة |
| `radar_distribution` | ⚠️ تحول للتوزيع | warning | سهم متابَع تحوّل من تجميع → تصريف |
| `radar_flare` | 🔥 اشتعال حجمي | info | سهم متابَع حجمه > 1.30× من متوسط 20 يوم |

#### الـ schema المستخدَم (موجود أصلاً + idempotent ALTER)
```sql
CREATE TABLE IF NOT EXISTS user_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  severity TEXT DEFAULT 'info',
  payload TEXT,
  ticker TEXT,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

#### الـ dedup (موجود أصلاً)
`insertNotification()` بيتحقق من عدم وجود تنبيه بنفس `(user_id, type, ticker, message)` في آخر 24 ساعة → لو موجود → `return false` (skip).

#### الـ payload لكل نوع
```json
// radar_explosive
{ "ticker": "COMI", "source": "explosive_list", "current_price": 52.41, "volume_ratio_10d_vs_20d": 2.10 }

// radar_opportunity
{ "ticker": "EFIN", "source": "quiet_or_pre_surge", "current_price": 21.30, "path": "B_quiet_accumulation_strong" }

// radar_distribution
{ "ticker": "SWDY", "prev_accumulation": "تجميع خفيف", "current_accumulation": "تصريف قوي", "current_price": 13.85 }

// radar_flare
{ "ticker": "HRHO", "volume_ratio_10d_vs_20d": 1.45, "current_price": 41.20, "avg_turnover_20d": 38000000 }
```

---

### 3.3 ملف `db/radar_alerts_state.json`

#### الغرض
الـ snapshot اللي بيُستخدم لـ diffing بين تشغيلين: بيقارن الـ tickers اللي كانت في القوائم مع اللي موجودة دلوقتي → بيطلق التنبيهات على الفرق فقط.

#### الـ structure
```json
{
  "last_snapshot_at": "2026-09-27T09:30:00.000Z",
  "explosive_tickers": ["COMI", "HRHO", "ECAP"],
  "quiet_tickers": ["EFIN", "SWDY", "FWRY", "TMGH"],
  "tracked_transitions": {
    "COMI": { "prev_accumulation": "تجميع خفيف", "since": "2026-09-20" },
    "HRHO": { "prev_accumulation": "تجميع قوي",  "since": "2026-09-15" }
  }
}
```

| الحقل | النوع | الوصف |
|---|---|---|
| `last_snapshot_at` | string (ISO 8601) | وقت آخر تشغيل ناجح |
| `explosive_tickers` | string[] | tickers اللي كانت في `explosive_list` |
| `quiet_tickers` | string[] | tickers في `quiet_list` ∪ `pre_surge_list` |
| `tracked_transitions` | Record<ticker, {prev_accumulation, since}> | لكل سهم متابَع: آخر accumulation string + تاريخ بدءه |

لو الـ snapshot مفقود → بيُعامَل كـ empty (لا تنبيهات على أول تشغيل، بس بيُحفظ snapshot جديد).

---

### 3.4 ملف `db/maker_radar_tracking.json`

#### الغرض
ملف الـ tracking اللي بيتحكم فيه المستخدم (زر ⭐ في `MakerRadarTab`) — الأسهم اللي بيتابعها. بيُستخدم في:
- `radar_distribution` + `radar_flare` alerts (للمتابَعة فقط — عشان منعملش spam على 303 سهم)
- الـ UI: عرض علامة ⭐ بجانب الأسهم المتابَعة

#### الـ structure
```json
{
  "COMI": {
    "ticker": "COMI",
    "entryDate": "2026-09-15",
    "entryPrice": 48.50,
    "addedAt": "2026-09-15T10:30:00.000Z",
    "notes": "تجميع قوي هادي - مراقبة الاختراق فوق 52"
  },
  "HRHO": {
    "ticker": "HRHO",
    "entryDate": "2026-09-20",
    "entryPrice": 38.20,
    "addedAt": "2026-09-20T14:15:00.000Z",
    "notes": null
  }
}
```

| الحقل | النوع | الوصف |
|---|---|---|
| key (object key) | string | ticker (UPPERCASE) |
| `ticker` | string | رمز السهم |
| `entryDate` | string | تاريخ بداية المتابعة |
| `entryPrice` | number | سعر الدخول المتوقَّع |
| `addedAt` | string (ISO 8601) | وقت الإضافة للمتابعة |
| `notes` | string \| null | ملاحظات المستخدم |

#### الـ API المستخدِم له
- `POST /api/maker-radar/track` (إضافة/حذف سهم من المتابعة)
- `src/lib/schedulers/radar-alerts.ts` بقرأه عبر `loadTracking()` (lines 124-133).

---

## 4. التدفقات (Flows)

### 4.1 تدفّق الـ Warmup (Cache Warmup → Alerts → Signal Recording)

```
[USER/CRON] ──POST /api/maker-radar/warmup──► [Next.js API: runWarmupSync()]
                                                      │ spawn (detached)
                                                      ▼
                          [python3 scripts/maker_radar.py --json-only]
                                                      │ writes (90s)
                                                      ▼
                          scripts/output/maker_radar_YYYYMMDD.json
                                                      │
                          child.on('exit', code=0) ──┘
                                                      │
                          1. writeStatus(success)
                          2. readRadarCache() → fresh
                          3. resolve(status) ──► [HTTP 200 to USER]
                          4. FIRE-AND-FORGET (async, non-blocking):
                                  │
                                  ▼
                          import('@/lib/schedulers/radar-alerts')
                            .then(m => m.runRadarAlertsCheck())
                            .catch(() => {}) ← silent
                                  │
                                  ▼
┌──────────────────────── runRadarAlertsCheck() ────────────────────────┐
│ 1. readRadarCache() → 4 lists (quiet, pre_surge, explosive, early_break)│
│ 2. loadSnapshot() ← db/radar_alerts_state.json (prev state)             │
│ 3. loadTracking() ← db/maker_radar_tracking.json (tracked tickers)     │
│ 4. FIRE 4 ALERT TYPES via insertNotification() → user_notifications:    │
│      • radar_explosive     (severity=warning)                          │
│      • radar_opportunity   (severity=info)                              │
│      • radar_distribution   (severity=warning, tracked-only)            │
│      • radar_flare          (severity=info, tracked-only, vol > 1.30×) │
│    Each call: 24h dedup on (user_id, type, ticker, message)             │
│ 5. saveSnapshot(new) → db/radar_alerts_state.json                       │
│ 6. recordRadarSignals() → recordSignalsBatch() → db/stocks.db          │
│      INSERT INTO radar_signal_tracking (..., 'pending')                 │
│ 7. return fired_count                                                    │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
[USER opens app] ──GET /api/notifications──► [NotificationCenter renders]
                  (radar_* types appear with payload.ticker for deep-link)
```

#### النقاط الحرجة في الـ flow
1. **fire-and-forget:** الـ `runRadarAlertsCheck()` مش متـ await-ed في `triggerBackgroundWarmup`/`runWarmupSync` → الـ warmup بيخلص فوراً و التنبيهات بتجري async في الخلفية.
2. **safe-by-design:** أي خطأ في radar-alerts بيتـ swallowed بصمت (`.catch(() => {})`) — لا يكسر الـ warmup.
3. **atomicity:** الـ snapshot بيتحفظ بعد ما كل التنبيهات تتطلق → لو مات process في النص، التشغيل القادم ممكن يعيد التنبيهات اللي اتعملتش (acceptable).
4. **dedup:** الـ `insertNotification` عنده 24h dedup على `(user_id, type, ticker, message)` → حتى لو process مات و اشتغل تاني، ما فيش duplicates.

---

### 4.2 تدفّق الـ Signal Verification (pending → verified_win/loss/neutral)

```
T = signal_date (radar-alerts during warmup)
──────────────────────────────────────────
recordRadarSignals({explosiveList, quietList, preSurgeList, earlyBreakList})
   │ for each ticker in lists:
   │   recordSignal({ticker, signal_type, entry_price: current_price,
   │                 path, reason, signal_date: today})
   │     ↓
   │ INSERT INTO radar_signal_tracking
   │   (..., status='pending', outcome_*=NULL)
   │     ↓
   └ row.id=97, status='pending'

T + 7..45 days (cron / manual POST /api/maker-radar/signal-tracker/verify)
────────────────────────────────────────────────────────────────────────
body: { max_age_days: 45 }

SELECT id, ticker, signal_date, entry_price
  FROM radar_signal_tracking
 WHERE status = 'pending'
   AND signal_date <= date('now', '-7 days')
   AND signal_date >= date('now', '-45 days')
 LIMIT 500
   │ for each pending row:
   │   fetchPricesAfter(ticker, signal_date, 30) → tries 4 DB schemas:
   │     1. data_engine.egksco_price_history (price_date)
   │     2. stocks.egksco_price_history (date)
   │     3. stocks.stock_daily_prices (price_date)
   │     4. data_engine.historical_data (date)
   │     ↓
   │   outcome_7d  = ((prices[6].close  - entry) / entry) * 100
   │   outcome_14d = ((prices[13].close - entry) / entry) * 100
   │   outcome_30d = ((prices[29].close - entry) / entry) * 100
   │   max_price_after = max(highs); min_price_after = min(lows)
   │     ↓
   │   if outcome_30d != null:
   │     > 0.5%  → verified_win
   │     < -0.5% → verified_loss
   │     else    → verified_neutral
   │   else: keep status='pending' (partial outcomes only)
   │     ↓
   │ UPDATE radar_signal_tracking SET outcome_*=?, max/min_price_after=?,
   │   status=?, verified_at=? WHERE id=?
   │
   └ return summary:
       { verified_count, win_count, loss_count, neutral_count,
         pending_partial_count, scanned_count, errors[] }

[UI: RadarSignalStatsCard]
─────────────────────────
fetch GET /api/maker-radar/signal-tracker?days=30
   ↓
render: grid 4 (total/pending/verified/win_rate)
      + grid 3 (avg_outcome_7d/14d/30d)
      + list by_signal_type (5 types with win_rate per type)
      + button "تحقّق ({pending})" → POST /verify
   ↓
USER SEES: "✓ تم التحقق من 16 إشارة — 10 رابحة / 6 خاسرة"
```

#### النقاط الحرجة في الـ verification flow
1. **window:** الـ verify بيشغل على الصفوف الـ pending اللي عمرها بين 7 و `max_age_days` (default 45). الصفوف اللي عمرها أقل من 7 أيام → بتستنى (لأن مفيش حتى outcome_7d).
2. **partial verification:** لو prices.length < 30 (مثلاً السهم أُوقِف أو الـ DB غير مكتمل) → بيتسجَّل outcomes اللي متاحة + الـ status يفضل pending. الـ excursions (max/min) بتتسجَّل دايماً.
3. **price source resolver:** بيجرب 4 schemas ورا بعض → أول واحد يرجّع rows بيستخدمه. ده الـ pattern اللي بيتستخدم في radar-db.ts.
4. **clamping:** `max_age_days` بيـ clamp بين 7 و 180 (مشان ما يفحص صفوف قديمة جداً بدون داعي).
5. **LIMIT 500:** الـ verify مكسور على batches عشان ما يعلقش على 1000 صف مرَّة.
6. **errors[]:** أي صف بيفشل (مثلاً entry_price=0) بيتسجَّل في الـ errors array وبيتخطّى.

---

### 4.3 تدفّق الـ Radar → V40.2 (radar cache → score adjustment)

```
[Daily V40.2 generator run (cron)]
   │
   │ for each ticker in tickers:
   │   for each scan_date in backtest_range:
   │     ─────────────────────────────────────────────────
   │     STEP 1: get_price_data(ticker) → closes, volumes, highs, lows
   │     STEP 2: analyze_single_day_v393(...) → result dict
   │             (score, signal, entry, target, stop, ...)
   │     STEP 3: MAKER RADAR INTEGRATION (lines 2205-2246)
   │             from utils.shared_liquidity import
   │               check_kill_switch, compute_money_flow
   │             if len(_closes) >= 18:
   │               (kill, reason) = check_kill_switch(closes, volumes, highs, lows)
   │               _radar_kill = kill
   │               _radar_kill_reason = reason
   │               mf = compute_money_flow(closes, volumes, highs, lows)
   │               _radar_money_flow = mf.money_flow_state
   │               if '🔥 دخول قوي'   → _radar_boost = +5
   │               elif '🔥 خروج قوي'  → _radar_boost = -5
   │               elif '🟢 سيولة داخلة' → _radar_boost = +2
   │               elif '🔴 سيولة خارجة' → _radar_boost = -2
   │               else                 → _radar_boost = 0
   │             except Exception: pass  # safe-by-design
   │     STEP 4: KILL SWITCH GATE
   │             if _radar_kill:
   │               print("[RADAR-KILL] {ticker} ...")
   │               continue  ←←← الإشارة تُرفض (لا تدخل signals_by_date)
   │     STEP 5: BOOST/PENALTY
   │             if _radar_boost != 0:
   │               _old = result['score']
   │               result['score'] = max(0, min(100, _old + _radar_boost))
   │               print("[RADAR-BOOST] {ticker} → {_old} → {result['score']}")
   │     STEP 6: signals_by_date[scan_date].append({...})
   │             (الإشارة بتدخل إذا مش killed)
   │     ─────────────────────────────────────────────────
   ▼
[OUTPUT: predictions.db ← signals_by_date]
   │
   │ • إشارات مرفوضة (kill) → لا تظهر
   │ • إشارات مُعزَّزة (boost +5/+2) → score أعلى → احتمالية اختيار أعلى
   │ • إشارات مُخفَّضة (boost -5/-2) → score أقل → احتمالية اختيار أقل
   ▼
[Daily predictions list → user notifications → UI]
```

#### النقاط الحرجة في الـ V40.2 integration
1. **safe-by-design:** الـ try/except بيلف كل الـ radar logic → لو `shared_liquidity` فشل (DB مفقودة، bug، إلخ) → الـ V40.2 بيكمّل من غيره.
2. **window size:** بيتحقق `len(_closes) >= 18` → الـ kill switch + money flow محتاجين على الأقل 18 جلسة عشان الحسابات (ROC + MA) تكون meaningful.
3. **clamping:** `result['score'] = max(0, min(100, _old + boost))` → مفيش score سالب ولا > 100.
4. **logging:** كل kill / boost بيتسجَّل بـ prefix `[RADAR-KILL]` / `[RADAR-BOOST]` في stdout لـ debugging.
5. **عزل:** الـ radar_boost بيأثر على `result['score']` فقط (لا على entry/stop/target) → الـ risk management يفضل محكم.

---

## 5. المخطط المعماري (Architecture Diagram)

### 5.1 علاقة مكونات الـ Backend

```
[scripts/maker_radar.py]
   │ spawn (detached)
   ▼
[src/lib/radar-cache.ts] (438 LOC)
   functions:
     - findLatestRadarFile()
     - readRadarCache()  ◄── reads scripts/output/*.json
     - triggerBackgroundWarmup(market)
     - runWarmupSync(market, timeoutMs)
     - writeStatus() / readStatus()
     - isCacheStale() / isWarmupRunning()
   ★ ON SUCCESS:
     import('@/lib/schedulers/radar-alerts')
       .then(m => m.runRadarAlertsCheck())
       .catch(() => {}) ← fire-and-forget, silent
                │
                ▼
[src/lib/schedulers/radar-alerts.ts] (447 LOC)
   exports: runRadarAlertsCheck(userId?) / runRadarAlertsForCurrentUser()
   reads: readRadarCache() / loadSnapshot() / loadTracking()
   fires 4 alert types → insertNotification() (exported from alert-engine)
   writes: saveSnapshot() → db/radar_alerts_state.json
   records: recordRadarSignals() → recordSignalsBatch()
                │
   ┌────────────┴────────────┐
   ▼                         ▼
[user_notifications        [radar_signal_tracking
 table (db/stocks.db)]       table (db/stocks.db)]
   columns: id, user_id,      columns: id, ticker, signal_date,
     type, title, message,      signal_type, entry_price, path,
     severity, payload,          reason, status, outcome_7d/14d/30d,
     ticker, read, created_at    max/min_price_after, verified_at,
   types added by this task:     created_at
     radar_explosive           statuses: pending → verified_win /
     radar_opportunity                   verified_loss / verified_neutral
     radar_distribution        4 indexes: ticker, status, type, date
     radar_flare
   24h dedup on (user_id, type, ticker, message)

[src/lib/schedulers/alert-engine.ts] (659 LOC, MODIFIED)
   ★ exported insertNotification() (was private)
   ★ AlertEngineResult interface += radar_alerts: number
   ★ runAllAlerts(userId?) now runs 4 engines:
       stock / gold / pnl / radar
   ★ runAllAlertsForCurrentUser() — radar_alerts: 0 in early-return paths

[src/lib/radar-signal-tracker.ts] (190 LOC — shared DB layer)
   exports:
     - pickTrackerDbPath() / openTrackerDb() (WAL mode)
     - ensureSchema(db) — CREATE TABLE IF NOT EXISTS + 4 indexes
     - recordSignal(input) — dedup on (ticker, signal_date, signal_type)
     - recordSignalsBatch(inputs[]) — sequential inserts
     - SIGNAL_LABELS (5 types) / VALID_SIGNAL_TYPES (Set)
   consumers:
     - /api/maker-radar/signal-tracker/route.ts (GET + POST)
     - /api/maker-radar/signal-tracker/verify/route.ts (POST)
     - src/lib/schedulers/radar-alerts.ts (recordRadarSignals during warmup)

[src/lib/radar-db.ts] (180 LOC — shared DB resolver)
   exports: getRadarDb() / getRadarDbConfig() / parseVolume() / computeTurnover()
   consumers:
     - /api/maker-radar/entry-timing/route.ts
     - /api/maker-radar/footprint/route.ts

[API endpoints (Next.js Route Handlers)]
   GET  /api/maker-radar/entry-timing      ← uses radar-db
   GET  /api/maker-radar/footprint         ← uses radar-db
   GET  /api/maker-radar/sector-treemap    ← uses radar-cache + stocks.db
   GET  /api/maker-radar/signal-tracker    ← uses radar-signal-tracker
   POST /api/maker-radar/signal-tracker    ← uses radar-signal-tracker
   POST /api/maker-radar/signal-tracker/verify  ← uses PRICE_SOURCES resolver
   POST /api/maker-radar/warmup            ← uses radar-cache (runWarmupSync)
   GET  /api/maker-radar/track             ← uses maker_radar_tracking.json
```

### 5.2 علاقة مكونات الـ UI

```
MakerRadarTab.tsx (2369 LOC — main tab)
  ├── StockTable (with MiniSparkline)
  │     └── fetch /api/stocks/sparkline (per-ticker)
  ├── SectorHeatStrip (existing)
  ├── ★ SectorTreemapCard     ◄── new (after SectorHeatStrip, ~line 835)
  │     └── fetch /api/maker-radar/sector-treemap?days=30 → flex-wrap treemap (12 sectors)
  ├── ★ RadarSignalStatsCard  ◄── new (after SectorTreemapCard)
  │     └── fetch /api/maker-radar/signal-tracker?days=30
  │     └── button → POST /api/maker-radar/signal-tracker/verify
  ├── StockDetailDrawer (per-ticker side panel)
  │     ├── TradingPlanSection (buy/sell pressure + grid + R:R badge)
  │     ├── MarketDepthLiquidityWidget (existing)
  │     ├── ★ EntryTimingCard       ◄── new (inside drawer, ~line 1884)
  │     │     └── fetch /api/maker-radar/entry-timing?ticker=X
  │     │         → score 0-100 + breakdown (4 factors) + recommendation
  │     └── ★ LiquidityFootprintCard ◄── new (after EntryTimingCard)
  │           └── fetch /api/maker-radar/footprint?ticker=X&days=30
  │               → POC/VAH/VAL + horizontal bars + buy/sell delta
  └── Last 10 days UnifiedTable (price action)

Other consumers of radar_alerts:
  ├── NotificationCenter (polls /api/notifications)
  │     └── renders notifications with type='radar_*' (with payload deep-link)
  └── V40.2 daily generator (radar_boost / radar_kill) — NO UI, backend-only
```

### 5.3 علاقة الـ data flow (مرئية شاملة)

| المصدر (Source) | المنتج (Sink) | الوسيلة (Mechanism) | التردد |
|---|---|---|---|
| Python `maker_radar.py` | `scripts/output/maker_radar_*.json` | كتابة مباشرة | عند كل warmup (cron / manual) |
| `maker_radar_*.json` | `radar-cache.ts → readRadarCache()` | قراءة synchronous | كل request لـ `/api/maker-radar/*` |
| `radar-cache.ts` | `radar-alerts.ts → runRadarAlertsCheck()` | dynamic import + fire-and-forget | بعد كل warmup ناجح |
| `radar-alerts.ts` | `user_notifications` table | `insertNotification()` | عند كل transition |
| `radar-alerts.ts` | `radar_signal_tracking` table | `recordSignalsBatch()` | بعد كل warmup |
| `radar-alerts.ts` | `radar_alerts_state.json` | `saveSnapshot()` | بعد كل warmup |
| `radar_signal_tracking` | GET `/signal-tracker` | SQL queries | عند كل fetch للـ UI |
| `radar_signal_tracking` | POST `/signal-tracker/verify` | SQL UPDATE | يدوي / cron يومي |
| `entry-timing/footprint` endpoints | UI cards | fetch + render | عند فتح الـ drawer |

---

## 6. خريطة الملفات (File Map)

### 6.1 ملفات جديدة (7 ملفات)

| # | المسار | السطور | الدور | الاعتماديات |
|---|---|---|---|---|
| 1 | `src/app/api/maker-radar/entry-timing/route.ts` | 256 | GET endpoint — حساب درجة توقيت الدخول 0-100 من 4 عوامل (accumulation/volume/support/momentum) | `@/lib/radar-db` |
| 2 | `src/app/api/maker-radar/footprint/route.ts` | 388 | GET endpoint — volume profile + POC + VAH/VAL + buy/sell delta per price level | `@/lib/radar-db` |
| 3 | `src/app/api/maker-radar/sector-treemap/route.ts` | 342 | GET endpoint — sector liquidity aggregation + direction (inflow/outflow/neutral) | `@/lib/radar-cache`, `better-sqlite3`, `db/stocks.db` |
| 4 | `src/app/api/maker-radar/signal-tracker/route.ts` | 372 | GET (stats) + POST (record) — مع dedup على `(ticker, signal_date, signal_type)` | `better-sqlite3` |
| 5 | `src/app/api/maker-radar/signal-tracker/verify/route.ts` | 387 | POST — verify pending signals بـ outcomes 7d/14d/30d من 4 price sources | `better-sqlite3` |
| 6 | `src/lib/radar-signal-tracker.ts` | 190 | shared DB layer — `recordSignal / recordSignalsBatch / ensureSchema / openTrackerDb` | `better-sqlite3`, `fs` |
| 7 | `src/lib/schedulers/radar-alerts.ts` | 447 | smart alerts engine — 4 alert types + snapshot management + `recordRadarSignals()` | `@/lib/radar-cache`, `@/lib/finance-db`, `@/lib/auth-helper`, `@/lib/schedulers/alert-engine`, `@/lib/radar-signal-tracker` (dynamic) |

### 6.2 ملفات جديدة (UI) — 1 ملف بـ 4 components

| # | المسار | السطور | الدور | الاعتماديات |
|---|---|---|---|---|
| 8 | `src/components/predictions/radar/RadarStatsCards.tsx` | 793 | 4 components: `RadarSignalStatsCard` (98-301) + `SectorTreemapCard` (335-454) + `EntryTimingCard` (482-596) + `LiquidityFootprintCard` (632-793) | `lucide-react`, `@/components/ui/card`, `@/components/ui/badge`, `@/components/ui/button`, `@/components/ui/skeleton` |

### 6.3 ملفات معدّلة (surgical edits) — 3 ملفات

| # | المسار | نوع التعديل | صافي السطور | الدور |
|---|---|---|---|---|
| 9 | `src/lib/schedulers/alert-engine.ts` | 5 تعديلات surgical (import + interface field + export keyword + runAllAlerts body + early-return paths) | +17 | إضافة `radar_alerts` engine لـ `runAllAlerts` + export `insertNotification` |
| 10 | `src/lib/radar-cache.ts` | 2 تعديلات surgical (في `triggerBackgroundWarmup` + `runWarmupSync`) | +13 | fire-and-forget `runRadarAlertsCheck()` بعد كل warmup ناجح |
| 11 | `src/components/predictions/MakerRadarTab.tsx` | إضافة import + 4 insertions للـ components الجديدة | ~+30 | دمج الـ 4 cards في الـ tab (SectorTreemapCard + RadarSignalStatsCard بعد SectorHeatStrip، EntryTimingCard + LiquidityFootprintCard داخل StockDetailDrawer) |

### 6.4 ملفات موجودة سابقاً (غير معدَّلة لكن مهمة للـ context)

| # | المسار | السطور | الدور |
|---|---|---|---|
| 12 | `src/lib/radar-db.ts` | 180 | الـ DB resolver اللي بيتشاركه entry-timing + footprint |
| 13 | `src/lib/finance-db.ts` | — | `getFinanceDb()` اللي بيرجع stocks.db |
| 14 | `src/lib/auth-helper.ts` | — | `getSessionUserId()` للـ radar-alerts في mode الـ user |
| 15 | `db/stocks.db` | — | SQLite: `stocks` table + `radar_signal_tracking` table + `user_notifications` table |
| 16 | `db/data_engine.db` | — | fallback DB للـ radar prices |
| 17 | `db/radar_alerts_state.json` | — | ملف snapshot بيُكتب تلقائياً |
| 18 | `db/maker_radar_tracking.json` | — | ملف tracking (موجود قبل الترقية) |
| 19 | `scripts/output/maker_radar_*.json` | — | ملف الـ radar cache اليومي |
| 20 | `vps-service/jobs/v40_2_daily_generator.py` | 2963 | محرك V40.2 — فيه integration lines 2200-2246 (موجود قبل الترقية) |
| 21 | `vps-service/utils/shared_liquidity.py` | — | `check_kill_switch()` + `compute_money_flow()` |

### 6.5 الإجمالي
| النوع | العدد | السطور |
|---|---|---|
| ملفات جديدة (Backend) | 7 | 2,382 |
| ملفات جديدة (UI) | 1 | 793 |
| ملفات معدّلة | 3 | ~+60 |
| **الإجمالي الجديد** | **8 ملفات** | **~3,175 سطر** |

---

## 7. نقاط التكامل (Integration Points)

### 7.1 تكامل الرادار مع V40.2 daily generator

**الموقع:** `vps-service/jobs/v40_2_daily_generator.py` lines **2200-2246**

**نوع التكامل:** Python → Python (sync call within the same process)

**الـ flow:**
1. V40.2 generator بيتحمَّل كل يوم عبر cron (`vps-service/scripts/run_daily.sh` أو ما يعادله).
2. لكل `(ticker, scan_date)` بيشغّل `analyze_single_day_v393(...)` → `result` dict.
3. بعد الـ result مباشرة، بيتحقق من الـ radar:
   ```python
   from utils.shared_liquidity import check_kill_switch, compute_money_flow
   # ...
   _kill_triggered, _kill_reason = check_kill_switch(closes, volumes, highs, lows)
   _mf = compute_money_flow(closes, volumes, highs, lows)
   ```
4. لو kill=True → `continue` (الإشارة تُرفض).
5. لو boost != 0 → `result['score'] += boost` (clamped 0-100).
6. الإشارة بتتسجَّل في `signals_by_date[scan_date]` فقط لو مش killed.

**الاعتماديات:**
- `vps-service/utils/shared_liquidity.py` → `check_kill_switch()` + `compute_money_flow()`.

**السلوك عند الفشل:** `try/except Exception: pass` → safe-by-design. لو `shared_liquidity` فشل → V40.2 بيكمّل من غير radar kill/boost.

**كيف تختبر الـ integration:**
- شغّل V40.2 generator وراقب stdout للـ prefix `[RADAR-KILL]` أو `[RADAR-BOOST]`.
- لو شفت prefix ده → التكامل شغّال.
- لو ما شفتش → تأكد إن `shared_liquidity.py` متاح و import-able.

---

### 7.2 تكامل الرادار مع alert-engine

**الموقع:** `src/lib/schedulers/alert-engine.ts` (modified) + `src/lib/schedulers/radar-alerts.ts` (new)

**نوع التكامل:** TypeScript → TypeScript (function call, same process)

**التعديلات على alert-engine.ts:**
1. إضافة `import { runRadarAlertsCheck } from './radar-alerts';` (top of file).
2. إضافة `radar_alerts: number;` field لـ `AlertEngineResult` interface.
3. تحويل `insertNotification` من private → `export function` (عشان radar-alerts.ts يستخدمها).
4. إضافة الـ 4th engine block في `runAllAlerts(userId?)`:
   ```ts
   try {
     radarAlerts = await runRadarAlertsCheck(userId);
   } catch (err) {
     errors.push(`radar: ${err instanceof Error ? err.message : String(err)}`);
   }
   ```
5. تحديث `total: stockAlerts + goldAlerts + pnlAlerts + radarAlerts`.
6. إضافة `radar_alerts: 0` لكلا early-return paths في `runAllAlertsForCurrentUser()` (no-session + session-error).

**الـ call sites:**
- `runAllAlerts(userId)` → يدعو `runRadarAlertsCheck(userId)` كـ 4th engine.
- `runAllAlertsForCurrentUser()` → يدعو `runAllAlerts(userId)`.
- أي cron job أو API endpoint بيستدعي `runAllAlerts` هيشغّل الـ radar alerts كمان.

**السلوك عند الفشل:** try/catch في `runAllAlerts` بيلف الـ radar engine call → لو فشل، بيتسجَّل في `errors[]` وبيكمّل لباقي الـ engines.

---

### 7.3 تكامل الرادار مع نظام user_notifications

**الموقع:** `db/stocks.db → user_notifications` table + `src/lib/schedulers/radar-alerts.ts`

**الـ schema المُستخدَم:** (موجود قبل الترقية، `ensureUserNotifColumns()` بيضمن وجوده)
```sql
CREATE TABLE IF NOT EXISTS user_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  severity TEXT DEFAULT 'info',
  payload TEXT,
  ticker TEXT,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**الأنواع الجديدة المُسجَّلة:**
- `radar_explosive` (severity=warning)
- `radar_opportunity` (severity=info)
- `radar_distribution` (severity=warning)
- `radar_flare` (severity=info)

**الـ dedup mechanism:** `insertNotification()` بيتحقق من:
```sql
SELECT 1 FROM user_notifications
WHERE user_id = ?
  AND type = ?
  AND ticker IS ?
  AND message = ?
  AND created_at > datetime('now', '-24 hours')
LIMIT 1
```
لو موجود → `return false` (skip insert). ده يمنع الـ spam لو الـ warmup اشتغل مرتين في نفس اليوم.

**الـ user_id strategy:**
- `runRadarAlertsCheck(undefined)` → `user_id = 'system'` (global alert, يظهر لكل المستخدمين عبر NotificationCenter).
- `runRadarAlertsCheck(userId)` → `user_id = userId` (specific user alert).

**الـ payload structure:** (راجع §3.2 لكل نوع على حدة).

**كيف يصل الـ notification للـ UI:**
- `NotificationCenter` component بيـ poll `/api/notifications?limit=20` كل X ثانية.
- `/api/notifications` بيرجع الـ notifications الجديدة من `user_notifications` table.
- الـ UI بيـ render كل notification حسب الـ `type` (ممكن deep-link لرادار السهم لو في `payload.ticker`).

---

## 8. خطة الاختبار (Testing Checklist)

### 8.1 اختبار `GET /api/maker-radar/entry-timing`

| # | الحالة (Case) | الـ request | النتيجة المتوقَّعة |
|---|---|---|---|
| 1.1 | ticker موجود وبياناته كافية | `?ticker=COMI` | 200 + `success:true` + `score` 0-100 + breakdown كامل |
| 1.2 | ticker غير موجود | `?ticker=NONEXIST` | 200 + `success:false` + `error: "بيانات غير كافية..."` + `data_points: 0` |
| 1.3 | ticker فارغ | `?ticker=` | 400 + `error: "ticker query param is required"` |
| 1.4 | بدون ticker | `/api/maker-radar/entry-timing` | 400 + نفس الـ error |
| 1.5 | ticker بحروف lowercase | `?ticker=comi` | 200 + `ticker: "COMI"` (auto upper) |
| 1.6 | DB مفقود | (delete db/stocks.db + db/data_engine.db) | 503 + `error: "No radar DB available..."` |
| 1.7 | بيانات قليلة (15 جلسة) | `?ticker=NEWLISTED` | 200 + `success:false` + `data_points: < 15` |
| 1.8 | تحقّق من المجموع | (manual calc) | `score === accScore + volScore + supScore + momScore` |

### 8.2 اختبار `GET /api/maker-radar/signal-tracker`

| # | الحالة | الـ request | النتيجة المتوقَّعة |
|---|---|---|---|
| 2.1 | جدول جديد (فارغ) | `?days=30` | 200 + `total_signals: 0` + `by_signal_type: []` |
| 2.2 | جدول فيه إشارات | `?days=120` (after seeding) | 200 + `total_signals > 0` + breakdown by type |
| 2.3 | فلتر signal_type | `?days=30&signal_type=explosive_surge` | 200 + كل rows من نوع `explosive_surge` فقط |
| 2.4 | signal_type غير صالح | `?signal_type=invalid` | 200 + `by_signal_type: []` (no filter applied because invalid type doesn't match) |
| 2.5 | days = 1 | `?days=1` | 200 + `total_signals` بس إشارات اليوم |
| 2.6 | DB مفقود | (delete db/stocks.db + db/data_engine.db) | 503 + `error: "Cannot open tracker DB..."` |

### 8.3 اختبار `POST /api/maker-radar/signal-tracker`

| # | الحالة | الـ body | النتيجة المتوقَّعة |
|---|---|---|---|
| 3.1 | إشارة جديدة | `{ticker:"COMI",signal_type:"explosive_surge",entry_price:52.41}` | 200 + `success:true` + `dedup:false` + `id: <number>` |
| 3.2 | إشارة مكررة | (نفس الـ body مرة تانية) | 200 + `success:true` + `dedup:true` + `existing_id: <same number>` |
| 3.3 | ticker فارغ / signal_type غير صالح / entry_price ≤ 0 | (various invalid inputs) | 400 + error message مناسبة |
| 3.4 | بدون body | (no body) | 500 + `error: "Unexpected token ..."` |

### 8.4 اختبار `POST /api/maker-radar/signal-tracker/verify`

| # | الحالة | الـ body | النتيجة المتوقَّعة |
|---|---|---|---|
| 4.1 | مفيش pending signals | `{}` | 200 + `verified_count: 0` + `message: "لا توجد إشارات بانتظار التحقق..."` |
| 4.2 | pending signal عمرها < 7 أيام | (seed signal from yesterday) | 200 + `verified_count: 0` (too fresh, skipped) |
| 4.3 | pending signal عمرها 7 أيام + prices متوفرة | (seed signal from 8 days ago) | 200 + `verified_count: 1` + `outcome_7d != null` |
| 4.4 | pending signal عمرها 30 يوم | (seed signal from 31 days ago) | 200 + `verified_count: 1` + status = `verified_win/loss/neutral` |
| 4.5 | max_age_days edge cases (7, 180, 5) | `{max_age_days:7/180/5}` | 200 + clamped بين 7 و 180 |
| 4.6 | malformed JSON / بدون body | `{"bad json` | 200 + `verified_count: 0` + يعامَل كـ `{}` |
| 4.7 | DB مفقود | (delete db files) | 503 + `error: "Cannot open tracker DB..."` |

### 8.5 اختبار `GET /api/maker-radar/footprint`

| # | الحالة | الـ request | النتيجة المتوقَّعة |
|---|---|---|---|
| 5.1 | ticker موجود + بيانات كافية | `?ticker=COMI&days=30` | 200 + `success:true` + `poc_price` + `vah_price` + `val_price` + `levels` (18 level تقريباً) |
| 5.2 | ticker غير موجود / بيانات < 5 | `?ticker=NONEXIST` | 200 + `success:false` + `error: "بيانات غير كافية..."` |
| 5.3 | ticker فارغ | `?ticker=` | 400 + `error: "ticker query param is required"` |
| 5.4 | days edge cases (0, 1000) | `?days=0` or `?days=1000` | 200 + default 30 fallback / clamped to 365 |
| 5.5 | ticker جميع أسعاره متساوية | `?ticker=FLATSTOCK` | 200 + `bin_count: 1` + degenerate single-bin case |
| 5.6 | DB مفقود | (delete db files) | 503 + `error: "لا تتوفر قاعدة بيانات الرادار..."` |

### 8.6 اختبار `GET /api/maker-radar/sector-treemap`

| # | الحالة | الـ request | النتيجة المتوقَّعة |
|---|---|---|---|
| 6.1 | radar cache موجود | `?days=30` | 200 + `success:true` + `sectors[]` مُرتَّبة تنازلياً حسب `total_turnover` |
| 6.2 | radar cache مفقود / 0 tickers | (delete scripts/output/*.json) | 503 + `error: "الرادار بيتسخن..."` + `warming_up: true` |
| 6.3 | stocks.db مفقود | (delete db/stocks.db) | 503 + `error: "قاعدة بيانات الأسهم غير متوفرة..."` |
| 6.4 | ticker في الرادار بس مش في stocks.db | (orphan ticker) | 200 + ticker بيروح لقطاع "غير مُصنّف" |
| 6.5 | days = 7 | `?days=7` | 200 + نفس الـ data (days for display only) |

### 8.7 اختبار `runRadarAlertsCheck` (smart alerts)

| # | الحالة | الـ setup | النتيجة المتوقَّعة |
|---|---|---|---|
| 7.1 | أول تشغيل (no snapshot) | (delete radar_alerts_state.json) | 0 alerts fired + snapshot new file created |
| 7.2 | سهم دخل explosive (new) | (modify cache: add new ticker to explosive_list) | 1 `radar_explosive` alert fired for that ticker |
| 7.3 | سهم ظهر في quiet (new) | (modify cache: add new ticker to quiet_list) | 1 `radar_opportunity` alert fired |
| 7.4 | سهم متابَع تحوّل تجميع → تصريف / volume_ratio > 1.30 | (modify tracking + cache) | 1 `radar_distribution` + 1 `radar_flare` alert |
| 7.5 | run مرتين متتاليتين | (run, then run again immediately) | 0 alerts في المرة التانية (24h dedup) |
| 7.6 | radar cache / tracking file مفقود | (delete either file) | 0 silently (no error) / 0 distribution/flare alerts only |

### 8.8 اختبار UI Components

| # | الحالة | الـ action | النتيجة المتوقَّعة |
|---|---|---|---|
| 8.1 | فتح MakerRadarTab | navigate to /predictions → radar tab | SectorTreemapCard + RadarSignalStatsCard بيظهروا بعد SectorHeatStrip |
| 8.2 | click على سهم في الجدول | click ticker row | StockDetailDrawer بيفتح + EntryTimingCard + LiquidityFootprintCard بيظهروا |
| 8.3 | EntryTimingCard فيه / بدون data | (ticker له ≥15 / <15 جلسة) | score + breakdown + recommendation / "تعذّر حساب توقيت الدخول" + dashed border |
| 8.4 | LiquidityFootprintCard فيه / بدون data | (ticker ≥5 / <5 جلسات) | POC/VAH/VAL + buy/sell bar / "تعذّر تحميل بصمة السيولة" |
| 8.5 | SectorTreemapCard فيه / بدون data | (radar cache موجود / cold) | 12 box ملوّنة + top sectors / "الرادار بيتسخن — حاول تاني بعد شوية" |
| 8.6 | RadarSignalStatsCard زر "تحقّق" | click verify button | "جاري التحقق..." + spinner + ثم "✓ تم التحقق من X إشارة" |
| 8.7 | RadarSignalStatsCard بدون إشارات / refresh button | (empty DB / click refresh) | "لسه مفيش إشارات مسجّلة" + Info icon / card يعمل re-fetch |

### 8.9 اختبار الـ End-to-End

| # | السيناريو | الخطوات | النتيجة المتوقَّعة |
|---|---|---|---|
| 9.1 | warmup كامل | POST /api/maker-radar/warmup → wait 90s → GET /api/notifications | تنبيهات `radar_*` جديدة + radar_signal_tracking فيها صفوف جديدة |
| 9.2 | verify بعد 8 أيام | seed signal (8 days ago) → POST /signal-tracker/verify → GET /signal-tracker | الـ row الـ pending بقى `verified_win/loss/neutral` + `outcome_7d` populated |
| 9.3 | V40.2 generator | sh run_daily.sh → check stdout | prefix `[RADAR-KILL]` أو `[RADAR-BOOST]` بيظهر في الـ logs |

---

## 9. الصيانة والترقيات المستقبلية (Maintenance & Future Upgrades)

### 9.1 كيف تضيف `signal_type` جديد؟

#### الخطوات (4 تعديلات)

1. **أضف للـ `VALID_SIGNAL_TYPES` Set** في `src/lib/radar-signal-tracker.ts` (line ~95) و `src/app/api/maker-radar/signal-tracker/route.ts` (line ~267).
2. **أضف للـ `SIGNAL_LABELS` Record** في نفس الملفين (lines ~87 / ~84): `breakout_strong: '💥 اختراق قوي'`.
3. **أضف للـ UI label maps** في `src/components/predictions/radar/RadarStatsCards.tsx` (line ~62): `SIGNAL_TYPE_AR` + `SIGNAL_TYPE_COLOR` (use `text-emerald-*` palette — لا تستخدم indigo/blue).
4. **أضف لـ `recordRadarSignals()`** في `src/lib/schedulers/radar-alerts.ts` (line ~391): أضف logic لتحديد الـ signals اللي نوعها الجديد من الـ radar cache lists.

> ⚠️ **ملاحظة:** الـ DB schema ما يحتاجش تعديل — `signal_type` هو TEXT column وبيقبل أي string. الـ constraints كلها في الـ application layer.

---

### 9.2 كيف تغيّر thresholds الـ entry timing؟

كل الـ thresholds موجودة في `src/app/api/maker-radar/entry-timing/route.ts` (lines 75-142) كـ if/else chains.

#### مثال: تغيير threshold الـ momentum من `5-15% → 20` لـ `4-18% → 22`

```ts
// قبل
if (roc10 >= 5 && roc10 <= 15) { momScore = 20; momLabel = 'زخم مثالي'; }

// بعد
if (roc10 >= 4 && roc10 <= 18) { momScore = 22; momLabel = 'زخم مثالي'; }
```

#### قائمة بكل الـ thresholds + مكانها

| الـ threshold | الملف:السطر | القيمة الحالية |
|---|---|---|
| `buyDays >= 8 → 30` | entry-timing/route.ts:75 | 8 أيام → 30 نقطة |
| `buyDays >= 6 → 22` | :76 | 6 أيام → 22 نقطة |
| `buyDays >= 5 → 15` | :77 | 5 أيام → 15 نقطة |
| `buyDays >= 3 → 8` | :78 | 3 أيام → 8 نقاط |
| `volRatio >= 1.5 → 25` | :96 | 1.5× → 25 نقطة |
| `volRatio >= 1.2 → 18` | :97 | 1.2× → 18 نقطة |
| `volRatio >= 1.0 → 10` | :98 | 1.0× → 10 نقاط |
| `distanceFromMin <= 2% → 25` | :111 | ≤2% → 25 نقطة |
| `distanceFromMin <= 5% → 18` | :112 | ≤5% → 18 نقطة |
| `distanceFromMin <= 10% → 10` | :113 | ≤10% → 10 نقاط |
| `roc10 5-15% → 20` | :127 | 5-15% → 20 نقطة |
| `score >= 80 → ممتاز` | :139 | emerald |
| `score >= 60 → جيد` | :140 | amber |
| `score >= 40 → مقبول` | :141 | yellow |

> 💡 **أفضل ممارسة:** بعد أي تغيير، شغّل `bun run lint` + اختبر endpoint على 3-4 tickers مختلفين للتأكد من الـ calibration.

---

### 9.3 كيف تضيف alert type جديد؟

#### الخطوات (3 تعديلات)

1. **في `src/lib/schedulers/radar-alerts.ts`** — أضف block جديد في `runRadarAlertsCheck()`:
   ```ts
   // (5) NEW ALERT TYPE — مثلاً: radar_volume_drop
   for (const ticker of trackedTickers) {
     const item = allRadarItems.get(ticker);
     const volRatio = Number(item?.volume_ratio_10d_vs_20d || 0);
     if (volRatio < 0.5) {  // حجم منخفض جداً
       const ok = insertNotification(db, {
         user_id: targetUserId,
         type: 'radar_volume_drop',  // ★ النوع الجديد
         title: '📉 انخفاض حجمي حاد',
         message: `${ticker} حجم اليوم ${volRatio.toFixed(2)}× من متوسط 20 يوم — انخفاض حاد`,
         severity: 'warning',
         ticker,
         payload: JSON.stringify({
           ticker,
           volume_ratio_10d_vs_20d: volRatio,
           current_price: item?.current_price ?? null,
         }),
       });
       if (ok) fired++;
     }
   }
   ```

2. **في `src/components/...NotificationCenter.tsx`** (إذا كان فيه special rendering per type): أضف case للنوع الجديد. معظم الـ notifications بتترسم بنفس الشكل، لكن لو عايز deep-link مختلف → استخدم الـ `payload`.

3. **اختبار:** شغّل `runRadarAlertsCheck()` يدوياً وراقب `user_notifications` table:
   ```bash
   sqlite3 db/stocks.db "SELECT * FROM user_notifications WHERE type='radar_volume_drop' ORDER BY id DESC LIMIT 5;"
   ```

> ⚠️ **مهم:** الـ 24h dedup في `insertNotification` بيشتغل تلقائياً → لو الـ alert type جديد، الـ dedup هيعمل بشكل صحيح بدون تعديلات.

---

### 9.4 ملاحظات حول الأداء (Performance Notes)

#### الـ warmup
- الـ Python script بياخد 30-90 ثانية على 303 سهم (production DB = 1.8GB).
- الـ `triggerBackgroundWarmup` بيـ spawn detached child → الـ API request بتخلص فوراً.
- الـ `runWarmupSync` blocks لحد 90 ثانية (timeout) → استخدمه في الـ cron jobs فقط.
- مفيش concurrent warmups (mutex via `warmupInMemory` flag + status file).

#### الـ alerts + signal recording
- الـ `runRadarAlertsCheck()` بيشتغل **async بعد** الـ warmup → ما يعلقش الـ API.
- الـ `recordSignalsBatch()` بيفتح DB connection واحد وبيعمل inserts sequential (مش parallel) → آمن للـ SQLite WAL mode.
- الـ snapshot save بيستخدم `writeFileSync` (sync) → سريع (<5ms لـ 303 tickers).

#### الـ endpoints
- `entry-timing`: 1 SQL query (LIMIT 30) → ~5-15ms على production DB.
- `footprint`: 1 SQL query + in-memory binning → ~10-25ms.
- `sector-treemap`: 1 SQL query على stocks.db (IN clause بـ ~300 params) → ~20-50ms.
- `signal-tracker` GET: 4 COUNT queries + 1 AVG + 1 GROUP BY + 1 recent LIMIT 5 → ~30-60ms.
- `signal-tracker` POST verify: N queries (N = pending count, max 500) → ~500ms-2s. **مُستحسن:** تشغيله cron يومي مش per-request.

#### الـ UI
- كل cards بتعمل `cache: 'no-store'` fetch + `useEffect` → بتحمل على الـ mount الأول.
- الـ SectorTreemapCard بيـ render 12 sector box max → ما فيش virtual DOM bottleneck.
- الـ LiquidityFootprintCard بيـ render 18 level bars في `max-h-56 overflow-y-auto` → scroll-able لو الـ levels كتيرة.

#### الـ SQLite considerations
- `radar_signal_tracking` table عندها 4 indexes (ticker / status / type / date) → SELECTs سريعة حتى مع 10K+ rows.
- `user_notifications` عندها dedup query بتـ scan آخ 24h → ممكن تتعمل index على `(user_id, type, ticker, created_at)` لو حسّيت ببطء.
- WAL mode مفعّل على `stocks.db` عبر `db.pragma('journal_mode = WAL')` في `radar-signal-tracker.ts:52` → concurrent reads مع writes آمنة.

#### الـ cron المُقترَح
| الـ task | التردد | الـ command |
|---|---|---|
| Radar warmup | كل 15 دقيقة | `curl -X POST http://localhost:3000/api/maker-radar/warmup` |
| Signal verify | يومياً 03:00 AM | `curl -X POST http://localhost:3000/api/maker-radar/signal-tracker/verify -H 'Content-Type: application/json' -d '{"max_age_days":45}'` |
| V40.2 daily | يومياً 06:00 AM | `cd /home/z/my-project/vps-service && python3 jobs/v40_2_daily_generator.py --today-only` |

---

## آخر تحديث

**التاريخ:** 2026-09-27
**المُنفِّذ:** Documentation Secretary (السكرتيرة) — Task ID `DOC-SECRETARY-1`
**المراجع:**
- `worklog.md` (tasks `RADAR-A` + `RADAR-B` + `RADAR-C` + `RADAR-MAIN`)
- `src/app/api/maker-radar/entry-timing/route.ts` (256 LOC)
- `src/app/api/maker-radar/footprint/route.ts` (388 LOC)
- `src/app/api/maker-radar/sector-treemap/route.ts` (342 LOC)
- `src/app/api/maker-radar/signal-tracker/route.ts` (372 LOC)
- `src/app/api/maker-radar/signal-tracker/verify/route.ts` (387 LOC)
- `src/lib/radar-signal-tracker.ts` (190 LOC)
- `src/lib/schedulers/radar-alerts.ts` (447 LOC)
- `src/components/predictions/radar/RadarStatsCards.tsx` (793 LOC)
- `src/lib/schedulers/alert-engine.ts` (659 LOC, modified)
- `src/lib/radar-cache.ts` (438 LOC, modified)
- `vps-service/jobs/v40_2_daily_generator.py` (lines 2200-2246)

**القواعد المُتَّبَعَة:**
- ✅ Rule 39 (DOCS-FIRST-LAST) — توثيق شامل قبل/بعد كل ترقية كبيرة.
- ✅ Rule 16 (VERIFY-BEFORE-DELETE) — لم تُحذف أي ملفات.
- ✅ Rule 25 (refactoring-gated) — لم تُعاد كتابة أي ملفات (surgical edits فقط).
- ✅ Rule 11 (single source of truth) — الـ thresholds موثَّقة بـ file:line لكل واحد.
- ✅ Project style — عربي + English technical terms + markdown tables + emoji where appropriate.
- ✅ No `indigo` / `blue` colors in code examples (استخدام emerald/amber/yellow/rose/purple فقط في الـ UI tokens حسب القواعد الموجودة في `RadarStatsCards.tsx`).

---

> 📝 **ملاحظة ختامية:** هذا الملف هو **المرجع الرسمي** لترقية رادار السيولة. أي تعديل مستقبلي على أي من الميزات الـ 6 يجب أن يُحدِّث هذا الملف + سجل التغييرات في `worklog.md`. الـ file map في §6 يجب أن يبقى متزامناً مع الـ codebase — لو أضفت endpoint جديد أو ملف lib جديد، أضفه للجدول.
