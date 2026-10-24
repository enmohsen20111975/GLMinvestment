# 🧠 تقرير برافو — خطة ربط المحركات (Confluence Engine)
## كيف نربط السيولة + حركة الحيتان + التصحيح + التوقعات + التحليلات

**Task ID:** BRAVO-CONFLUENCE-PLAN
**Agent:** برافو (تنين الباك إند والكم المجنح)
**التاريخ:** 2026-10-20
**المنهج:** فكر بصوت عالي + جرب سيناريوهات على جنب + مفيش هلد ولا كذب

---

## 📊 الواقع الحالي (قرأت كل DB)

### المكونات الموجودة (كلها شغالة لوحدها):
| المكون | الوظيفة | المصدر | الحالة |
|--------|---------|--------|--------|
| **flow_system** | FlowScore 0-100 (4 طبقات: MACRO + SECTOR + STOCK + CROSS) | `engines/flow_system.py` | شغال بس مش مربوط |
| **explosive_scanner** | EXPLOSIVE_SCORE (Volume + Price + Smart Money) | `engines/explosive_scanner.py` | شغال بس مش مربوط |
| **maker_radar** | 5 paths (pre_surge + quiet_accum + explosive + early_break + distribution) | `scripts/maker_radar.py` | شغال + cache يومي |
| **incubator_engine** | الأسهم قيد التسخين (4/6 أو 5/6 signals) | `scripts/maker_radar.py` | شغال (شغلي بتاع BRAVO-INCUBATOR) |
| **support_resistance** | swing highs/lows (مستويات التصحيح) | `analyzers/support_resistance_calculator.py` | شغال + موجود في stocks.db |
| **market_regime** | Stage 1-4 (Minervini) | `engines/market_regime.py` | شغال + موجود في system_settings |
| **daily_predictor** | V40.2 predictions | `jobs/daily_predictor.py` | شغال بس بيولّد predictions من غير whale data |
| **stored_analyses** | maestro_score + recommendation + entry/target/stop | `predictions.db.stored_analyses` | شغال (12 row) |

### الكارثة اللي لقيتها (الربط مفقود):

```
predictions table (1488 rows):
  explosive_score:     0/1488 populated ❌ (العمود موجود بس فاضي)
  evidence_count:     10/1488 populated ❌ (1% بس)
  maker_entry_volume:  0/1488 populated ❌ (العمود موجود بس فاضي)
  fuel_pct:            0/1488 populated ❌ (العمود موجود بس فاضي)
  flow_score:          غير موجود كعمود ❌
  whale_proof:         غير موجود كعمود ❌
```

**الخلاصة:** الـ daily_predictor بيولّد predictions من غير ما يربط مع flow_system أو explosive_scanner أو maker_radar. كل مكون بيشتغل لوحده. ده اللي لازم نربطه.

---

## 🧠 التفكير (3 سيناريوهات جربتها على جنب)

### السيناريو 1: "تأكيد الحيتان" (Whale Confluence)

**المشكلة الحالية:**
- daily_predictor بيقول "شراء" لسهم معين (based on technicals بس)
- flow_system في نفس الوقت بيقول "FlowScore = 85" (تدفق سيولة قوي)
- explosive_scanner بيقول "EXPLOSIVE_SCORE = 75" (انفجار حجم)
- maker_radar بيقول "B_quiet_accumulation_strong" (تجميع هادئ قوي)
- **4 مكونات بيقولوا "شراء" بس الـ prediction النهائي مفيهوش أي إشارة إن فيه تأكيد مؤسسي!**

**الحل:**
```
whale_proof = 0
if flow_score >= 80:        whale_proof += 1  # تدفق سيولة قوي
if explosive_score >= 70:   whale_proof += 1  # انفجار حجم
if maker_path in ['A_pre_surge', 'B_quiet_accumulation_strong']:  whale_proof += 1  # تجميع
if net_flow_egp > 0:        whale_proof += 1  # سيولة موجبة

if whale_proof >= 3:
    confidence += 15
    evidence_count += whale_proof
    track = 'WHALE_CONFLUENCE'
    verdict = 'شراء مؤسسي قوي — تأكيد 4 مصادر'
```

