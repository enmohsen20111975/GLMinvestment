# 🎯 Canonical Calculations — توحيد مكان واحد للحسابات

**التاريخ:** 2026-10-07
**المرجع:** CALC-AUDIT-1 + CALC-DUP-1
**القاعدة:** CANONICAL-CALCULATIONS (مصدر واحد لكل المقاييس الفنية)

---

## الكارثة اللي اكتشفتها

3 شاشات (توقعات + تحليل شامل + رادار السيولة) بتعطي **3 نتائج مختلفة** لنفس السهم في نفس اللحظة:

**مثال ETCL (المصرية للاتصالات):**
- 🟢 شاشة التوقعات: "شراء قوي"
- 🔴 شاشة التحليل الشامل: "تصريف / تجميع بيعي"
- 🟡 رادار السيولة: "تحت الميكروسكوب بس تقيم منخفض"

## السبب الجذري

9 أماكن بتحسب "accumulation" بـ 7 صيغ مختلفة. 3 أماكن بتحسب "buy_pressure" (واحدة فيها hardcoded 85/40). 4 taxonomies مختلفة لـ "phase". 13+ مكان بيصنّف signal بـ 6 thresholds مختلفة.

## الحل — canonical_signal.py

**ملف واحد** هو المصدر الوحيد للـ 5 مقاييس الفنية:

```
vps-service/utils/canonical_signal.py
```

### الـ 5 metrics الموحّدة:

| Metric | Function | Thresholds |
|--------|----------|------------|
| **signal classification** | `classify_signal(master_score)` | STRONG_BUY≥78, BUY≥65, ACCUMULATE≥55, HOLD≥40, SELL≥25, STRONG_SELL<25 |
| **accumulation** | `classify_accumulation(buy_pct)` | تجميع قوي≥70, تجميع≥60, تجميع خفيف≥55, محايد≥45, تصريف خفيف≥40, تصريف≥30, تصريف قوي<30 |
| **money_flow_state** | `classify_money_flow(buy_pct, sell_pct)` | 🟢 داخلة قوية (diff≥25), 🟢 داخلة (≥10), 🟡 متوازنة, 🔴 خارجة, 🔴 خارجة قوية |
| **volume_ratio** | `classify_volume_ratio(entry_vol, avg_20d)` | capped at 50.0 |
| **stock_phase** | `classify_stock_phase(buy_pct, roc_10d)` | تجميع / تصاعد / توزيع / تخفيض / محايد |

## الإصلاحات المطبقة

### 1. `scripts/maker_radar.py` (lines 507-527)
**قبل:** `accumulation` كان بيتحسب من "عدد أيام الإغلاق الأخضر في 10 أيام"
**بعد:** يستورد `classify_accumulation(buy_pct)` من canonical_signal

**النتيجة:** ETEL دلوقتي بيقول:
- `buy_pct = 75.7%` ← نسبة شراء عالية
- `accumulation = تجميع قوي` ✅ (مش "تصريف قوي" زي زمان)
- `money_flow_state = 🟢 سيولة داخلة` ✅ (متسق مع buy_pct)
- `path = B_quiet_accumulation_strong` ✅ (under microscope)

### 2. `src/modules/predictions/components/MakerRadarTab.tsx` (line 2524)
**قبل:** Frontend كان فيه fallback بـ thresholds مختلفة عن الـ backend
```
liq >= 60 ? 'تجميع قوي' : liq <= 40 ? 'تصريف قوي' : 'تجميع هادئ'
```
**بعد:** Frontend بـ يعرض الـ accumulation اللي جاي من الـ backend مباشرة (مش بيحسب)

## خطة الترحيل (للملفات اللي لسه محتاجة توحيد)

| File | Line | Status | Priority |
|------|------|--------|----------|
| `vps-service/utils/shared_liquidity.py:416` | `detect_quiet_accumulation` | ✅ Already canonical | - |
| `scripts/maker_radar.py:507-527` | accumulation | ✅ Fixed | - |
| `src/modules/predictions/components/MakerRadarTab.tsx:2524` | frontend fallback | ✅ Fixed | - |
| `src/app/api/unified/route.ts:110-117 + 283-290` | duplicated thresholds | ⚠️ TODO | High |
| `scripts/dual_track_generator.py:207,269,327` | hardcoded 85/40 | ⚠️ TODO | High |
| `vps-service/analyzers/master_analyzer.py:495` | THRESHOLDS dict | ⚠️ TODO | Medium |
| `vps-service/analyzers/sniper_engine.py:1939-1959` | different thresholds | ⚠️ TODO | Medium |
| `scripts/v40_2_build_predictions.py:267-273` | different thresholds | ⚠️ TODO | Medium |

## القاعدة الجديدة (Rule: CANONICAL-CALCULATIONS)

> **أي metric فني** (signal / accumulation / money_flow / phase / volume_ratio) لازم يتحسب من `canonical_signal.py` فقط. أي ملف بيحسب الـ metric ده بصيغة مختلفة = bug.

**الفحص الذاتي:** شغّل `python3 vps-service/utils/canonical_signal.py` للتأكد إن الـ functions بتشتغل صح.

## أوامر السرفر بعد التحديث

```bash
cd /root/GLMinvestment
git pull origin main

# شغّل الرادار لإعادة توليد الإشارات بـ canonical calculations
python3 scripts/maker_radar.py --market EGX --json-only

# تحقق من النتيجة
python3 scripts/verify_radar_fix.py

# شغّل self-test للـ canonical module
python3 vps-service/utils/canonical_signal.py
```