**الفائدة:** العميل يشوف "شراء مؤسسي قوي — تأكيد 4 مصادر" بدل "شراء" لوحدها. ثقة أعلى + قرار أوضح.

---

### السيناريو 2: "دخول بعد تصحيح" (Correction Entry)

**المشكلة الحالية:**
- السهم صعد +6% (FOMO spike) → anti-FOMO بيمنع الشراء (شغلي بتاع BRAVO-FIX10)
- بس السهم ممكن يكون كويس فعلاً، بس محتاج نستنى التصحيح
- **مفيش tracking للسهم بعد ما يصحح!**

**الحل:**
```
# لما anti-FOMO يمنع الشراء:
if is_fomo_spike:
    # بدل ما نرفضه نهائياً، نحطه في incubator مع trigger = SUPPORT_CONFIRM
    incubator_candidate = {
        'ticker': ticker,
        'trigger': {
            'type': 'SUPPORT_CONFIRM',
            'trigger_price': support_level,  # من stocks.db.support
            'condition_ar': f'بانتظار تصحيح السعر إلى دعم {support_level}'
        },
        'readiness_pct': 80,  # جاهز بس محتاج تصحيح
        'stage': 'AWAITING_PULLBACK'
    }

# لما السهم يصحح (يرجع للدعم):
if current_price <= support_level * 1.02:  # وصل قرب الدعم
    if flow_score >= 60:  # الحيتان لسه بتشتري
        → activate prediction: signal='BUY', track='PULLBACK_ENTRY'
        → reason: 'دخول بعد تصحيح عند الدعم + تأكيد استمرار التدفق'
```

**الفائدة:** بدل ما نخسر السهم اللي طلع +6%، نستناه يصحح ونشتري بأمان عند الدعم.

---

### السيناريو 3: "تحذير التصريف" (Distribution Veto)

**المشكلة الحالية:**
- daily_predictor بيقول "شراء" لسهم
- بس flow_system بيقول "تدفق سالب -50M" (تصريف)
- maker_radar بيقول "distribution_flag = True"
- **الـ prediction بـ يطلع "شراء" رغم إن الحيتان بتبيع!**

**الحل:**
```
distribution_warning = 0
if net_flow_egp < -10_000_000:    distribution_warning += 1  # تصريف قوي
if maker_path == 'distribution':  distribution_warning += 1  # maker_radar أكد
if flow_score < 40:               distribution_warning += 1  # FlowScore ضعيف

# VETO: لو فيه تحذير تصريف → اقلب الإشارة
if distribution_warning >= 2 and signal == 'BUY':
    signal = 'HOLD'
    track = 'DISTRIBUTION_VETO'
    reason = '⚠️ تحذير تصريف — الحيتان بتبيع. انتظار.'
```

**الفائدة:** منع شراء سهم الحيتان بتبيعه. ده بيحمي العميل من الفخاخ.

---

## 🏗️ الخطة الكاملة (Confluence Pipeline)

### الـ Pipeline الجديد (ربط كل المكونات):

```
┌─────────────────────────────────────────────────────────────┐
│ 1. DATA LAYER (قراءة كل المصادر)                            │
│   ├─ flow_system.get_flow_score(ticker) → FlowScore 0-100  │
│   ├─ explosive_scanner.scan(ticker) → EXPLOSIVE_SCORE      │
│   ├─ maker_radar cache → path + distribution_flag          │
│   ├─ stocks.db → support + resistance + volume             │
│   ├─ system_settings → current_regime                      │
│   └─ predictions.db → existing prediction                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. CONFLUENCE LAYER (تجميع الإثباتات)                       │
│   ├─ whale_proof = (flow>=80) + (explosive>=70) + (maker)  │
│   ├─ accumulation_proof = (maker_path = quiet_accum)       │
│   ├─ correction_proof = (price near support)               │
│   ├─ distribution_warning = (net_flow<0) + (maker=distrib) │
│   └─ regime_proof = (regime = Stage 2)                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. DECISION LAYER (القرار النهائي)                          │
│   ├─ if distribution_warning >= 2 → VETO (HOLD)            │
│   ├─ if whale_proof >= 3 → STRONG_BUY + confidence += 15   │
│   ├─ if whale_proof >= 2 → BUY + confidence += 10          │
│   ├─ if is_fomo_spike → incubator (AWAITING_PULLBACK)      │
│   ├─ if correction_proof + whale_proof → PULLBACK_ENTRY    │
│   └─ else → original signal                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. STORAGE LAYER (تخزين النتائج)                            │
│   predictions table:                                        │
│   ├─ explosive_score (من explosive_scanner)                │
│   ├─ evidence_count (عدد الـ proofs)                       │
│   ├─ maker_entry_volume (من maker_radar)                   │
│   ├─ fuel_pct (من flow_system)                             │
│   ├─ track = WHALE_CONFLUENCE / PULLBACK_ENTRY / etc.      │
│   └─ notes = "تأكيد 4 مصادر" / "تصحيح عند الدعم"           │
└─────────────────────────────────────────────────────────────┘
```

### الـ DBs اللي هنشتغل منها:

| DB | الجداول | الاستخدام |
|----|---------|---------|
| **predictions.db** | predictions + stored_analyses | قراءة التوقعات الحالية + كتابة الـ confluence results |
| **stocks.db** | stocks (support/resistance/volume) + system_settings (regime) | قراءة مستويات الدعم/المقاومة + حالة السوق |
| **data_engine.db** | stocks (logo_url) + crypto_prices | قراءة logos + crypto data |
| **price_history.db** | price_history | قراءة بيانات الأسعار التاريخية |
| **intraday.db** | stock_intraday | قراءة الأسعار اللحظية (للـ trigger activation) |
| **scripts/output/maker_radar_*.json** | cache | قراءة maker_radar results + incubator_candidates |

### التنفيذ (3 مراحل بدون شاشات جديدة):

#### المرحلة 1: Confluence Scorer (NEW: utils/confluence.py)
```python
def compute_confluence(ticker, existing_prediction):
    """يجمع كل الإثباتات من كل المحركات ويرجع confluence_score."""
    # 1. اقرأ كل المصادر
    flow_score = flow_system.get_flow_score(ticker)
    explosive = explosive_scanner.scan(ticker)
    maker_path = read_maker_radar_cache(ticker)
    support = stocks_db.get_support(ticker)
    regime = system_settings.get_regime()

    # 2. جمّع الـ proofs
    proofs = {
        'whale_proof': 0,        # 0-4
        'accumulation_proof': 0,  # 0-1
        'correction_proof': 0,    # 0-1
        'distribution_warning': 0,# 0-3
        'regime_proof': 0,        # 0-1
    }

    if flow_score and flow_score >= 80: proofs['whale_proof'] += 1
    if explosive and explosive >= 70: proofs['whale_proof'] += 1
    if maker_path in ['A_pre_surge', 'B_quiet_accumulation_strong']: proofs['whale_proof'] += 1
    if net_flow_egp > 0: proofs['whale_proof'] += 1

    # ... (باقي الـ proofs)

    # 3. القرار النهائي
    if proofs['distribution_warning'] >= 2:
        return {'signal': 'HOLD', 'track': 'DISTRIBUTION_VETO', ...}
    if proofs['whale_proof'] >= 3:
        return {'signal': 'STRONG_BUY', 'track': 'WHALE_CONFLUENCE', 'confidence': +15, ...}
    # ...

    return confluence_result
```

#### المرحلة 2: ربط في daily_predictor
```python
# في daily_predictor.py، بعد ما يولّد الـ prediction:
from utils.confluence import compute_confluence

for pred in predictions:
    confluence = compute_confluence(pred['ticker'], pred)
    pred['explosive_score'] = confluence['explosive_score']
    pred['evidence_count'] = confluence['evidence_count']
    pred['maker_entry_volume'] = confluence['maker_entry_volume']
    pred['fuel_pct'] = confluence['fuel_pct']
    pred['track'] = confluence['track']
    if confluence['signal_override']:
        pred['signal'] = confluence['signal_override']
        pred['notes'] = confluence['reason']
```

#### المرحلة 3: Incubator Pullback Hook
```python
# في intraday_scanner.py، لما incubator candidate يتحقق trigger:
if trigger_type == 'SUPPORT_CONFIRM' and live_price <= trigger_price * 1.02:
    # تأكد إن الحيتان لسه بتشتري
    flow_score = flow_system.get_flow_score(ticker)
    if flow_score >= 60:
        → activate prediction: track='PULLBACK_ENTRY'
        → reason: 'دخول بعد تصحيح عند الدعم + تأكيد استمرار التدفق'
```

---

## 📈 النتائج المتوقعة (بدون هلد)

### قبل الربط:
```
prediction: {"signal": "BUY", "confidence": 60, "evidence_count": 0}
- العميل مش عارف ليه BUY
- مفيش تأكيد إن فيه حيتان بتشتري
- مفيش حماية من التصريف
```

### بعد الربط:
```
prediction: {
  "signal": "STRONG_BUY",
  "confidence": 75,           # +15 من whale_proof
  "evidence_count": 4,        # 4 proofs
  "explosive_score": 78,      # من explosive_scanner
  "maker_entry_volume": 2.5M, # من maker_radar
  "fuel_pct": 85,             # من flow_system
  "track": "WHALE_CONFLUENCE",
  "notes": "تأكيد 4 مصادر: تدفق سيولة قوي + انفجار حجم + تجميع هادئ + سيولة موجبة"
}
```

### أو في حالة تصريف:
```
prediction: {
  "signal": "HOLD",           # vetoed من BUY
  "track": "DISTRIBUTION_VETO",
  "notes": "⚠️ تحذير تصريف — الحيتان بتبيع. انتظار."
}
```

### أو في حالة تصحيح:
```
incubator_candidate: {
  "ticker": "ABUK",
  "stage": "AWAITING_PULLBACK",
  "trigger": {"type": "SUPPORT_CONFIRM", "trigger_price": 88.0},
  "reason": "السهم صعد +6% — انتظار تصحيح للدعم 88.0"
}
# لما يصحح:
prediction: {
  "signal": "BUY",
  "track": "PULLBACK_ENTRY",
  "entry_price": 88.5,        # عند الدعم
  "notes": "دخول بعد تصحيح عند الدعم 88.0 + تأكيد استمرار التدفق (FlowScore=72)"
}
```

---

## 🎯 الخلاصة (بدون هلد ولا كذب)

### اللي موجود ومش مربوط:
1. **flow_system** — بيكشف حركة الحيتان بس مش مربوط بالـ predictions
2. **explosive_scanner** — بيكشف انفجارات الحجم بس مش مربوط
3. **maker_radar** — بيكشف مسار السهم بس مش مربوط
4. **support/resistance** — موجود في stocks.db بس مش مستخدم للـ pullback entry
5. **incubator_engine** — شغال بس trigger الـ SUPPORT_CONFIRM مش مربوط بـ flow_system

### اللي هنعمله (3 ملفات بس):
1. **NEW: `utils/confluence.py`** — Confluence Scorer (يجمع كل الإثباتات)
2. **MODIFY: `jobs/daily_predictor.py`** — ربط الـ confluence في الـ predictions
3. **MODIFY: `jobs/intraday_scanner.py`** — pullback hook (incubator + flow تأكيد)

### الفائدة:
- **أعلى دقة:** كل prediction بـ يـ weight بناء على عدد الـ proofs (4 proofs = شراء مؤسسي قوي)
- **أمان:** distribution_warning بـ veto أي شراء (مفيش شراء سهم الحيتان بتبيعه)
- **ذكاء:** pullback entry بدل ما نخسر سهم طلع +6%، نستناه يصحح ونشتري بأمان
- **شفافية:** العميل يشوف "تأكيد 4 مصادر" بدل "شراء" لوحدها
- **بدون شاشات جديدة:** كل ده في الـ backend + الـ existing columns في predictions table

**ده اللي نقدر نربط بيه الدنيا. مفيش اختراع من الصفر — كل المكونات موجودة، الفكرة في الربط والتجانس.**
